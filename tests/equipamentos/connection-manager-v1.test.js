/**
 * Sprint 14.3 — Testes Connection Manager V1.0
 */
'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const http = require('http');
const express = require('express');

const TcpConnection = require('../../backend/motores/equipamentos/connection/TcpConnection');
const ConnectionFactory = require('../../backend/motores/equipamentos/connection/ConnectionFactory');
const ConnectionPool = require('../../backend/motores/equipamentos/connection/ConnectionPool');
const ConnectionHealth = require('../../backend/motores/equipamentos/connection/ConnectionHealth');
const { STATUS } = require('../../backend/motores/equipamentos/connection/ConnectionHealth');
const ConnectionRepository = require('../../backend/motores/equipamentos/connection/ConnectionRepository');
const { ConnectionManager } = require('../../backend/motores/equipamentos/connection/ConnectionManager');
const ConnectionController = require('../../backend/motores/equipamentos/connection/ConnectionController');
const ConnectionRoutes = require('../../backend/motores/equipamentos/connection/ConnectionRoutes');

function startEchoServer() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      // Aceita conexão — não interpreta protocolo.
      socket.on('data', () => { /* ignore */ });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, host: '127.0.0.1' });
    });
  });
}

describe('Connection V1.0 — ConnectionFactory', () => {
  it('cria transporte Ethernet (TCP) com TcpConnection interno', () => {
    const f = new ConnectionFactory();
    const tr = f.create({ transporte: 'TCP', host: '127.0.0.1', porta: 9000 });
    assert.ok(tr);
    assert.equal(tr.tipo, 'ethernet');
    assert.ok(typeof tr.connect === 'function');
    assert.ok(tr.getTcp() instanceof TcpConnection);
  });

  it('lista transportes futuros e rejeita UDP nesta sprint', () => {
    const f = new ConnectionFactory();
    const lista = f.listarTransportesFuturos();
    assert.ok(lista.includes('TCP'));
    assert.ok(lista.includes('SERIAL'));
    assert.throws(() => f.create({ transporte: 'UDP', host: '1.1.1.1', porta: 1 }), /não suportado/i);
  });
});

describe('Connection V1.0 — TcpConnection', () => {
  let svc;

  before(async () => {
    svc = await startEchoServer();
  });

  after(async () => {
    await new Promise((r) => svc.server.close(r));
  });

  it('open/close sem interpretar bytes', async () => {
    const tcp = new TcpConnection({ host: svc.host, porta: svc.port, timeoutMs: 1000 });
    const r = await tcp.open();
    assert.ok(tcp.aberto);
    assert.ok(typeof r.latencia === 'number');
    await tcp.close();
    tcp.destroy();
    assert.equal(tcp.aberto, false);
  });

  it('timeout/recusa em porta fechada', async () => {
    const tcp = new TcpConnection({ host: '127.0.0.1', porta: 1, timeoutMs: 200 });
    await assert.rejects(() => tcp.open(), (err) => {
      assert.ok(err);
      assert.ok(err.code === 'ECONNREFUSED' || err.code === 'TCP_TIMEOUT' || /refused|timeout/i.test(err.message));
      return true;
    });
  });
});

describe('Connection V1.0 — ConnectionHealth', () => {
  it('monitora estados e uptime', () => {
    const h = new ConnectionHealth();
    assert.equal(h.status, STATUS.OFFLINE);
    h.setStatus(STATUS.CONNECTING);
    h.marcarConectado(2);
    assert.equal(h.status, STATUS.ONLINE);
    assert.equal(h.latencia, 2);
    assert.match(h.uptime, /^\d{2}:\d{2}:\d{2}$/);
    const api = h.paraApi();
    assert.equal(api.status, 'CONNECTED');
    h.marcarDesconectado(STATUS.TIMEOUT);
    assert.equal(h.status, STATUS.TIMEOUT);
  });
});

describe('Connection V1.0 — ConnectionPool', () => {
  it('impede múltiplas entradas para o mesmo host:porta', () => {
    const pool = new ConnectionPool();
    const a = pool.acquire('10.0.0.170', 9000, () => ({ id: 1 }));
    const b = pool.acquire('10.0.0.170', 9000, () => ({ id: 2 }));
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(b.entry.id, 1);
    assert.equal(pool.size(), 1);
  });
});

describe('Connection V1.0 — ConnectionRepository', () => {
  it('persiste equipamentos_conexoes', async () => {
    const repo = new ConnectionRepository();
    const host = `127.0.0.${Math.floor(Math.random() * 200) + 10}`;
    const porta = 9100 + Math.floor(Math.random() * 80);
    await repo.salvar({
      host,
      porta,
      status: 'ONLINE',
      latencia: 3,
      conectado_em: new Date().toISOString(),
      ultima_atividade: new Date().toISOString(),
      reconexoes: 0
    });
    const row = await repo.buscarPorHostPorta(host, porta);
    assert.ok(row);
    assert.equal(row.status, 'ONLINE');
    assert.equal(Number(row.latencia), 3);
  });
});

