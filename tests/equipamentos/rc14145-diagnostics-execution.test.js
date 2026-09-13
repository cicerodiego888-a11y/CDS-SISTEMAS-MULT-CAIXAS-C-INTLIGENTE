/**
 * RC14.14.5 — Diagnóstico Enterprise com comunicação real
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '../..');
const {
  diagnostics,
  probeConnection,
  resolverAlvoDiagnostico
} = require('../../backend/motores/equipamentos/drivers/toledo/certificacao/ToledoDiagnostics');
const { montarEtapasConexao } = require('../../backend/motores/equipamentos/connection/ConnectionStages');
const { TCP_CONNECT_STATUS } = require('../../backend/motores/equipamentos/connection/TcpConnectStatus');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC14.14.5 — resolverAlvoDiagnostico', () => {
  it('resolve ultimo_ip / identidade quando equipamento.ip está vazio', () => {
    const a = resolverAlvoDiagnostico({
      equipamento: { ip: null, ultimo_ip: '10.0.0.170', porta_tcp: 9000 }
    });
    assert.equal(a.host, '10.0.0.170');
    assert.equal(a.porta, 9000);

    const b = resolverAlvoDiagnostico({
      equipamento: { ip: null },
      identidade: { ip_atual: '10.0.0.170', porta_atual: 9000 }
    });
    assert.equal(b.host, '10.0.0.170');
  });

  it('prioriza host explícito da query', () => {
    const a = resolverAlvoDiagnostico({
      host: '10.0.0.99',
      equipamento: { ip: '10.0.0.1', ultimo_ip: '10.0.0.2' }
    });
    assert.equal(a.host, '10.0.0.99');
  });
});

describe('RC14.14.5 — diagnóstico solicitado nunca deixa NAO_INICIADO', () => {
  it('sem IP → TCP FALHA + demais Não executado', async () => {
    const d = await diagnostics({ probe: true, equipamento: {} });
    assert.ok(d.probe);
    assert.equal(d.probe.resumo.tcp, false);
    assert.equal(d.probe.tcp.ok, false);
    assert.equal(d.equipamento.ip, null);
    assert.ok(d.connection_trace);
    assert.equal(d.connection_trace.socket, 'FAILED');

    const tcp = d.etapas_conexao.etapas.find((e) => e.chave === 'TCP_CONNECT');
    const hs = d.etapas_conexao.etapas.find((e) => e.chave === 'HANDSHAKE');
    assert.equal(tcp.ok, false);
    assert.equal(tcp.codigo, TCP_CONNECT_STATUS.IP_MISSING);
    assert.notEqual(tcp.estado, 'NAO_INICIADO');
    assert.equal(hs.estado, 'NAO_EXECUTADO');
    assert.notEqual(hs.estado, 'NAO_INICIADO');
  });

  it('montarEtapas com diagnosticoSolicitado', () => {
    const r = montarEtapasConexao({
      diagnosticoSolicitado: true,
      tcp: false,
      tcpCodigo: TCP_CONNECT_STATUS.REFUSED,
      tcpErro: 'refused',
      handshake: null,
      health: false,
      healthErro: 'refused',
      driver: true,
      incluirRead: true,
      read: null
    });
    assert.equal(r.etapas.find((e) => e.chave === 'HANDSHAKE').estado, 'NAO_EXECUTADO');
    assert.equal(r.etapas.find((e) => e.chave === 'READ').estado, 'NAO_EXECUTADO');
    assert.equal(r.etapas.find((e) => e.chave === 'TCP_CONNECT').estado, 'FALHA');
  });
});

describe('RC14.14.5 — probe + trace populados com IP', () => {
  it('ultimo_ip no cadastro dispara probe e preenche network.ip', async () => {
    const d = await diagnostics({
      probe: true,
      equipamento: { ultimo_ip: '127.0.0.1', porta_tcp: 1 },
      timeoutMs: 300,
      handshakeTimeoutMs: 200,
      keepAlive: false
    });
    assert.equal(d.equipamento.ip, '127.0.0.1');
    assert.equal(d.network.ip, '127.0.0.1');
    assert.ok(d.probe);
    assert.equal(typeof d.probe.resumo.tcp, 'boolean');
    assert.ok(d.connection_trace);
    assert.ok(d.connection_trace.socket);
    const tcp = d.etapas_conexao.etapas.find((e) => e.chave === 'TCP_CONNECT');
    assert.notEqual(tcp.estado, 'NAO_INICIADO');
    assert.equal(tcp.ok, false); // porta 1 → refused
  });

  it('echo local: TCP OK e etapas reais', async () => {
    const server = net.createServer((s) => {
      s.on('data', () => { /* silêncio */ });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const porta = server.address().port;
    try {
      const d = await diagnostics({
        host: '127.0.0.1',
        porta,
        probe: true,
        timeoutMs: 2000,
        handshakeTimeoutMs: 200,
        keepAlive: false
      });
      assert.equal(d.equipamento.ip, '127.0.0.1');
      assert.equal(d.network.ip, '127.0.0.1');
      assert.ok(d.probe);
      assert.equal(d.probe.resumo.tcp, true);
      assert.ok(d.connection_trace);
      assert.equal(d.connection_trace.socket, 'CONNECTED');
      const tcp = d.etapas_conexao.etapas.find((e) => e.chave === 'TCP_CONNECT');
      assert.equal(tcp.ok, true);
      assert.equal(tcp.estado, 'OK');
      // Handshake deve ter resultado real (não NAO_INICIADO)
      const hs = d.etapas_conexao.etapas.find((e) => e.chave === 'HANDSHAKE');
      assert.notEqual(hs.estado, 'NAO_INICIADO');
    } finally {
      try {
        const cm = require('../../backend/motores/equipamentos/connection/ConnectionManager');
        await cm.disconnect({ host: '127.0.0.1', porta });
      } catch (_) { /* ignore */ }
      await new Promise((r) => server.close(r));
    }
  });
});

describe('RC14.14.5 — front Atualizar Diagnóstico', () => {
  it('botão força probe e preferência POST por equipamento', () => {
    const src = read('frontend/erp/js/central-equipamentos.js');
    assert.match(src, /RC14\.14\.5/);
    assert.match(src, /__centralEqDiagEquipamentoId/);
    assert.match(src, /q\.set\('probe', '1'\)/);
    assert.match(src, /POST equipamento/);
    assert.match(src, /comunicação real/);
  });

  it('CentralService resolve identidade / ultimo_ip', () => {
    const src = read('backend/motores/equipamentos/central/CentralEquipamentosService.js');
    assert.match(src, /resolverAlvoDiagnostico/);
    assert.match(src, /ip_atual/);
    assert.match(src, /probe:\s*true/);
  });
});
