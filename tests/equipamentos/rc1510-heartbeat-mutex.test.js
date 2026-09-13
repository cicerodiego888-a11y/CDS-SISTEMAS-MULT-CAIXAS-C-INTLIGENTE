/**
 * RC15.10 — Exclusão mútua Heartbeat × Operações
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
const {
  markBusy,
  clearBusy,
  withBusy,
  deveSuspenderHeartbeat,
  podeHeartbeatDisconnect,
  OP_BUSY
} = require('../../backend/motores/equipamentos/connection/SessionBusy');
const { executarProbe } = require('../../backend/motores/equipamentos/monitor/HeartbeatProbe');
const { EquipmentSession } = require('../../backend/motores/equipamentos/connection/EquipmentSession');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC15.10 — SessionBusy', () => {
  it('markBusy / clearBusy com refcount', () => {
    const s = new EquipmentSession({ host: '10.0.0.1', porta: 9000 });
    s.markBusy(OP_BUSY.UPLOAD);
    assert.equal(s.busy, true);
    assert.equal(s.busyDepth, 1);
    s.markBusy(OP_BUSY.CONFIG);
    assert.equal(s.busyDepth, 2);
    s.clearBusy();
    assert.equal(s.busy, true);
    s.clearBusy();
    assert.equal(s.busy, false);
    assert.equal(s.busyDepth, 0);
  });

  it('podeHeartbeatDisconnect respeita busy e persistent', () => {
    const s = new EquipmentSession({ host: '10.0.0.2', porta: 9000 });
    s.markConnected('NEW_CONNECTION');
    s.setPersistent(true);
    assert.equal(podeHeartbeatDisconnect(s), false);
    s.setPersistent(false);
    s.connected = true;
    assert.equal(podeHeartbeatDisconnect(s), true);
    s.markBusy('UPLOAD');
    assert.equal(podeHeartbeatDisconnect(s), false);
    assert.equal(deveSuspenderHeartbeat(s), true);
  });
});

describe('RC15.10 — HeartbeatProbe não disconnect com busy', { concurrency: false }, () => {
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
    try { await connectionManager.closeAll(); } catch (_) { /* ignore */ }
    await new Promise((r) => server.close(r));
    sessionRegistry.clearForTests();
  });

  it('probe com session.busy → skipped, sessão permanece CONNECTED', async () => {
    await connectionManager.connect({
      host: '127.0.0.1',
      porta,
      persistir: true,
      timeoutMs: 2000
    });
    const session = connectionManager.getSession({ host: '127.0.0.1', porta });
    assert.ok(session);
    markBusy({ host: '127.0.0.1', porta }, OP_BUSY.UPLOAD);
    assert.equal(session.busy, true);

    const probe = await executarProbe(
      { id: 991510, ip: '127.0.0.1', porta_tcp: porta, transporte: 'ethernet' },
      { timeout_ms: 1500, tipo_teste: 'TCP_CONNECT' }
    );

    assert.equal(probe.skipped, true);
    assert.equal(probe.motivo, 'session_busy');
    assert.equal(probe.sucesso, true);
    assert.equal(connectionManager.isConnected({ host: '127.0.0.1', porta }), true);
    assert.equal(session.connected, true);

    clearBusy({ host: '127.0.0.1', porta }, OP_BUSY.UPLOAD);
  });

  it('disconnect sem force falha com SESSION_BUSY', async () => {
    const session = connectionManager.getSession({ host: '127.0.0.1', porta });
    await withBusy({ host: '127.0.0.1', porta }, OP_BUSY.DOWNLOAD, async () => {
      assert.equal(session.busy, true);
      await assert.rejects(
        () => connectionManager.disconnect({ host: '127.0.0.1', porta }),
        (err) => err.code === 'SESSION_BUSY'
      );
      assert.equal(connectionManager.isConnected({ host: '127.0.0.1', porta }), true);
    });
  });

  it('sessão persistente: transport legado NÃO chama CM.disconnect', async () => {
    await connectionManager.connect({
      host: '127.0.0.1',
      porta,
      persistir: true,
      timeoutMs: 2000
    });
    const session = connectionManager.getSession({ host: '127.0.0.1', porta });
    assert.ok(session);
    session.setPersistent(true);
    assert.equal(podeHeartbeatDisconnect(session), false);

    const LegacyEthernet = require('../../backend/motores/equipamentos/transport/EthernetTransport');
    const legacy = new LegacyEthernet({
      host: '127.0.0.1',
      porta,
      persistir: true
    });
    legacy._delegado = true;
    await legacy.desconectar();

    assert.equal(connectionManager.isConnected({ host: '127.0.0.1', porta }), true);
    assert.equal(session.connected, true);
    assert.equal(session.persistent, true);

    const probe = await executarProbe(
      { ip: '127.0.0.1', porta_tcp: porta, transporte: 'ethernet' },
      { timeout_ms: 1500, tipo_teste: 'TCP_CONNECT' }
    );
    assert.equal(probe.reused_session, true);
    assert.equal(connectionManager.isConnected({ host: '127.0.0.1', porta }), true);
  });
});

describe('RC15.10 — código', () => {
  it('HeartbeatProbe não chama EthernetTransport.disconnect no path oficial', () => {
    const src = read('backend/motores/equipamentos/monitor/HeartbeatProbe.js');
    assert.match(src, /session_busy|SessionBusy|RC15\.10/);
    assert.match(src, /probeEphemeralTcp/);
    assert.doesNotMatch(src, /transport\.disconnect/);
    assert.doesNotMatch(src, /cm\.disconnect/);
  });

  it('CM heartbeat respeita busy / persistent', () => {
    const src = read('backend/motores/equipamentos/connection/ConnectionManager.js');
    assert.match(src, /deveSuspenderHeartbeat|podeHeartbeatDisconnect/);
    assert.match(src, /SESSION_BUSY/);
  });

  it('Upload/Download/Config/Diagnóstico marcam busy', () => {
    assert.match(read('backend/motores/equipamentos/drivers/toledo/plu/ToledoPluEngine.js'), /OP_BUSY\.UPLOAD|withBusy/);
    assert.match(read('backend/motores/equipamentos/drivers/toledo/sync/ToledoDownloadEngine.js'), /OP_BUSY\.DOWNLOAD|withBusy/);
    assert.match(read('backend/motores/equipamentos/drivers/toledo/configuration/ToledoConfigurationEngine.js'), /OP_BUSY\.CONFIG|withBusy/);
    assert.match(read('backend/motores/equipamentos/drivers/toledo/certificacao/ToledoDiagnostics.js'), /OP_BUSY\.DIAGNOSTICO|withBusy/);
  });
});
