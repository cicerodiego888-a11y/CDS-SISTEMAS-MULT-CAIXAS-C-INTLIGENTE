/**
 * RC14.14.7 — FSM CONNECTED + instância única EquipmentSession
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '../..');
const {
  ConnectionStateMachine,
  STATES
} = require('../../backend/motores/equipamentos/connection/ConnectionStateMachine');
const connectionManager = require('../../backend/motores/equipamentos/connection/ConnectionManager');
const sessionRegistry = require('../../backend/motores/equipamentos/connection/EquipmentSessionRegistry');
const connectionMonitor = require('../../backend/motores/equipamentos/monitor/ConnectionMonitor');
const { CONNECTION_MODE } = require('../../backend/motores/equipamentos/connection/EquipmentSession');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC14.14.7 — FSM proíbe CONNECTING → IDLE', () => {
  it('CONNECTING → IDLE lança erro', () => {
    const fsm = new ConnectionStateMachine();
    fsm.transitar(STATES.CONNECTING);
    assert.throws(() => fsm.transitar(STATES.IDLE), /proibida|IDLE/);
  });

  it('fluxo oficial DISCONNECTED → CONNECTING → CONNECTED', () => {
    const fsm = new ConnectionStateMachine();
    fsm.transitar(STATES.CONNECTING);
    fsm.transitar(STATES.CONNECTED);
    assert.equal(fsm.estado, STATES.CONNECTED);
    assert.equal(fsm.ativo, true);
  });
});

describe('RC14.14.7 — connect deixa FSM em CONNECTED', () => {
  let server;
  let porta;

  before(async () => {
    sessionRegistry.clearForTests();
    server = net.createServer((s) => { s.on('data', () => {}); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    porta = server.address().port;
  });

  after(async () => {
    try { await connectionManager.disconnect({ host: '127.0.0.1', porta }); } catch (_) {}
    await new Promise((r) => server.close(r));
    sessionRegistry.clearForTests();
  });

  it('após connect: estado CONNECTED (não IDLE) e session coerente', async () => {
    const r = await connectionManager.connect({
      host: '127.0.0.1',
      porta,
      persistir: false,
      timeoutMs: 2000
    });
    assert.equal(r.status, 'CONNECTED');
    assert.equal(r.estado, STATES.CONNECTED);
    assert.ok(r.session);
    assert.equal(r.session.connected, true);
    assert.equal(r.session.state, 'CONNECTED');
    assert.equal(r.session.host, '127.0.0.1');
    assert.equal(r.session.porta, porta);
    assert.ok(r.session.connectedAt);
    assert.equal(r.connectionMode, CONNECTION_MODE.NEW_CONNECTION);

    const entry = connectionManager.getConnection({ host: '127.0.0.1', porta });
    assert.equal(entry.fsm.estado, STATES.CONNECTED);

    const live = connectionManager.getSession({ host: '127.0.0.1', porta });
    assert.strictEqual(live, entry.session);
    assert.equal(live.connected, true);
    assert.equal(live.host, '127.0.0.1');

    const mon = connectionMonitor.obterStatus(`127.0.0.1:${porta}`);
    assert.equal(mon.conectado, true);
    assert.equal(mon.estado, 'CONNECTED');
    assert.equal(mon.conectado, live.connected);
  });

  it('mesma referência getSession / registry', () => {
    const a = connectionManager.getSession({ host: '127.0.0.1', porta });
    const b = sessionRegistry.get({ host: '127.0.0.1', porta });
    assert.ok(a);
    assert.strictEqual(a, b);
  });
});

describe('RC14.14.7 — código', () => {
  it('CM transita para CONNECTED após socket', () => {
    const src = read('backend/motores/equipamentos/connection/ConnectionManager.js');
    assert.match(src, /STATES\.CONNECTED/);
    assert.match(src, /STATE CHANGE/);
    assert.match(src, /corrigidoRc14147|STATE_TRANSITION_PROIBIDA|proibida RC14\.14\.7/);
    assert.doesNotMatch(
      src,
      /transport\.connect\(\);[\s\S]{0,200}_transitar\(entry, STATES\.IDLE/
    );
  });

  it('FSM remove CONNECTING → IDLE', () => {
    const src = read('backend/motores/equipamentos/connection/ConnectionStateMachine.js');
    assert.match(src, /PROIBIDO|proibida/);
    const { TRANSICOES } = require('../../backend/motores/equipamentos/connection/ConnectionStateMachine');
    assert.equal(TRANSICOES[STATES.CONNECTING].has(STATES.IDLE), false);
  });
});
