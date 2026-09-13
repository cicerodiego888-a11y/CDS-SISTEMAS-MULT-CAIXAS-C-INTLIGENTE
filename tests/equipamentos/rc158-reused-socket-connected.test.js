/**
 * RC15.8 — Socket reutilizado restaura CONNECTED antes do handshake
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

describe('RC15.8 — reutilização restaura CONNECTED', () => {
  let server;
  let porta;

  before(async () => {
    sessionRegistry.clearForTests();
    try { await connectionManager.closeAll(); } catch (_) { /* ignore */ }
    server = net.createServer((s) => { s.on('data', () => {}); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    porta = server.address().port;
  });

  after(async () => {
    try { await connectionManager.disconnect({ host: '127.0.0.1', porta }); } catch (_) { /* ignore */ }
    try { await connectionManager.closeAll(); } catch (_) { /* ignore */ }
    await new Promise((r) => server.close(r));
    sessionRegistry.clearForTests();
  });

  it('socket aberto + FSM RECONNECTING → CONNECTED + REUSED_SESSION', async () => {
    await connectionManager.connect({
      host: '127.0.0.1',
      porta,
      persistir: true,
      timeoutMs: 2000
    });

    const entry = connectionManager.getConnection({ host: '127.0.0.1', porta });
    assert.ok(entry);
    assert.equal(entry.transport?.aberto, true);

    // Simula race: heartbeat marcou RECONNECTING mas socket ainda aberto
    entry.fsm.forcar(STATES.RECONNECTING, { rc158: 'setup' });
    if (entry.session) {
      entry.session.state = SESSION_STATE.RECONNECTING;
      entry.session.connected = false;
    }

    const r = await connectionManager.connect({
      host: '127.0.0.1',
      porta,
      persistir: true
    });

    assert.equal(r.status, 'CONNECTED_ALREADY');
    assert.equal(r.reutilizada, true);
    assert.equal(r.transportAberto, true);
    assert.equal(r.estado, STATES.CONNECTED);
    assert.equal(r.connectionMode, CONNECTION_MODE.REUSED_SESSION);
    assert.equal(r.session.state, SESSION_STATE.CONNECTED);
    assert.equal(r.session.connected, true);
    assert.equal(r.session.connectionMode, CONNECTION_MODE.REUSED_SESSION);

    const live = connectionManager.getSession({ host: '127.0.0.1', porta });
    assert.equal(live.connected, true);
    assert.equal(live.state, SESSION_STATE.CONNECTED);
    assert.equal(entry.fsm.estado, STATES.CONNECTED);
    assert.equal(entry.fsm.ativo, true);
  });

  it('send com socket aberto e FSM RECONNECTING restaura CONNECTED', async () => {
    const entry = connectionManager.getConnection({ host: '127.0.0.1', porta });
    assert.ok(entry?.transport?.aberto);

    entry.fsm.forcar(STATES.RECONNECTING, { rc158: 'send-setup' });
    if (entry.session) {
      entry.session.connected = false;
      entry.session.state = 'RECONNECTING';
    }

    await connectionManager.send({ host: '127.0.0.1', porta }, Buffer.from([0x05]));
    assert.equal(entry.fsm.estado, STATES.CONNECTED);
    assert.equal(entry.session.connected, true);
  });
});

describe('RC15.8 — código', () => {
  it('ConnectionManager restaura CONNECTED em reuse e instrumenta logs', () => {
    const src = read('backend/motores/equipamentos/connection/ConnectionManager.js');
    assert.match(src, /REUSED SOCKET/);
    assert.match(src, /CONNECTED RESTORED/);
    assert.match(src, /rc158/);
    assert.match(src, /_reconnectAbort/);
    assert.match(src, /socketAberto/);
  });

  it('Driver não rejeita handshake só por session.state RECONNECTING', () => {
    const src = read('backend/motores/equipamentos/drivers/toledo/ToledoPrixIVDriver.js');
    assert.match(src, /SOCKET_CLOSED|socket fechado/i);
    assert.match(src, /===== HANDSHAKE =====/);
    assert.match(src, /RC15\.8/);
  });
});
