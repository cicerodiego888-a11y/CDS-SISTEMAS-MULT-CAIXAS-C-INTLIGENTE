/**
 * RC14.14.6 — Unificação da fonte de verdade (EquipmentSession)
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '../..');
const {
  EquipmentSession,
  SESSION_STATE,
  CONNECTION_MODE,
  mapFsmToSessionState,
  criarSessaoAusente
} = require('../../backend/motores/equipamentos/connection/EquipmentSession');
const connectionManager = require('../../backend/motores/equipamentos/connection/ConnectionManager');
const connectionMonitor = require('../../backend/motores/equipamentos/monitor/ConnectionMonitor');
const { diagnostics } = require('../../backend/motores/equipamentos/drivers/toledo/certificacao/ToledoDiagnostics');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC14.14.6 — EquipmentSession', () => {
  it('mapeia FSM IDLE/BUSY → CONNECTED', () => {
    assert.equal(mapFsmToSessionState('IDLE'), SESSION_STATE.CONNECTED);
    assert.equal(mapFsmToSessionState('BUSY'), SESSION_STATE.CONNECTED);
    // RC14.14.8 — RECONNECTING é estado oficial da sessão
    assert.equal(mapFsmToSessionState('RECONNECTING'), SESSION_STATE.RECONNECTING);
    assert.equal(mapFsmToSessionState('ERROR'), SESSION_STATE.ERROR);
  });

  it('conexao e monitor são idênticos', () => {
    const s = new EquipmentSession({ host: '10.0.0.170', porta: 9000 });
    s.markConnected(CONNECTION_MODE.NEW_CONNECTION, 5);
    const { conexao, monitor, session } = s.toConexaoMonitor();
    assert.deepEqual(conexao, monitor);
    assert.equal(conexao.conectado, true);
    assert.equal(conexao.estado, 'CONNECTED');
    assert.equal(monitor.status, 'CONNECTED');
    assert.equal(session.connectionMode, CONNECTION_MODE.NEW_CONNECTION);
    assert.equal(conexao.conectado, monitor.conectado);
  });

  it('nunca CONNECTED + OFFLINE no mesmo snapshot', () => {
    const s = criarSessaoAusente({ host: '10.0.0.1', porta: 9000 });
    const { conexao, monitor } = s.toConexaoMonitor();
    assert.equal(conexao.conectado, monitor.conectado);
    assert.equal(conexao.estado, monitor.estado);
    assert.equal(conexao.conectado, false);
    assert.equal(conexao.estado, 'DISCONNECTED');
  });
});

describe('RC14.14.6 — CM + Monitor sincronizados', () => {
  let server;
  let porta;

  before(async () => {
    server = net.createServer((s) => { s.on('data', () => {}); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    porta = server.address().port;
  });

  after(async () => {
    try { await connectionManager.disconnect({ host: '127.0.0.1', porta }); } catch (_) {}
    await new Promise((r) => server.close(r));
  });

  it('após connect: CM session e Monitor iguais e CONNECTED', async () => {
    const r = await connectionManager.connect({
      host: '127.0.0.1',
      porta,
      persistir: false,
      timeoutMs: 2000
    });
    assert.ok(['CONNECTED', 'CONNECTED_ALREADY'].includes(r.status));
    assert.ok(r.session);
    assert.equal(r.session.connected, true);
    assert.equal(r.session.state, 'CONNECTED');
    assert.ok(
      [CONNECTION_MODE.NEW_CONNECTION, CONNECTION_MODE.REUSED_SESSION].includes(r.connectionMode)
    );

    const mon = connectionMonitor.obterStatus(`127.0.0.1:${porta}`);
    assert.equal(mon.conectado, true);
    assert.equal(mon.estado, 'CONNECTED');
    assert.equal(mon.status, 'CONNECTED');
    assert.equal(mon.conectado, r.session.connected);
    assert.equal(mon.estado, r.session.state);

    const h = connectionManager.health({ host: '127.0.0.1', porta });
    assert.equal(h.conexao.conectado, h.monitor.conectado);
    assert.equal(h.conexao.estado, h.monitor.estado);
    assert.equal(h.connected, true);
  });

  it('CONNECTED_ALREADY → REUSED_SESSION', async () => {
    const r = await connectionManager.connect({
      host: '127.0.0.1',
      porta,
      persistir: false
    });
    assert.equal(r.status, 'CONNECTED_ALREADY');
    assert.equal(r.connectionMode, CONNECTION_MODE.REUSED_SESSION);
    assert.equal(r.session.connected, true);
  });

  it('após disconnect: ambos DISCONNECTED', async () => {
    await connectionManager.disconnect({ host: '127.0.0.1', porta });
    const mon = connectionMonitor.obterStatus(`127.0.0.1:${porta}`);
    assert.equal(mon.conectado, false);
    assert.equal(mon.estado, 'DISCONNECTED');
    const h = connectionManager.health({ host: '127.0.0.1', porta });
    assert.equal(h.conexao.conectado, false);
    assert.equal(h.monitor.conectado, false);
    assert.equal(h.conexao.estado, h.monitor.estado);
  });
});

describe('RC14.14.6 — Diagnóstico usa sessão', () => {
  it('diagnostics expõe session/conexao/monitor coerentes', async () => {
    const d = await diagnostics({
      host: '10.255.255.9',
      porta: 9000,
      probe: false
    });
    assert.ok(d.session);
    assert.ok(d.conexao);
    assert.ok(d.monitor);
    assert.equal(d.conexao.conectado, d.monitor.conectado);
    assert.equal(d.conexao.estado, d.monitor.estado);
  });
});

describe('RC14.14.6 — código / front', () => {
  it('EquipmentSession exportado e CM sincroniza', () => {
    const cm = read('backend/motores/equipamentos/connection/ConnectionManager.js');
    assert.match(cm, /EquipmentSession/);
    assert.match(cm, /CONNECTION_MODE\.REUSED_SESSION/);
    assert.match(cm, /getSessionSnapshot/);
    const mon = read('backend/motores/equipamentos/monitor/ConnectionMonitor.js');
    assert.match(mon, /getSessionSnapshot/);
    assert.match(mon, /fonte: 'EquipmentSession'/);
  });

  it('front usa session.state do backend', () => {
    const src = read('frontend/erp/js/central-equipamentos.js');
    assert.match(src, /body\.session\?\.state/);
    assert.match(src, /EquipmentSession/);
  });
});
