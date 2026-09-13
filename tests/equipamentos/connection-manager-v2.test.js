/**
 * Sprint 15.1 — Testes Connection Manager V2
 */
'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');

const { ConnectionManager } = require('../../backend/motores/equipamentos/connection/ConnectionManager');
const ConnectionPool = require('../../backend/motores/equipamentos/connection/ConnectionPool');
const ConnectionFactory = require('../../backend/motores/equipamentos/connection/ConnectionFactory');
const ConnectionStateMachine = require('../../backend/motores/equipamentos/connection/ConnectionStateMachine');
const { STATES } = require('../../backend/motores/equipamentos/connection/ConnectionStateMachine');
const ConnectionMetrics = require('../../backend/motores/equipamentos/connection/ConnectionMetrics');
const ConnectionHeartbeat = require('../../backend/motores/equipamentos/connection/ConnectionHeartbeat');
const connectionEvents = require('../../backend/motores/equipamentos/connection/ConnectionEvents');
const { EVENTS } = require('../../backend/motores/equipamentos/connection/ConnectionEvents');
const EthernetTransport = require('../../backend/motores/equipamentos/connection/transports/EthernetTransport');
const SerialTransport = require('../../backend/motores/equipamentos/connection/transports/SerialTransport');
const UsbTransport = require('../../backend/motores/equipamentos/connection/transports/UsbTransport');
const TcpConnection = require('../../backend/motores/equipamentos/connection/TcpConnection');

function startEchoServer() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on('data', (buf) => {
        // Echo para receive/ping testes
        try { socket.write(buf); } catch (_) { /* ignore */ }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, host: '127.0.0.1' });
    });
  });
}

function novoManager(extras = {}) {
  return new ConnectionManager({
    pool: new ConnectionPool(),
    repository: { async salvar() { return null; } },
    timeoutMs: 1000,
    autoReconnect: false,
    autoHeartbeat: false,
    ...extras
  });
}

describe('Connection V2 — StateMachine', () => {
  it('transita DISCONNECTED → CONNECTING → CONNECTED → BUSY → CONNECTED', () => {
    const fsm = new ConnectionStateMachine();
    assert.equal(fsm.estado, STATES.DISCONNECTED);
    fsm.transitar(STATES.CONNECTING);
    fsm.transitar(STATES.CONNECTED);
    fsm.transitar(STATES.BUSY);
    fsm.transitar(STATES.CONNECTED);
    assert.equal(fsm.ativo, true);
    assert.equal(fsm.estado, STATES.CONNECTED);
  });

  it('proíbe CONNECTING → IDLE (RC14.14.7)', () => {
    const fsm = new ConnectionStateMachine();
    fsm.transitar(STATES.CONNECTING);
    assert.throws(
      () => fsm.transitar(STATES.IDLE),
      /proibida|inválida/i
    );
  });

  it('rejeita transição inválida', () => {
    const fsm = new ConnectionStateMachine();
    assert.throws(() => fsm.transitar(STATES.BUSY), /inválida/i);
  });
});

describe('Connection V2 — Factory multi-transporte', () => {
  it('cria Ethernet / Serial / USB', () => {
    const f = new ConnectionFactory();
    const eth = f.create({ transporte: 'ethernet', host: '10.0.0.1', porta: 9000 });
    const ser = f.create({ transporte: 'serial', porta_com: 'COM3' });
    const usb = f.create({ transporte: 'usb', vid: '1234', pid: '5678' });
    assert.ok(eth instanceof EthernetTransport);
    assert.ok(ser instanceof SerialTransport);
    assert.ok(usb instanceof UsbTransport);
    assert.ok(eth.getTcp() instanceof TcpConnection);
  });
});

describe('Connection V2 — Metrics / Events / Heartbeat', () => {
  it('métricas acumulam bytes e latência', () => {
    const m = new ConnectionMetrics();
    m.marcarConectado(2);
    m.registrarEnvio(10);
    m.registrarRecebimento(20);
    m.registrarLatencia(5);
    const s = m.snapshot();
    assert.equal(s.pacotesEnviados, 1);
    assert.equal(s.bytesRecebidos, 20);
    assert.ok(s.latenciaMedia >= 2);
  });

  it('eventos tipados são emitidos', () => {
    let hit = false;
    const on = () => { hit = true; };
    connectionEvents.once(EVENTS.connected, on);
    connectionEvents.emitConnected({ host: '1.1.1.1' });
    assert.equal(hit, true);
  });

  it('heartbeat executa tick', async () => {
    let ticks = 0;
    const hb = new ConnectionHeartbeat({
      intervaloMs: 10000,
      onTick: async () => {
        ticks += 1;
        return { ok: true };
      }
    });
    await hb.tickAgora();
    assert.equal(ticks, 1);
    assert.equal(hb.ultimoOk, true);
  });
});

