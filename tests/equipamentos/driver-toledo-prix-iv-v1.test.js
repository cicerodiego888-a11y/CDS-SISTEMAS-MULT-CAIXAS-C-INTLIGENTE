/**
 * Sprint 14.4 — Testes Driver Toledo Prix IV Uno V1.0
 */
'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const http = require('http');
const express = require('express');

const ToledoProtocol = require('../../backend/motores/equipamentos/drivers/toledo/ToledoProtocol');
const frameBuilder = require('../../backend/motores/equipamentos/drivers/toledo/ToledoFrameBuilder');
const frameParser = require('../../backend/motores/equipamentos/drivers/toledo/ToledoFrameParser');
const ToledoHandshake = require('../../backend/motores/equipamentos/drivers/toledo/ToledoHandshake');
const { getCapabilities, CAPABILITIES_V1 } = require('../../backend/motores/equipamentos/drivers/toledo/ToledoCapabilities');
const { ToledoError, CODES } = require('../../backend/motores/equipamentos/drivers/toledo/ToledoErrors');
const ToledoPrixIVDriver = require('../../backend/motores/equipamentos/drivers/toledo/ToledoPrixIVDriver');
const ToledoDriverController = require('../../backend/motores/equipamentos/drivers/toledo/ToledoDriverController');
const { ConnectionManager } = require('../../backend/motores/equipamentos/connection/ConnectionManager');
const ConnectionPool = require('../../backend/motores/equipamentos/connection/ConnectionPool');

/**
 * Servidor TCP que responde ACK ao handshake/ping (formato V1 com checksum).
 */
function startToledoMockServer() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on('data', (buf) => {
        try {
          const parsed = frameParser.parse(buf);
          if (parsed.comando === ToledoProtocol.COMMANDS.HANDSHAKE
            || parsed.comando === ToledoProtocol.COMMANDS.PING) {
            const ack = frameBuilder.buildAck({
              ok: true,
              firmware: '90AX-sim',
              echo: parsed.comando
            });
            socket.write(ack);
          }
        } catch (_) {
          // frame inválido — não responde (timeout no cliente)
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, host: '127.0.0.1', port: server.address().port });
    });
  });
}

describe('Toledo V1.0 — Protocol', () => {
  it('centraliza COMMANDS/RESPONSES/LIMITS', () => {
    assert.equal(ToledoProtocol.DRIVER, 'TOLEDO_PRIX4_UNO');
    assert.equal(ToledoProtocol.COMMANDS.HANDSHAKE, 'HS');
    assert.equal(ToledoProtocol.RESPONSES.ACK, 'AK');
    assert.ok(ToledoProtocol.LIMITS.handshakeTimeoutMs > 0);
  });
});

describe('Toledo V1.0 — Errors', () => {
  it('expõe códigos e ToledoError', () => {
    assert.equal(CODES.CHECKSUM_ERROR, 'CHECKSUM_ERROR');
    const err = ToledoError.fromCode(CODES.INVALID_FRAME, 'x');
    assert.equal(err.code, 'INVALID_FRAME');
    assert.ok(err instanceof Error);
  });
});

describe('Toledo V1.0 — FrameBuilder', () => {
  it('build/checksum/encode', () => {
    const buf = frameBuilder.build('HS', { a: 1 });
    assert.equal(buf[0], ToledoProtocol.STX);
    assert.equal(buf[buf.length - 1], ToledoProtocol.ETX);
    const body = buf.subarray(1, buf.length - 1 - 2);
    const chk = buf.subarray(buf.length - 1 - 2, buf.length - 1).toString('ascii');
    assert.equal(chk, frameBuilder.checksum(body));
    assert.ok(Buffer.isBuffer(frameBuilder.encode({ x: 1 })));
  });
});

