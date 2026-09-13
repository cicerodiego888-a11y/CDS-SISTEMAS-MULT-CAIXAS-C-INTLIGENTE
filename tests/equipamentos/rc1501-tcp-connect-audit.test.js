/**
 * RC15.0.1 — Auditoria da conexão TCP oficial / diagnóstico por etapas
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '../..');
const {
  TCP_CONNECT_STATUS,
  HANDSHAKE_STATUS,
  classificarErroTcp,
  classificarErroHandshake
} = require('../../backend/motores/equipamentos/connection/TcpConnectStatus');
const { montarEtapasConexao } = require('../../backend/motores/equipamentos/connection/ConnectionStages');
const ConnectionTrace = require('../../backend/motores/equipamentos/connection/ConnectionTrace');
const {
  health,
  diagnostics,
  probeConnection
} = require('../../backend/motores/equipamentos/drivers/toledo/certificacao/ToledoDiagnostics');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC15.0.1 — Códigos TCP / Handshake', () => {
  it('classificarErroTcp', () => {
    assert.equal(classificarErroTcp({ code: 'ECONNREFUSED' }), TCP_CONNECT_STATUS.REFUSED);
    assert.equal(classificarErroTcp({ code: 'ETIMEDOUT' }), TCP_CONNECT_STATUS.TIMEOUT);
    assert.equal(classificarErroTcp({ code: 'TCP_TIMEOUT' }), TCP_CONNECT_STATUS.TIMEOUT);
    assert.equal(classificarErroTcp({ code: 'EHOSTUNREACH' }), TCP_CONNECT_STATUS.HOST_UNREACHABLE);
    assert.equal(classificarErroTcp({ code: 'EOTHER', message: 'boom' }), TCP_CONNECT_STATUS.SOCKET_EXCEPTION);
  });

  it('classificarErroHandshake', () => {
    assert.equal(classificarErroHandshake({ code: 'PROTOCOL_TIMEOUT' }), HANDSHAKE_STATUS.TIMEOUT);
    assert.equal(classificarErroHandshake({ message: 'NAK' }), HANDSHAKE_STATUS.NAK);
  });
});

describe('RC15.0.1 — Etapas independentes', () => {
  it('TCP OK + Handshake falha não marca TCP como falha', () => {
    const r = montarEtapasConexao({
      tcp: true,
      tcpCodigo: TCP_CONNECT_STATUS.OK,
      tcpLatenciaMs: 7,
      handshake: false,
      handshakeCodigo: HANDSHAKE_STATUS.TIMEOUT,
      handshakeErro: 'Timeout',
      health: true,
      driver: true,
      incluirRead: true,
      read: false,
      readErro: 'Timeout aguardando ACK'
    });
    const tcp = r.etapas.find((e) => e.chave === 'TCP_CONNECT');
    const hs = r.etapas.find((e) => e.chave === 'HANDSHAKE');
    const read = r.etapas.find((e) => e.chave === 'READ');
    assert.equal(tcp.ok, true);
    assert.equal(tcp.codigo, TCP_CONNECT_STATUS.OK);
    assert.equal(hs.ok, false);
    assert.equal(hs.codigo, HANDSHAKE_STATUS.TIMEOUT);
    assert.equal(read.ok, false);
    assert.equal(r.etapaFalha, 'HANDSHAKE');
    assert.doesNotMatch(JSON.stringify(tcp), /Sem comunicação/);
  });

  it('Handshake não iniciado quando TCP falha', () => {
    const r = montarEtapasConexao({
      tcp: false,
      tcpCodigo: TCP_CONNECT_STATUS.REFUSED,
      tcpErro: 'connect ECONNREFUSED',
      handshake: null,
      health: false,
      driver: true,
      incluirRead: true,
      read: null
    });
    assert.equal(r.etapaFalha, 'TCP_CONNECT');
    assert.equal(r.etapas.find((e) => e.chave === 'HANDSHAKE').estado, 'NAO_INICIADO');
    assert.equal(r.etapas.find((e) => e.chave === 'READ').estado, 'NAO_INICIADO');
  });
});

describe('RC15.0.1 — ConnectionTrace', () => {
  it('gera texto oficial', () => {
    const t = ConnectionTrace.criar({ host: '10.0.0.170', porta: 9000, timeoutMs: 5000 });
    t.inicioConnect();
    t.socketOk({ latenciaMs: 7 });
    t.inicioHandshake();
    t.frameTx({ comando: 'HS', bytes: 20 });
    t.frameRx({ comando: 'AK', bytes: 18 });
    t.ack({ ok: true, latenciaMs: 12 });
    t.finalizar('OK');
    const txt = t.toText();
    assert.match(txt, /CONNECTION TRACE/);
    assert.match(txt, /10\.0\.0\.170/);
    assert.match(txt, /9000/);
    assert.match(txt, /Socket OK/);
    assert.match(txt, /Handshake/);
    assert.match(txt, /Frame TX/);
    assert.match(txt, /ACK/);
  });
});

describe('RC15.0.1 — Health passivo vs probe', () => {
  it('health passivo sem sessão não usa Sem comunicação genérico', () => {
    const h = health({ host: '10.255.255.9', porta: 9000 });
    assert.equal(h.online, false);
    assert.equal(h.sessaoAusente, true);
    assert.doesNotMatch(String(h.motivo), /^Sem comunicação$/);
  });

  it('diagnostics sem probe não abre socket', async () => {
    const d = await diagnostics({ host: '10.255.255.9', porta: 9000, probe: false });
    assert.equal(d.success, true);
    assert.equal(d.probe, null);
    assert.ok(d.etapas_conexao);
  });
});

describe('RC15.0.1 — Probe TCP real (echo local)', () => {
  it('TCP_CONNECT_OK quando socket aceita', async () => {
    const server = net.createServer((s) => {
      // Aceita TCP; não responde handshake → HS deve falhar/timeout rápido
      s.on('data', () => { /* silêncio */ });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const porta = server.address().port;
    try {
      const probe = await probeConnection({
        host: '127.0.0.1',
        porta,
        timeoutMs: 2000,
        handshakeTimeoutMs: 200,
        keepAlive: false
      });
      assert.equal(probe.tcp.ok, true, JSON.stringify(probe.tcp));
      assert.equal(probe.tcp.codigo, TCP_CONNECT_STATUS.OK);
      // Handshake pode falhar (sem ACK) — mas TCP permanece OK
      assert.notEqual(probe.handshake.ok, true);
      assert.equal(probe.handshake.ok, false);
      assert.ok(
        probe.handshake.codigo === HANDSHAKE_STATUS.TIMEOUT
        || probe.handshake.codigo === HANDSHAKE_STATUS.NO_RESPONSE
        || probe.handshake.codigo === HANDSHAKE_STATUS.ERROR
      );
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe('RC15.0.1 — Instrumentação / Front', () => {
  it('ConnectionManager registra trace no connect', () => {
    const src = read('backend/motores/equipamentos/connection/ConnectionManager.js');
    assert.match(src, /ConnectionTrace/);
    assert.match(src, /TCP_CONNECT_OK|connectCodigo/);
    assert.match(src, /classificarErroTcp/);
  });

  it('ToledoDiagnostics usa probe ativo', () => {
    const src = read('backend/motores/equipamentos/drivers/toledo/certificacao/ToledoDiagnostics.js');
    assert.match(src, /probeConnection/);
    assert.match(src, /async function diagnostics/);
    assert.doesNotMatch(src, /hsOk = !offline && \(h\.handshake === true \|\| tcpOk\)/);
  });

  it('painel renderiza etapas', () => {
    const src = read('frontend/erp/js/central-equipamentos.js');
    assert.match(src, /diagEtapasConexao/);
    assert.match(src, /centralEqDiagRenderEtapas/);
    assert.match(src, /TCP OK|Handshake|etapaFalha/);
  });
});
