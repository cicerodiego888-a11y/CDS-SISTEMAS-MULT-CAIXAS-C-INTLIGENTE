/**
 * Sprint 14.6 — Testes Motor de Operações Toledo V1.0
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

const OperationQueue = require('../../backend/motores/equipamentos/drivers/toledo/operations/OperationQueue');
const OperationRepository = require('../../backend/motores/equipamentos/drivers/toledo/operations/OperationRepository');
const OperationResult = require('../../backend/motores/equipamentos/drivers/toledo/operations/OperationResult');
const OperationContext = require('../../backend/motores/equipamentos/drivers/toledo/operations/OperationContext');
const ToledoOperation = require('../../backend/motores/equipamentos/drivers/toledo/operations/ToledoOperation');
const { PingOperation, HandshakeOperation, IdentifyOperation } = require('../../backend/motores/equipamentos/drivers/toledo/operations/operations');
const { ToledoOperationEngine } = require('../../backend/motores/equipamentos/drivers/toledo/operations/ToledoOperationEngine');
const { CODES } = require('../../backend/motores/equipamentos/drivers/toledo/operations/OperationErrors');
const OperationController = require('../../backend/motores/equipamentos/drivers/toledo/operations/OperationController');
const frameBuilder = require('../../backend/motores/equipamentos/drivers/toledo/ToledoFrameBuilder');

function mockDriver() {
  return {
    host: '10.0.0.170',
    porta: 9000,
    _online: true,
    isOnline() { return this._online; },
    async connect() {
      this._online = true;
      return { status: 'CONNECTED', handshake: true, latencia: 1, driver: 'TOLEDO_PRIX4_UNO' };
    },
    async disconnect() { this._online = false; },
    async handshake() {
      const ack = frameBuilder.buildAck({ ok: true });
      return { ok: true, latencia: 2, frame: { raw: ack, comando: 'AK' } };
    },
    async ping() {
      const ack = frameBuilder.buildAck({ ok: true });
      return { ok: true, frame: { raw: ack, comando: 'AK', isAck: true } };
    }
  };
}

describe('Operations V1 — Queue FIFO', () => {
  it('executa uma por vez na mesma conexão', async () => {
    const q = new OperationQueue();
    const ordem = [];
    const p1 = q.enqueue('10.0.0.1:9000', async () => {
      ordem.push('a-start');
      await new Promise((r) => setTimeout(r, 40));
      ordem.push('a-end');
      return 'A';
    });
    const p2 = q.enqueue('10.0.0.1:9000', async () => {
      ordem.push('b-start');
      ordem.push('b-end');
      return 'B';
    });
    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(a, 'A');
    assert.equal(b, 'B');
    assert.deepEqual(ordem, ['a-start', 'a-end', 'b-start', 'b-end']);
  });
});

describe('Operations V1 — Repository', () => {
  it('persiste histórico', async () => {
    const repo = new OperationRepository();
    const id = `op${Date.now().toString(36)}`;
    await repo.salvar(new OperationResult({
      success: true,
      operation: 'PING',
      operationId: id,
      status: 'SUCCESS',
      duration: 3,
      bytesSent: 10,
      bytesReceived: 8
    }), {
      id,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      host: '10.0.0.170',
      porta: 9000
    });
    const hist = await repo.historico({ host: '10.0.0.170', porta: 9000, limite: 10 });
    assert.ok(hist.some((r) => r.id === id && r.operation === 'PING'));
  });
});

describe('Operations V1 — Ping / Handshake / Identify', () => {
  it('PingOperation via driver mock', async () => {
    const op = new PingOperation({ timeout: 1000 });
    const ctx = new OperationContext({ host: '10.0.0.170', porta: 9000, driver: mockDriver() });
    const r = await op.execute(ctx);
    assert.equal(r.success, true);
    assert.equal(r.operation, 'PING');
    assert.equal(r.data.ping, true);
  });

  it('HandshakeOperation reutiliza driver', async () => {
    const op = new HandshakeOperation({ timeout: 1000 });
    const ctx = new OperationContext({ host: '10.0.0.170', porta: 9000, driver: mockDriver() });
    const r = await op.execute(ctx);
    assert.equal(r.success, true);
    assert.equal(r.data.handshake, true);
  });

  it('IdentifyOperation retorna TOLEDO PRIX IV UNO', async () => {
    const op = new IdentifyOperation({ timeout: 1000 });
    const ctx = new OperationContext({ host: '10.0.0.170', porta: 9000, driver: mockDriver() });
    const r = await op.execute(ctx);
    assert.equal(r.success, true);
    assert.equal(r.data.identify, 'TOLEDO PRIX IV UNO');
    assert.equal(r.data.driver, 'TOLEDO_PRIX4_UNO');
  });
});

describe('Operations V1 — Engine', () => {
  let engine;

  beforeEach(() => {
    const drivers = new Map();
    engine = new ToledoOperationEngine({
      persistir: false,
      drivers,
      driverFactory: (host, porta) => {
        const d = mockDriver();
        d.host = host;
        d.porta = porta;
        return d;
      },
      repository: {
        async salvar() { return null; },
        async historico() { return []; }
      }
    });
  });

  it('execute PING / IDENTIFY / HANDSHAKE', async () => {
    const ping = await engine.ping({ host: '10.0.0.170', porta: 9000, persistir: false });
    assert.equal(ping.success, true);
    const hs = await engine.handshake({ host: '10.0.0.170', porta: 9000, persistir: false });
    assert.equal(hs.success, true);
    const id = await engine.identify({ host: '10.0.0.170', porta: 9000, persistir: false });
    assert.equal(id.success, true);
    assert.equal(id.data.identify, 'TOLEDO PRIX IV UNO');
  });

  it('timeout na operação', async () => {
    class SlowOp extends ToledoOperation {
      static get OPERATION() { return 'PING'; }
      constructor() { super({ operation: 'PING', timeout: 50 }); }
      async run() {
        await new Promise((r) => setTimeout(r, 200));
        return { ok: true };
      }
    }
    const op = new SlowOp();
    const ctx = new OperationContext({ host: '1.1.1.1', porta: 1, driver: mockDriver() });
    const r = await op.execute(ctx);
    assert.equal(r.success, false);
    assert.equal(r.error, CODES.TIMEOUT);
  });

  it('cancelamento', async () => {
    const op = new PingOperation({ timeout: 2000 });
    op.cancel();
    const ctx = new OperationContext({ host: '10.0.0.170', porta: 9000, driver: mockDriver() });
    const r = await op.execute(ctx);
    assert.equal(r.success, false);
    assert.equal(r.status, 'CANCELLED');
  });

  it('history via engine', async () => {
    const repo = new OperationRepository();
    const eng = new ToledoOperationEngine({
      persistir: true,
      repository: repo,
      driverFactory: () => mockDriver()
    });
    const r = await eng.ping({ host: '10.0.0.199', porta: 9000, persistir: true });
    assert.equal(r.success, true);
    const hist = await eng.history({ host: '10.0.0.199', porta: 9000, limite: 5 });
    assert.ok(hist.some((h) => h.operation === 'PING'));
  });
});

describe('Operations V1 — API', () => {
  it('POST ping/identify e GET history', async () => {
    const { ToledoOperationEngine: Eng } = require('../../backend/motores/equipamentos/drivers/toledo/operations/ToledoOperationEngine');
    const eng = new Eng({
      persistir: false,
      driverFactory: () => mockDriver(),
      repository: {
        async salvar() { return null; },
        async historico() {
          return [{
            id: 'x1',
            operation: 'PING',
            status: 'SUCCESS',
            duration: 2,
            finished_at: new Date().toISOString()
          }];
        }
      }
    });

    const app = express();
    app.use(express.json());
    app.post('/api/equipamentos/operations/ping', async (req, res) => {
      const r = await eng.ping({ ...req.body, persistir: false });
      res.json(r.paraApi());
    });
    app.post('/api/equipamentos/operations/identify', async (req, res) => {
      const r = await eng.identify({ ...req.body, persistir: false });
      res.json(r.paraApi());
    });
    app.get('/api/equipamentos/operations/history', async (req, res) => {
      const historico = await eng.history({});
      res.json({ success: true, historico });
    });

    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;

    try {
      const ping = await fetch(`${base}/api/equipamentos/operations/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: '10.0.0.170', porta: 9000 })
      });
      assert.equal(ping.status, 200);
      const pingBody = await ping.json();
      assert.equal(pingBody.success, true);
      assert.equal(pingBody.operation, 'PING');

      const id = await fetch(`${base}/api/equipamentos/operations/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: '10.0.0.170', porta: 9000 })
      });
      assert.equal(id.status, 200);
      const idBody = await id.json();
      assert.equal(idBody.data.identify, 'TOLEDO PRIX IV UNO');

      const hist = await fetch(`${base}/api/equipamentos/operations/history`);
      assert.equal(hist.status, 200);
      const histBody = await hist.json();
      assert.ok(Array.isArray(histBody.historico));
    } finally {
      await new Promise((r) => {
        server.close(() => r());
        setTimeout(r, 300);
      });
    }

    assert.equal(typeof OperationController.ping, 'function');
  });
});
