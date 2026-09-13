/**
 * Sprint 15.2 — Testes Motor Protocolo Toledo 90AX
 */
'use strict';

/** Stub do SQLite real — ConnectionRepository/Logger puxam o banco no require. */
function stubResolved(relFromHere, exports) {
  const abs = require.resolve(relFromHere, { paths: [__dirname] });
  require.cache[abs] = {
    id: abs,
    filename: abs,
    loaded: true,
    exports
  };
  return abs;
}

const fakeDb = {
  run(sql, params, cb) {
    const fn = typeof params === 'function' ? params : cb;
    if (fn) fn.call({ lastID: 0, changes: 0 }, null);
  },
  all(sql, params, cb) {
    const fn = typeof params === 'function' ? params : cb;
    if (fn) fn(null, []);
  },
  get(sql, params, cb) {
    const fn = typeof params === 'function' ? params : cb;
    if (fn) fn(null, null);
  },
  serialize(fn) { if (fn) fn(); },
  close(cb) { if (cb) cb(); },
  insertSafe(table, data, cb) { if (cb) cb(null); },
  dbDir: '.',
  dbPath: ':memory:'
};
stubResolved('../../backend/database.js', fakeDb);
stubResolved('../../backend/motores/equipamentos/services/LoggerService.js', {
  info: async () => {},
  warn: async () => {},
  error: async () => {},
  debug: async () => {},
  logOperacao: async () => {}
});
stubResolved('../../backend/motores/equipamentos/laboratorio/EngineeringLab.js', {
  observeTx: async () => {},
  observeRx: async () => {}
});

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');

const frameBuilder = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoFrameBuilder');
const frameParser = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoFrameParser');
const checksum = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoChecksum');
const ToledoSession = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoSession');
const { STATES } = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoSession');
const ToledoResponseMatcher = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoResponseMatcher');
const commandRegistry = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoCommandRegistry');
const { createEngine } = require('../../backend/motores/equipamentos/drivers/toledo/protocol/Toledo90AXEngine');
const {
  InvalidChecksumError,
  TimeoutError,
  UnexpectedResponseError,
  CommandNotFoundError
} = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoProtocolErrors');
const { ConnectionManager } = require('../../backend/motores/equipamentos/connection/ConnectionManager');
const ConnectionPool = require('../../backend/motores/equipamentos/connection/ConnectionPool');

function fecharServidor(server, sockets = new Set()) {
  for (const s of sockets) {
    try { s.destroy(); } catch (_) { /* ignore */ }
  }
  sockets.clear();
  return new Promise((resolve) => {
    if (!server || !server.listening) return resolve();
    server.close(() => resolve());
    setTimeout(() => {
      try { server.close(); } catch (_) { /* ignore */ }
      resolve();
    }, 300);
  });
}

function startProtocolServer() {
  return new Promise((resolve) => {
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('data', (buf) => {
        try {
          const parsed = frameParser.parse(buf);
          const ack = frameBuilder.build('AK', {
            echo: parsed.command,
            firmware: '90AX',
            ok: true
          });
          socket.write(ack);
        } catch (_) {
          // ignore invalid
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        sockets,
        host: '127.0.0.1',
        porta: server.address().port,
        fechar: () => fecharServidor(server, sockets)
      });
    });
  });
}

describe('90AX — Frame Builder / Parser / Checksum', () => {
  it('build + parse roundtrip com checksum válido', () => {
    const tx = frameBuilder.build('PN', { ts: 1 });
    assert.equal(tx[0], 0x02);
    assert.equal(tx[tx.length - 1], 0x03);
    const parsed = frameParser.parse(tx);
    assert.equal(parsed.command, 'PN');
    assert.equal(parsed.valid, true);
    assert.ok(parsed.checksum);
    assert.equal(parsed.checksum.length, 2);
  });

  it('checksum calculate/validate/compare', () => {
    const body = Buffer.from('PN\x1c{}', 'binary');
    const hex = checksum.toHex(body);
    assert.equal(checksum.validate(body, hex), true);
    assert.equal(checksum.compare(hex, hex.toLowerCase()), true);
    assert.throws(() => checksum.assertValid(body, 'ZZ'), (e) => e instanceof InvalidChecksumError);
  });

  it('parser rejeita checksum inválido', () => {
    const tx = frameBuilder.build('HS', { a: 1 });
    const corrompido = Buffer.from(tx);
    // altera um byte do checksum (penúltimo antes do ETX)
    corrompido[corrompido.length - 2] = corrompido[corrompido.length - 2] === 0x41 ? 0x42 : 0x41;
    assert.throws(() => frameParser.parse(corrompido), (e) => e instanceof InvalidChecksumError);
  });
});