describe('Toledo V1.0 — FrameParser', () => {
  it('parse/validate frame válido', () => {
    const raw = frameBuilder.buildHandshake();
    const parsed = frameParser.parse(raw);
    assert.equal(parsed.comando, 'HS');
    assert.equal(frameParser.validate(raw).ok, true);
  });

  it('invalid frame', () => {
    const v = frameParser.validate(Buffer.from([0x01, 0x02]));
    assert.equal(v.ok, false);
    assert.equal(v.code, CODES.INVALID_FRAME);
  });

  it('checksum error', () => {
    const raw = frameBuilder.build('HS', { a: 1 });
    const mut = Buffer.from(raw);
    mut[mut.length - 2] = mut[mut.length - 2] === 0x30 ? 0x31 : 0x30;
    assert.throws(() => frameParser.parse(mut), (err) => err.code === CODES.CHECKSUM_ERROR);
  });
});

describe('Toledo V1.0 — Capabilities', () => {
  it('retorna capabilities homologadas (V2 / Sprints 14.x)', () => {
    const c = getCapabilities();
    assert.equal(c.driver, 'TOLEDO_PRIX4_UNO');
    assert.deepEqual(c.capabilities, { ...CAPABILITIES_V1 });
    assert.equal(c.capabilities.handshake, true);
    assert.equal(c.capabilities.ping, true);
    assert.equal(c.capabilities.uploadPLU, true);
    assert.equal(c.capabilities.downloadPLU, true);
    assert.equal(c.capabilities.syncPLU, true);
    assert.equal(c.capabilities.readWeight, true);
    assert.equal(c.capabilities.monitor, true);
    assert.equal(c.capabilities.downloadConfig, true);
    assert.equal(c.capabilities.writeConfig, true);
    assert.equal(c.capabilities.writeLabel, false);
    assert.equal(c.capabilities.firmwareUpdate, false);
    assert.equal(c.capabilities.autoReconnect, false);
  });
});

describe('Toledo V1.0 — Handshake', () => {
  it('valida ACK e falha em timeout', async () => {
    const ack = frameBuilder.buildAck({ ok: true });
    const ok = await ToledoHandshake.executar({
      sendFrame: async () => {},
      receiveFrame: async () => ack
    });
    assert.equal(ok.ok, true);

    await assert.rejects(
      () => ToledoHandshake.executar({
        sendFrame: async () => {},
        receiveFrame: async () => null
      }, { timeoutMs: 50 }),
      (err) => err.code === CODES.CONNECTION_TIMEOUT
    );
  });
});

