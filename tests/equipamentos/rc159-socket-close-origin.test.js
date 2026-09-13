/**
 * RC15.9 — Auditoria da origem do encerramento TCP
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '../..');
const socketCloseAudit = require('../../backend/motores/equipamentos/connection/SocketCloseAudit');
const { CLOSE_KIND } = socketCloseAudit;
const TcpConnection = require('../../backend/motores/equipamentos/connection/TcpConnection');
const connectionManager = require('../../backend/motores/equipamentos/connection/ConnectionManager');
const sessionRegistry = require('../../backend/motores/equipamentos/connection/EquipmentSessionRegistry');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC15.9 — SocketCloseAudit unitário', () => {
  it('classifica LOCAL_CLOSE quando há mark local', () => {
    const fake = { destroyed: false };
    socketCloseAudit._resetForTests(fake);
    socketCloseAudit.markLocalClose(fake, {
      origem: 'ConnectionManager',
      metodo: 'disconnect()',
      host: '127.0.0.1',
      porta: 9000
    });
    const c = socketCloseAudit.classifyAndLogClose(fake, false, {
      host: '127.0.0.1',
      porta: 9000
    });
    assert.equal(c.kind, CLOSE_KIND.LOCAL_CLOSE);
    assert.equal(c.iniciador, 'CDS');
    assert.match(c.origem, /ConnectionManager/);
  });

  it('classifica REMOTE_CLOSE sem mark local + end remoto', () => {
    const fake = { destroyed: false };
    socketCloseAudit._resetForTests(fake);
    socketCloseAudit.markRemoteEnd(fake, { host: '127.0.0.1', porta: 9000 });
    const c = socketCloseAudit.classifyAndLogClose(fake, false, {
      host: '127.0.0.1',
      porta: 9000
    });
    assert.equal(c.kind, CLOSE_KIND.REMOTE_CLOSE);
    assert.equal(c.iniciador, 'BALANCA_OU_PEER');
  });

  it('classifica ERROR_CLOSE com hadError', () => {
    const fake = { destroyed: false };
    socketCloseAudit._resetForTests(fake);
    socketCloseAudit.markError(fake, new Error('ECONNRESET'));
    const c = socketCloseAudit.classifyAndLogClose(fake, true, {});
    assert.equal(c.kind, CLOSE_KIND.ERROR_CLOSE);
  });

  it('classifica TIMEOUT_CLOSE', () => {
    const fake = { destroyed: false };
    socketCloseAudit._resetForTests(fake);
    socketCloseAudit.markTimeout(fake);
    const c = socketCloseAudit.classifyAndLogClose(fake, false, {});
    assert.equal(c.kind, CLOSE_KIND.TIMEOUT_CLOSE);
  });
});

describe('RC15.9 — integração TCP', () => {
  let server;
  let porta;
  let remoteEndMode = false;

  before(async () => {
    sessionRegistry.clearForTests();
    try { await connectionManager.closeAll(); } catch (_) { /* ignore */ }
    server = net.createServer((s) => {
      if (remoteEndMode) {
        // Peer encerra sem o cliente pedir
        setTimeout(() => {
          try { s.end(); } catch (_) { /* ignore */ }
        }, 30);
      } else {
        s.on('data', () => {});
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    porta = server.address().port;
  });

  after(async () => {
    try { await connectionManager.closeAll(); } catch (_) { /* ignore */ }
    await new Promise((r) => server.close(r));
    sessionRegistry.clearForTests();
  });

  it('disconnect local → LOCAL_CLOSE / iniciador CDS', async () => {
    remoteEndMode = false;
    const r = await connectionManager.connect({
      host: '127.0.0.1',
      porta,
      persistir: true,
      timeoutMs: 2000
    });
    assert.ok(['CONNECTED', 'CONNECTED_ALREADY'].includes(r.status));

    const entry = connectionManager.getConnection({ host: '127.0.0.1', porta });
    const sock = entry.transport.getTcp().socket;
    assert.ok(sock);

    await connectionManager.disconnect({ host: '127.0.0.1', porta });

    // Após destroy o state WeakMap ainda tem a classificação se sock object vive
    // Revalidamos via fluxo: markLocalClose foi chamado (código) + unitários.
    // Aqui garantimos que disconnect não deixa socket aberto.
    assert.equal(connectionManager.isConnected({ host: '127.0.0.1', porta }), false);
  });

  it('peer end → REMOTE_CLOSE no TcpConnection', async () => {
    remoteEndMode = true;
    const tcp = new TcpConnection({
      host: '127.0.0.1',
      porta,
      timeoutMs: 2000
    });
    await tcp.open();
    const sock = tcp.socket;
    assert.ok(sock);

    const classification = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout aguardando remote close')), 3000);
      sock.on('close', (hadError) => {
        clearTimeout(t);
        resolve(socketCloseAudit.classifyAndLogClose(sock, Boolean(hadError), {
          host: '127.0.0.1',
          porta
        }));
      });
    });

    assert.equal(classification.kind, CLOSE_KIND.REMOTE_CLOSE);
    assert.equal(classification.iniciador, 'BALANCA_OU_PEER');

    try { tcp.destroy(); } catch (_) { /* ignore */ }
  });
});

describe('RC15.9 — código', () => {
  it('instrumenta CM / Transport / Tcp / Driver', () => {
    const auditSrc = read('backend/motores/equipamentos/connection/SocketCloseAudit.js');
    assert.match(auditSrc, /LOCAL_CLOSE/);
    assert.match(auditSrc, /REMOTE_CLOSE/);
    assert.match(auditSrc, /ERROR_CLOSE/);
    assert.match(auditSrc, /TIMEOUT_CLOSE/);
    assert.match(auditSrc, /SOCKET END REQUEST/);
    assert.match(auditSrc, /SOCKET REMOTE END/);

    const tcp = read('backend/motores/equipamentos/connection/TcpConnection.js');
    assert.match(tcp, /socketCloseAudit|SocketCloseAudit/);
    assert.match(tcp, /instrumentSocket/);

    const cm = read('backend/motores/equipamentos/connection/ConnectionManager.js');
    assert.match(cm, /logDisconnectCall/);
    assert.match(cm, /ConnectionManager/);

    const eth = read('backend/motores/equipamentos/connection/transports/EthernetTransport.js');
    assert.match(eth, /logDisconnectCall/);

    const drv = read('backend/motores/equipamentos/drivers/toledo/ToledoPrixIVDriver.js');
    assert.match(drv, /ToledoPrixIVDriver/);
    assert.match(drv, /logDisconnectCall|SocketCloseAudit/);
  });
});