describe('90AX — Session / Matcher / Registry', () => {
  it('sessão percorre estados', () => {
    const s = new ToledoSession();
    s.iniciar('ping');
    assert.equal(s.estado, STATES.SEND);
    s.marcarEnviado(Buffer.from([1]));
    assert.equal(s.estado, STATES.WAIT_RESPONSE);
    s.marcarRecebido(Buffer.from([2]));
    assert.equal(s.estado, STATES.PARSE);
    s.marcarSucesso({ command: 'AK', valid: true });
    assert.equal(s.estado, STATES.SUCCESS);
  });

  it('matcher aceita AK e rejeita NK', () => {
    const m = new ToledoResponseMatcher({ accept: ['AK'], reject: ['NK'] });
    assert.equal(m.match({ command: 'AK', valid: true, payload: null }).ok, true);
    assert.throws(() => m.match({ command: 'NK', valid: true }), (e) => e instanceof UnexpectedResponseError);
  });

  it('registry lista e resolve comandos', () => {
    assert.ok(commandRegistry.tem('ping'));
    assert.ok(commandRegistry.tem('identify'));
    const ping = commandRegistry.obter('ping');
    assert.equal(ping.wireCommand, 'PN');
    assert.throws(() => commandRegistry.obter('naoexiste'), (e) => e instanceof CommandNotFoundError);
    assert.ok(commandRegistry.listar().length >= 5);
  });
});

describe('90AX — Engine com ConnectionManager', () => {
  let svc;
  let cm;
  let engine;

  before(async () => {
    svc = await startProtocolServer();
  });

  after(async () => {
    await svc.fechar();
    try {
      const cmSingleton = require('../../backend/motores/equipamentos/connection/ConnectionManager');
      if (typeof cmSingleton.closeAll === 'function') await cmSingleton.closeAll();
    } catch (_) { /* ignore */ }
  });

  beforeEach(async () => {
    cm = new ConnectionManager({
      pool: new ConnectionPool(),
      repository: { async salvar() { return null; } },
      timeoutMs: 1000,
      autoReconnect: false,
      autoHeartbeat: false
    });
    engine = createEngine({ connectionManager: cm });
    await cm.connect({ host: svc.host, porta: svc.porta, persistir: false });
    engine.bind({ host: svc.host, porta: svc.porta });
  });

  afterEach(async () => {
    try { await cm.closeAll(); } catch (_) { /* ignore */ }
  });

  it('execute ping', async () => {
    const r = await engine.execute('ping');
    assert.equal(r.sucesso, true);
    assert.equal(r.command, 'ping');
    assert.equal(r.responseCommand, 'AK');
    assert.ok(r.checksum);
    assert.ok(r.txHex);
    assert.ok(r.rxHex);
  });

  it('execute identify / handshake / status', async () => {
    const id = await engine.execute('identify');
    assert.equal(id.sucesso, true);
    const hs = await engine.execute('handshake');
    assert.equal(hs.sucesso, true);
    const st = await engine.execute('status');
    assert.equal(st.sucesso, true);
  });

  it('histórico acumula execuções', async () => {
    await engine.execute('ping');
    await engine.execute('ping');
    const hist = engine.history({ limite: 10 });
    assert.ok(hist.length >= 2);
    assert.equal(hist[0].command, 'ping');
  });

  it('retry + timeout', async () => {
    // Porta sem resposta de protocolo
    const sockets = new Set();
    const silent = net.createServer((s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
      /* não responde */
    });
    await new Promise((r) => silent.listen(0, '127.0.0.1', r));
    const porta = silent.address().port;
    try {
      await cm.connect({ host: '127.0.0.1', porta, persistir: false });
      engine.bind({ host: '127.0.0.1', porta });
      await assert.rejects(
        () => engine.execute('ping', null, { timeoutMs: 80, retries: 1 }),
        (e) => e instanceof TimeoutError
      );
    } finally {
      try { await cm.disconnect({ host: '127.0.0.1', porta }); } catch (_) { /* ignore */ }
      await fecharServidor(silent, sockets);
    }
  });

  it('executeRaw envia frame bruto', async () => {
    const raw = frameBuilder.build('PN', { raw: true });
    const r = await engine.executeRaw(raw, { timeoutMs: 500 });
    assert.equal(r.sucesso, true);
    assert.ok(r.parsed);
  });
});
