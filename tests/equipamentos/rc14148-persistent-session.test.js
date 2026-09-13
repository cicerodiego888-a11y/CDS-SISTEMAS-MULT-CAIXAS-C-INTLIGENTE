/**
 * RC14.14.8 — Sessão Persistente + Heartbeat Oficial
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
const ConnectionHeartbeat = require('../../backend/motores/equipamentos/connection/ConnectionHeartbeat');
const { CONNECTION_MODE, SESSION_STATE } = require('../../backend/motores/equipamentos/connection/EquipmentSession');
const { STATES } = require('../../backend/motores/equipamentos/connection/ConnectionStateMachine');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC14.14.8 — heartbeat oficial 30s', () => {
  it('intervalo padrão 30000ms e configurável', () => {
    assert.equal(ConnectionHeartbeat.INTERVALO_PADRAO_MS, 30000);
    const hb = new ConnectionHeartbeat({ intervaloMs: 5000 });
    assert.equal(hb.intervaloMs, 5000);
  });
});

describe('RC14.14.8 — sessão permanente + reuso de socket', () => {
  let server;
  let porta;
  let socketCount = 0;

  before(async () => {
    sessionRegistry.clearForTests();
    try { await connectionManager.closeAll(); } catch (_) {}
    server = net.createServer((s) => {
      socketCount += 1;
      s.on('data', () => {});
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    porta = server.address().port;
  });

  after(async () => {
    try { await connectionManager.disconnect({ host: '127.0.0.1', porta }); } catch (_) {}
    try { await connectionManager.closeAll(); } catch (_) {}
    await new Promise((r) => server.close(r));
    sessionRegistry.clearForTests();
  });

  it('connect marca sessão persistent + heartbeat ativo', async () => {
    socketCount = 0;
    const r = await connectionManager.connect({
      host: '127.0.0.1',
      porta,
      persistir: true,
      timeoutMs: 2000
    });
    assert.equal(r.status, 'CONNECTED');
    assert.equal(r.estado, STATES.CONNECTED);

    const session = connectionManager.getSession({ host: '127.0.0.1', porta });
    assert.ok(session);
    assert.equal(session.state, SESSION_STATE.CONNECTED);
    assert.equal(session.persistent, true);
    assert.equal(session.connected, true);

    const entry = connectionManager.getConnection({ host: '127.0.0.1', porta });
    assert.equal(entry.heartbeat?.ativo, true);
    assert.ok(socketCount >= 1);
  });

  it('segunda operação reutiliza o mesmo socket (CONNECTED_ALREADY)', async () => {
    const before = socketCount;
    const r = await connectionManager.connect({
      host: '127.0.0.1',
      porta,
      persistir: true,
      timeoutMs: 2000
    });
    assert.equal(r.status, 'CONNECTED_ALREADY');
    assert.equal(r.reutilizada, true);
    assert.equal(r.connectionMode, CONNECTION_MODE.REUSED_SESSION);
    assert.equal(socketCount, before, 'não deve abrir novo socket');

    const a = connectionManager.getSession({ host: '127.0.0.1', porta });
    const b = sessionRegistry.get({ host: '127.0.0.1', porta });
    assert.strictEqual(a, b);
  });

  it('ping/health reutilizam a mesma sessão e atualizam heartbeatAt', async () => {
    const session = connectionManager.getSession({ host: '127.0.0.1', porta });
    assert.ok(session);
    const beforeSockets = socketCount;

    const ping = await connectionManager.ping({ host: '127.0.0.1', porta });
    assert.equal(ping.ok, true);
    assert.ok(session.heartbeatAt);
    assert.equal(session.state, SESSION_STATE.CONNECTED);
    assert.equal(session.connectionMode, CONNECTION_MODE.REUSED_SESSION);
    assert.equal(socketCount, beforeSockets);

    const health = connectionManager.health({ host: '127.0.0.1', porta });
    assert.ok(health);
    assert.equal(socketCount, beforeSockets);
  });

  it('touchHeartbeat atualiza heartbeatAt / latency / mode', () => {
    const session = connectionManager.getSession({ host: '127.0.0.1', porta });
    session.touchHeartbeat(42, CONNECTION_MODE.REUSED_SESSION);
    assert.equal(session.latency, 42);
    assert.equal(session.connectionMode, CONNECTION_MODE.REUSED_SESSION);
    assert.ok(session.heartbeatAt);
    assert.equal(session.state, SESSION_STATE.CONNECTED);
  });
});

describe('RC14.14.8 — código: sem disconnect após teste/diag', () => {
  it('EquipamentosService não fecha socket após teste bem-sucedido', () => {
    const src = read('backend/motores/equipamentos/services/EquipamentosService.js');
    assert.match(src, /sessão permanece CONNECTED|NÃO desconectar/i);
    assert.match(src, /persistir:\s*true/);
    // testarConexao não deve mais fazer disconnect no caminho de sucesso
    const bloco = src.slice(src.indexOf('async testarConexao'), src.indexOf('async obterStatusConexao'));
    assert.doesNotMatch(bloco, /await connectionManager\.disconnect/);
  });

  it('ToledoDiagnostics keepAlive default true', () => {
    const src = read('backend/motores/equipamentos/drivers/toledo/certificacao/ToledoDiagnostics.js');
    assert.match(src, /keepAlive !== false/);
    assert.match(src, /NÃO desconectar após diagnóstico|keepAlive === false/);
  });

  it('HeartbeatProbe reutiliza ConnectionManager quando conectado', () => {
    const src = read('backend/motores/equipamentos/monitor/HeartbeatProbe.js');
    assert.match(src, /probeViaConnectionManager|reused_session/);
    assert.match(src, /ConnectionManager/);
  });

  it('ERP/servidor chama closeAll no encerramento', () => {
    assert.match(read('backend/server.js'), /closeAll/);
    assert.match(read('electron.js'), /will-quit[\s\S]*closeAll|closeAll[\s\S]*will-quit/);
  });

  it('CM inicia heartbeat e reconecta em falha', () => {
    const src = read('backend/motores/equipamentos/connection/ConnectionManager.js');
    assert.match(src, /HEARTBEAT_MS\s*=\s*30000|_iniciarHeartbeat/);
    assert.match(src, /heartbeat_falhou/);
    assert.match(src, /_agendarReconexao/);
    assert.match(src, /STATES\.RECONNECTING/);
  });
});