describe('Toledo V1.0 — Driver + ConnectionManager', () => {
  let mock;
  let cm;
  let driver;

  before(async () => {
    mock = await startToledoMockServer();
  });

  after(async () => {
    await new Promise((r) => mock.server.close(r));
  });

  beforeEach(() => {
    cm = new ConnectionManager({
      pool: new ConnectionPool(),
      repository: { async salvar() { return null; } },
      timeoutMs: 1000
    });
    driver = new ToledoPrixIVDriver({ connectionManager: cm });
  });

  afterEach(async () => {
    try { await driver.disconnect(); } catch (_) { /* ignore */ }
  });

  it('connect com handshake via ConnectionManager (sem net direto no driver)', async () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../backend/motores/equipamentos/drivers/toledo/ToledoPrixIVDriver.js'),
      'utf8'
    );
    assert.equal(/require\(['"]net['"]\)/.test(src), false);
    assert.equal(/new net\.Socket/.test(src), false);

    const r = await driver.connect({
      host: mock.host,
      porta: mock.port,
      persistir: false,
      handshakeTimeoutMs: 1500
    });
    assert.equal(r.driver, 'TOLEDO_PRIX4_UNO');
    assert.equal(r.status, 'CONNECTED');
    assert.equal(r.handshake, true);
    assert.ok(typeof r.latencia === 'number');
    assert.equal(driver.isOnline(), true);
  });

  it('ping após connect', async () => {
    await driver.connect({
      host: mock.host,
      porta: mock.port,
      persistir: false
    });
    const p = await driver.ping();
    assert.equal(p.ok, true);
  });

  it('timeout quando dispositivo não responde handshake', async () => {
    const silent = await new Promise((resolve) => {
      const server = net.createServer((socket) => {
        // Aceita e ignora — força timeout no handshake do driver
        socket.on('error', () => { /* ignore */ });
      });
      server.listen(0, '127.0.0.1', () => {
        resolve({ server, host: '127.0.0.1', port: server.address().port });
      });
    });
    try {
      await assert.rejects(
        () => driver.connect({
          host: silent.host,
          porta: silent.port,
          persistir: false,
          handshakeTimeoutMs: 250
        }),
        (err) => {
          // Implementação atual: TimeoutError do 90AXEngine, ou codes Toledo clássicos
          const code = err && err.code;
          const name = err && err.name;
          const msg = String(err && err.message || '');
          return code === CODES.CONNECTION_TIMEOUT
            || code === CODES.DEVICE_OFFLINE
            || code === CODES.HANDSHAKE_FAILED
            || name === 'TimeoutError'
            || /timeout/i.test(msg);
        }
      );
    } finally {
      try {
        if (typeof silent.server.closeAllConnections === 'function') {
          silent.server.closeAllConnections();
        }
      } catch (_) { /* ignore */ }
      await new Promise((r) => {
        silent.server.close(() => r());
        setTimeout(r, 500);
      });
    }
  });
});

describe('Toledo V1.0 — API', () => {
  let mock;
  let server;
  let baseUrl;
  let cm;

  before(async () => {
    mock = await startToledoMockServer();
    cm = new ConnectionManager({
      pool: new ConnectionPool(),
      repository: { async salvar() { return null; } },
      timeoutMs: 1000
    });
    ToledoDriverController._resetSessions();

    const app = express();
    app.use(express.json());

    // Usa controller real com driver injetável via getOrCreate + patch
    const originalGet = ToledoDriverController.getOrCreateDriver;
    ToledoDriverController.getOrCreateDriver = (host, porta) => {
      const d = originalGet(host, porta);
      d.cm = cm;
      return d;
    };

    app.post('/api/equipamentos/driver/toledo/connect', ToledoDriverController.connect);
    app.get('/api/equipamentos/driver/toledo/capabilities', ToledoDriverController.capabilities);
    app.post('/api/equipamentos/driver/toledo/disconnect', ToledoDriverController.disconnect);

    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    try {
      await fetch(`${baseUrl}/api/equipamentos/driver/toledo/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: mock.host, porta: mock.port })
      });
    } catch (_) { /* ignore */ }
    ToledoDriverController._resetSessions();
    try {
      await cm.disconnect({ host: mock.host, porta: mock.port });
    } catch (_) { /* ignore */ }
    await new Promise((r) => {
      try {
        if (typeof mock.server.closeAllConnections === 'function') mock.server.closeAllConnections();
      } catch (_) { /* ignore */ }
      server.close(() => {});
      mock.server.close(() => r());
      setTimeout(r, 400);
    });
  });

  it('POST connect → driver CONNECTED + handshake', async () => {
    const resp = await fetch(`${baseUrl}/api/equipamentos/driver/toledo/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: mock.host, porta: mock.port, persistir: false })
    });
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.deepEqual(
      { driver: json.driver, status: json.status, handshake: json.handshake },
      { driver: 'TOLEDO_PRIX4_UNO', status: 'CONNECTED', handshake: true }
    );
    assert.ok(typeof json.latencia === 'number');

    const disc = await fetch(`${baseUrl}/api/equipamentos/driver/toledo/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: mock.host, porta: mock.port })
    });
    assert.equal(disc.status, 200);
  });

  it('GET capabilities', async () => {
    const resp = await fetch(`${baseUrl}/api/equipamentos/driver/toledo/capabilities`);
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.driver, 'TOLEDO_PRIX4_UNO');
    assert.deepEqual(json.capabilities, { ...CAPABILITIES_V1 });
    assert.equal(json.capabilities.uploadPLU, true);
    assert.equal(json.capabilities.readWeight, true);
    assert.equal(json.capabilities.handshake, true);
    assert.equal(json.capabilities.monitor, true);
  });
});