describe('Connection V2 — TCP connect / pool / send-receive', () => {
  let svc;
  let manager;

  before(async () => {
    svc = await startEchoServer();
  });

  after(async () => {
    await new Promise((r) => svc.server.close(r));
  });

  beforeEach(() => {
    manager = novoManager();
  });

  afterEach(async () => {
    try { await manager.closeAll(); } catch (_) { /* ignore */ }
  });

  it('conecta TCP e reutiliza socket', async () => {
    const a = await manager.connect({ host: svc.host, porta: svc.port, persistir: false });
    const b = await manager.connect({ host: svc.host, porta: svc.port, persistir: false });
    assert.equal(a.status, 'CONNECTED');
    assert.equal(b.reutilizada, true);
    assert.equal(manager.pool.size(), 1);
    assert.equal(manager.isConnected({ host: svc.host, porta: svc.port }), true);
  });

  it('send/receive via ConnectionManager', async () => {
    await manager.connect({ host: svc.host, porta: svc.port, persistir: false });
    const payload = Buffer.from([0x02, 0x48, 0x53, 0x03]);
    const n = await manager.send({ host: svc.host, porta: svc.port }, payload);
    assert.equal(n, payload.length);
    const rx = await manager.receive({ host: svc.host, porta: svc.port }, { timeoutMs: 500 });
    assert.ok(rx);
    assert.ok(Buffer.isBuffer(rx));
  });

  it('ping retorna ok com latência', async () => {
    await manager.connect({ host: svc.host, porta: svc.port, persistir: false });
    const r = await manager.ping({ host: svc.host, porta: svc.port });
    assert.equal(r.ok, true);
    assert.ok(r.latencia != null);
  });

  it('múltiplos equipamentos = múltiplas conexões', async () => {
    const svc2 = await startEchoServer();
    try {
      await manager.connect({ host: svc.host, porta: svc.port, persistir: false });
      await manager.connect({ host: svc2.host, porta: svc2.port, persistir: false });
      assert.equal(manager.pool.size(), 2);
      const lista = manager.listConnections();
      assert.equal(lista.length, 2);
      await manager.closeAll();
    } finally {
      await new Promise((r) => svc2.server.close(r));
    }
  });

  it('disconnect fecha corretamente', async () => {
    await manager.connect({ host: svc.host, porta: svc.port, persistir: false });
    const d = await manager.disconnect({ host: svc.host, porta: svc.port });
    assert.equal(d.status, 'DISCONNECTED');
    assert.equal(manager.isConnected({ host: svc.host, porta: svc.port }), false);
  });

  it('getTcp permanece disponível para Drivers V1', async () => {
    await manager.connect({ host: svc.host, porta: svc.port, persistir: false });
    const tcp = manager.getTcp({ host: svc.host, porta: svc.port });
    assert.ok(tcp instanceof TcpConnection);
    assert.equal(tcp.aberto, true);
  });
});

describe('Connection V2 — Serial / USB stubs', () => {
  it('conecta Serial stub', async () => {
    const manager = novoManager();
    const r = await manager.connect({
      transporte: 'serial',
      porta_com: 'COM_TEST_V2',
      persistir: false
    });
    assert.equal(r.status, 'CONNECTED');
    assert.equal(manager.isConnected({ porta_com: 'COM_TEST_V2' }), true);
    await manager.disconnect({ porta_com: 'COM_TEST_V2' });
  });

  it('conecta USB stub', async () => {
    const manager = novoManager();
    const r = await manager.connect({
      transporte: 'usb',
      vid: 'AAAA',
      pid: 'BBBB',
      persistir: false
    });
    assert.equal(r.status, 'CONNECTED');
    const ping = await manager.ping({ vid: 'AAAA', pid: 'BBBB' });
    assert.equal(ping.ok, true);
    await manager.closeAll();
  });
});

describe('Connection V2 — reconexão com backoff', () => {
  it('BACKOFF_MS é 2/4/8 segundos e RECONNECTING é estado válido', () => {
    const { BACKOFF_MS } = require('../../backend/motores/equipamentos/connection/ConnectionManager');
    assert.deepEqual([...BACKOFF_MS], [2000, 4000, 8000]);
    const fsm = new ConnectionStateMachine();
    fsm.transitar(STATES.CONNECTING);
    fsm.transitar(STATES.CONNECTED);
    fsm.transitar(STATES.RECONNECTING);
    assert.equal(fsm.estado, STATES.RECONNECTING);
  });

  it('queda de socket marca DISCONNECTED sem auto-reconnect', async () => {
    const svc = await startEchoServer();
    const manager = novoManager({ autoReconnect: false });
    try {
      await manager.connect({ host: svc.host, porta: svc.port, persistir: false });
      const entry = manager.getConnection({ host: svc.host, porta: svc.port });
      entry.transport.emit('close');
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(entry.fsm.estado, STATES.DISCONNECTED);
    } finally {
      try { await manager.closeAll(); } catch (_) { /* ignore */ }
      await new Promise((r) => svc.server.close(r));
    }
  });
});

describe('Connection V2 — timeout / perda', () => {
  it('connect em porta fechada falha', async () => {
    const manager = novoManager();
    await assert.rejects(
      () => manager.connect({ host: '127.0.0.1', porta: 1, timeoutMs: 150, persistir: false })
    );
  });
});
