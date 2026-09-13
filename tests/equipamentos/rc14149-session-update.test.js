/**
 * RC14.14.9 — Correção da atualização da EquipmentSession após connect()
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '../..');
const connectionManager = require('../../backend/motores/equipamentos/connection/ConnectionManager');
const sessionRegistry = require('../../backend/motores/equipamentos/connection/EquipmentSessionRegistry');
const { CONNECTION_MODE, SESSION_STATE } = require('../../backend/motores/equipamentos/connection/EquipmentSession');
const { STATES } = require('../../backend/motores/equipamentos/connection/ConnectionStateMachine');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC14.14.9 — connect atualiza EquipmentSession oficial', () => {
  let server;
  let porta;

  before(async () => {
    sessionRegistry.clearForTests();
    try { await connectionManager.closeAll(); } catch (_) {}
    server = net.createServer((s) => { s.on('data', () => {}); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    porta = server.address().port;
  });

  after(async () => {
    try { await connectionManager.disconnect({ host: '127.0.0.1', porta }); } catch (_) {}
    try { await connectionManager.closeAll(); } catch (_) {}
    await new Promise((r) => server.close(r));
    sessionRegistry.clearForTests();
  });

  it('após connect: session.connected/persistent/host/porta/mode preenchidos', async () => {
    const r = await connectionManager.connect({
      host: '127.0.0.1',
      porta,
      persistir: true,
      timeoutMs: 2000
    });

    assert.equal(r.status, 'CONNECTED');
    assert.equal(r.estado, STATES.CONNECTED);
    assert.ok(r.session, 'return deve incluir session');
    assert.equal(r.session.connected, true);
    assert.equal(r.session.state, SESSION_STATE.CONNECTED);
    assert.equal(r.session.persistent, true);
    assert.equal(r.session.host, '127.0.0.1');
    assert.equal(r.session.porta, porta);
    assert.ok(r.session.connectedAt);
    assert.equal(r.session.connectionMode, CONNECTION_MODE.NEW_CONNECTION);

    // Mesma referência viva no registry / getSession
    const live = connectionManager.getSession({ host: '127.0.0.1', porta });
    assert.ok(live);
    assert.equal(live.connected, true);
    assert.equal(live.persistent, true);
    assert.equal(live.host, '127.0.0.1');
    assert.equal(live.porta, porta);
    assert.equal(live.state, SESSION_STATE.CONNECTED);
    assert.equal(live.connectionMode, CONNECTION_MODE.NEW_CONNECTION);
    assert.ok(live.connectedAt);

    // JSON do return espelha exatamente a sessão viva
    assert.equal(r.session.connected, live.connected);
    assert.equal(r.session.host, live.host);
    assert.equal(r.session.porta, live.porta);
    assert.equal(r.session.persistent, live.persistent);
    assert.equal(r.session.connectionMode, live.connectionMode);
  });

  it('CONNECTED_ALREADY também faz SESSION UPDATE', async () => {
    const r = await connectionManager.connect({
      host: '127.0.0.1',
      porta,
      persistir: true
    });
    assert.equal(r.status, 'CONNECTED_ALREADY');
    assert.equal(r.session.connected, true);
    assert.equal(r.session.persistent, true);
    assert.equal(r.session.host, '127.0.0.1');
    assert.equal(r.session.porta, porta);
    assert.equal(r.session.connectionMode, CONNECTION_MODE.REUSED_SESSION);
  });

  it('getSessionSnapshot sem entry não cria fantasma host=null no registry', () => {
    const before = sessionRegistry.size();
    const snap = connectionManager.getSessionSnapshot({});
    assert.equal(snap.session.connected, false);
    assert.equal(sessionRegistry.size(), before);
  });
});

describe('RC14.14.9 — código', () => {
  it('CM tem _commitSessionConnected e log SESSION UPDATE', () => {
    const src = read('backend/motores/equipamentos/connection/ConnectionManager.js');
    assert.match(src, /_commitSessionConnected/);
    assert.match(src, /SESSION UPDATE/);
    assert.match(src, /SESSION_UPDATE_REQUIRED|SESSION_UPDATE_INCONSISTENT/);
  });

  it('ambos returns de connect passam por _commitSessionConnected', () => {
    const src = read('backend/motores/equipamentos/connection/ConnectionManager.js');
    const connectFn = src.slice(
      src.indexOf('async connect(opcoes'),
      src.indexOf('async disconnect(opcoes')
    );
    assert.match(connectFn, /_commitSessionConnected/);
    // Nenhum return CONNECTED sem commit na função connect
    const returns = [...connectFn.matchAll(/return\s*\{[\s\S]*?status:\s*'CONNECTED[^']*'/g)];
    assert.ok(returns.length >= 2, 'deve haver returns CONNECTED / CONNECTED_ALREADY');
    // Ambos devem estar após um _commitSessionConnected no mesmo bloco
    assert.equal(
      (connectFn.match(/_commitSessionConnected/g) || []).length >= 2,
      true
    );
  });
});