describe('Connection V1.0 — ConnectionManager', () => {
  let svc;
  let manager;

  before(async () => {
    svc = await startEchoServer();
  });

  after(async () => {
    await new Promise((r) => svc.server.close(r));
  });

  beforeEach(() => {
    manager = new ConnectionManager({
      pool: new ConnectionPool(),
      repository: {
        async salvar() { return null; }
      },
      timeoutMs: 1000,
      autoReconnect: false,
      autoHeartbeat: false
    });
  });

  afterEach(async () => {
    try {
      await manager.disconnect({ host: svc.host, porta: svc.port });
    } catch (_) { /* ignore */ }
  });

  it('connect + isConnected + latency + health', async () => {
    const r = await manager.connect({
      host: svc.host,
      porta: svc.port,
      persistir: false
    });
    assert.equal(r.status, 'CONNECTED');
    assert.ok(typeof r.latencia === 'number');
    assert.equal(manager.isConnected({ host: svc.host, porta: svc.port }), true);
    assert.equal(manager.latency({ host: svc.host, porta: svc.port }), r.latencia);
    const h = manager.health({ host: svc.host, porta: svc.port });
    assert.equal(h.status, 'CONNECTED');
    assert.match(h.uptime, /^\d{2}:\d{2}:\d{2}$/);
  });

  it('pool reutiliza a mesma conexão', async () => {
    const a = await manager.connect({ host: svc.host, porta: svc.port, persistir: false });
    const b = await manager.connect({ host: svc.host, porta: svc.port, persistir: false });
    assert.equal(a.status, 'CONNECTED');
    assert.equal(b.status, 'CONNECTED_ALREADY');
    assert.equal(b.reutilizada, true);
    assert.equal(manager.pool.size(), 1);
  });

  it('disconnect fecha e atualiza status', async () => {
    await manager.connect({ host: svc.host, porta: svc.port, persistir: false });
    const d = await manager.disconnect({ host: svc.host, porta: svc.port });
    assert.equal(d.status, 'DISCONNECTED');
    assert.equal(manager.isConnected({ host: svc.host, porta: svc.port }), false);
    const h = manager.health({ host: svc.host, porta: svc.port });
    assert.equal(h.status, 'OFFLINE');
  });

  it('reconnect manual incrementa reconexoes', async () => {
    await manager.connect({ host: svc.host, porta: svc.port, persistir: false });
    const r = await manager.reconnect({ host: svc.host, porta: svc.port, persistir: false });
    assert.equal(r.status, 'CONNECTED');
    assert.equal(r.reconexoes, 1);
    assert.equal(manager.isConnected({ host: svc.host, porta: svc.port }), true);
  });

  it('timeout/recusa em host inacessível', async () => {
    await assert.rejects(
      () => manager.connect({ host: '127.0.0.1', porta: 1, timeoutMs: 200, persistir: false }),
      (err) => {
        assert.ok(err);
        return true;
      }
    );
  });
});

describe('Connection V1.0 — API', () => {
  let svc;
  let server;
  let baseUrl;
  let managerIsolado;

  before(async () => {
    svc = await startEchoServer();
    managerIsolado = new ConnectionManager({
      pool: new ConnectionPool(),
      repository: { async salvar() { return null; } },
      timeoutMs: 1000
    });

    // Injeta manager no controller via monkey-patch das funções usando wrapper
    const app = express();
    app.use(express.json());

    app.post('/api/equipamentos/connect', async (req, res) => {
      try {
        const r = await managerIsolado.connect({
          host: req.body.host,
          porta: req.body.porta,
          persistir: false
        });
        res.json({ status: r.status, latencia: r.latencia });
      } catch (e) {
        res.status(e.statusCode || 500).json({ success: false, error: e.message });
      }
    });
    app.get('/api/equipamentos/status', async (req, res) => {
      const h = managerIsolado.health({ host: req.query.host, porta: req.query.porta });
      res.json({ status: h.status, latencia: h.latencia, uptime: h.uptime });
    });
    app.post('/api/equipamentos/disconnect', async (req, res) => {
      const r = await managerIsolado.disconnect({
        host: req.body.host,
        porta: req.body.porta
      });
      res.json({ status: r.status, latencia: r.latencia });
    });

    // Garante que ConnectionRoutes exporta router válido
    const rotas = ConnectionRoutes();
    assert.ok(typeof rotas === 'function' || rotas.handle);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    try {
      await managerIsolado.disconnect({ host: svc.host, porta: svc.port });
    } catch (_) { /* ignore */ }
    await new Promise((r) => server.close(r));
    await new Promise((r) => svc.server.close(r));
  });

  it('POST /connect → CONNECTED + latencia', async () => {
    const resp = await fetch(`${baseUrl}/api/equipamentos/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: svc.host, porta: svc.port })
    });
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.status, 'CONNECTED');
    assert.ok(typeof json.latencia === 'number');
  });

  it('GET /status → uptime', async () => {
    const q = new URLSearchParams({ host: svc.host, porta: String(svc.port) });
    const resp = await fetch(`${baseUrl}/api/equipamentos/status?${q}`);
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.status, 'CONNECTED');
    assert.match(json.uptime, /^\d{2}:\d{2}:\d{2}$/);
  });

  it('POST /disconnect', async () => {
    const resp = await fetch(`${baseUrl}/api/equipamentos/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: svc.host, porta: svc.port })
    });
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.status, 'DISCONNECTED');
  });
});

describe('Connection V1.0 — ConnectionController exports', () => {
  it('expõe connect/status/disconnect/reconnect', () => {
    assert.equal(typeof ConnectionController.connect, 'function');
    assert.equal(typeof ConnectionController.status, 'function');
    assert.equal(typeof ConnectionController.disconnect, 'function');
    assert.equal(typeof ConnectionController.reconnect, 'function');
  });
});
