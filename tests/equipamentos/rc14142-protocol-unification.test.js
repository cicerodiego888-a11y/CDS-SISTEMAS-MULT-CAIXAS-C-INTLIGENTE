/**
 * RC14.14.2 — Consolidação do protocolo oficial Toledo (TX/RX)
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '../..');

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

const frameBuilder = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoFrameBuilder');
const frameParser = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoFrameParser');
const checksum = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoChecksum');
const ToledoRxBuffer = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoRxBuffer');
const ToledoAckRouter = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoAckRouter');
const { OFFICIAL, validarSemColisao } = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoOfficialCommands');
const { auditar } = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoProtocolAudit');
const commandRegistry = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoCommandRegistry');
const { createEngine } = require('../../backend/motores/equipamentos/drivers/toledo/protocol/Toledo90AXEngine');
const { TimeoutError, InvalidChecksumError } = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoProtocolErrors');
const { ConnectionManager } = require('../../backend/motores/equipamentos/connection/ConnectionManager');
const ConnectionPool = require('../../backend/motores/equipamentos/connection/ConnectionPool');
const { COMMANDS } = require('../../backend/motores/equipamentos/drivers/toledo/ToledoProtocol');
const rootBuilder = require('../../backend/motores/equipamentos/drivers/toledo/ToledoFrameBuilder');
const rootParser = require('../../backend/motores/equipamentos/drivers/toledo/ToledoFrameParser');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

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

function startEchoServer(mode = 'ack') {
  return new Promise((resolve) => {
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('data', (buf) => {
        try {
          const parsed = frameParser.parse(buf);
          if (mode === 'nak') {
            socket.write(frameBuilder.build('NK', { echo: parsed.command }));
            return;
          }
          if (mode === 'split') {
            const ack = frameBuilder.build('AK', { echo: parsed.command, ok: true });
            socket.write(ack.subarray(0, 4));
            setTimeout(() => socket.write(ack.subarray(4)), 15);
            return;
          }
          if (mode === 'double') {
            const a = frameBuilder.build('AK', { n: 1 });
            const b = frameBuilder.build('AK', { n: 2 });
            socket.write(Buffer.concat([a, b]));
            return;
          }
          socket.write(frameBuilder.build('AK', {
            echo: parsed.command,
            firmware: '90AX',
            ok: true
          }));
        } catch (_) { /* ignore */ }
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

describe('RC14.14.2 — Frame Builder / Parser / Checksum', () => {
  it('builder oficial com CHK', () => {
    const tx = frameBuilder.build('PN', { ts: 1 });
    assert.equal(tx[0], 0x02);
    assert.equal(tx[tx.length - 1], 0x03);
    const parsed = frameParser.parse(tx);
    assert.equal(parsed.command, 'PN');
    assert.equal(parsed.valid, true);
    assert.ok(parsed.checksum);
  });

  it('fachada root delega ao oficial', () => {
    const a = frameBuilder.build('HS', { a: 1 });
    const b = rootBuilder.build('HS', { a: 1 });
    assert.deepEqual(a, b);
    assert.equal(rootParser.parse(a).comando, 'HS');
  });

  it('checksum XOR inválido é rejeitado', () => {
    const tx = frameBuilder.build('PN', { ts: 1 });
    const bad = Buffer.from(tx);
    bad[bad.length - 2] = bad[bad.length - 2] === 0x30 ? 0x31 : 0x30;
    assert.throws(() => frameParser.parse(bad), (err) => {
      return err.name === 'InvalidChecksumError' || err.code === 'INVALID_CHECKSUM' || /checksum/i.test(err.message);
    });
  });

  it('NACK parseado', () => {
    const nak = frameBuilder.build('NK', { motivo: 'x' });
    const p = frameParser.parse(nak);
    assert.equal(p.isNak, true);
  });
});

describe('RC14.14.2 — RX frame-aware', () => {
  it('chunk único', () => {
    const frame = frameBuilder.build('AK', { ok: true });
    const buf = new ToledoRxBuffer();
    const out = buf.push(frame);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], frame);
  });

  it('chunk dividido', () => {
    const frame = frameBuilder.build('AK', { ok: true });
    const buf = new ToledoRxBuffer();
    assert.equal(buf.push(frame.subarray(0, 5)).length, 0);
    const out = buf.push(frame.subarray(5));
    assert.equal(out.length, 1);
    assert.deepEqual(frameParser.parse(out[0]).command, 'AK');
  });

  it('dois frames no mesmo chunk', () => {
    const a = frameBuilder.build('AK', { n: 1 });
    const b = frameBuilder.build('AK', { n: 2 });
    const buf = new ToledoRxBuffer();
    const out = buf.push(Buffer.concat([a, b]));
    assert.equal(out.length, 2);
    assert.equal(frameParser.parse(out[0]).payload.n, 1);
    assert.equal(frameParser.parse(out[1]).payload.n, 2);
  });

  it('frame com checksum inválido é descartado', () => {
    const frame = frameBuilder.build('AK', { ok: true });
    const bad = Buffer.from(frame);
    bad[bad.length - 2] ^= 0x01;
    let descartou = 0;
    const buf = new ToledoRxBuffer({ onInvalid: () => { descartou += 1; } });
    const out = buf.push(bad);
    assert.equal(out.length, 0);
    assert.ok(descartou >= 1);
  });
});

describe('RC14.14.2 — ACK / fila / comandos', () => {
  it('ACK só para operationId pendente', () => {
    const router = new ToledoAckRouter();
    router.begin('h:1', { operationId: 'op-1', wireCommand: 'PN' });
    const parsed = frameParser.parse(frameBuilder.build('AK', {}));
    const r = router.complete('h:1', parsed);
    assert.equal(r.operationId, 'op-1');
    assert.equal(router.complete('h:1', parsed), null);
  });

  it('DP exclusivo de downloadPlu; departamento = UD', () => {
    assert.equal(OFFICIAL.DOWNLOAD_PLU.wire, 'DP');
    assert.equal(OFFICIAL.UPLOAD_DEPARTMENT.wire, 'UD');
    assert.equal(COMMANDS.DOWNLOAD_PLU, 'DP');
    assert.equal(COMMANDS.UPLOAD_DEPARTMENT, 'UD');
    assert.equal(commandRegistry.obter('downloadPlu').wireCommand, 'DP');
    assert.equal(commandRegistry.obter('uploadDepartment').wireCommand, 'UD');
    const v = validarSemColisao();
    assert.equal(v.ok, true, JSON.stringify(v.colisoes));
  });
});

describe('RC14.14.2 — Pipeline engine (handshake/ping/plu/peso/config)', () => {
  let svc;
  let cm;
  let engine;

  before(async () => {
    svc = await startEchoServer('ack');
    cm = new ConnectionManager({
      pool: new ConnectionPool(),
      autoReconnect: false,
      autoHeartbeat: false
    });
    engine = createEngine({ connectionManager: cm });
    await cm.connect({ host: svc.host, porta: svc.porta, persistir: false });
    engine.bind({ host: svc.host, porta: svc.porta });
  });

  after(async () => {
    try { await cm.disconnectAll?.(); } catch (_) { /* ignore */ }
    try { await cm.destroy?.(); } catch (_) { /* ignore */ }
    if (svc) await svc.fechar();
  });

  it('handshake via pipeline oficial', async () => {
    const r = await engine.handshake({ ts: 1 });
    assert.equal(r.sucesso, true);
    assert.equal(r.wireCommand, 'HS');
    assert.ok(r.operationId);
    assert.ok(r.checksum);
  });

  it('ping', async () => {
    const r = await engine.ping();
    assert.equal(r.sucesso, true);
    assert.equal(r.wireCommand, 'PN');
  });

  it('upload PLU', async () => {
    const r = await engine.uploadPlu({ plu: '1', nome: 'X' });
    assert.equal(r.sucesso, true);
    assert.equal(r.wireCommand, 'EP');
  });

  it('download PLU (DP)', async () => {
    const r = await engine.downloadPlu({ de: 1, ate: 10 });
    assert.equal(r.sucesso, true);
    assert.equal(r.wireCommand, 'DP');
  });

  it('peso', async () => {
    const r = await engine.readWeight();
    assert.equal(r.sucesso, true);
    assert.equal(r.wireCommand, 'PW');
  });

  it('configuração', async () => {
    const r = await engine.configRead({ chave: 'idioma' });
    assert.equal(r.sucesso, true);
    assert.equal(r.wireCommand, 'CR');
  });

  it('timeout', async () => {
    // Desliga respostas: fecha sockets do echo e usa porta morta via timeout curto
    const dead = createEngine({ connectionManager: cm });
    dead.bind({ host: svc.host, porta: svc.porta });
    // Esvazia e usa timeout 50ms sem resposta: injeta receive que não devolve frame
    const original = dead._receberChunk.bind(dead);
    dead._receberChunk = async () => null;
    await assert.rejects(() => dead.ping({}, { timeoutMs: 50, retries: 0 }), (err) => {
      return err instanceof TimeoutError || err.code === 'PROTOCOL_TIMEOUT';
    });
    dead._receberChunk = original;
  });
});

describe('RC14.14.2 — RX dividido / dois frames no engine', () => {
  it('chunk dividido no socket', async () => {
    const svc = await startEchoServer('split');
    const cm = new ConnectionManager({
      pool: new ConnectionPool(),
      autoReconnect: false,
      autoHeartbeat: false
    });
    const engine = createEngine({ connectionManager: cm });
    try {
      await cm.connect({ host: svc.host, porta: svc.porta, persistir: false });
      engine.bind({ host: svc.host, porta: svc.porta });
      const r = await engine.ping({}, { timeoutMs: 2000, retries: 0 });
      assert.equal(r.sucesso, true);
    } finally {
      try { await cm.disconnectAll?.(); } catch (_) { /* ignore */ }
      await svc.fechar();
    }
  });
});

describe('RC14.14.2 — Auditoria estrutural', () => {
  it('produção usa protocol/ e não abre framing paralelo', () => {
    const r = auditar();
    assert.equal(r.ok, true, JSON.stringify(r, null, 2));
    assert.match(read('backend/motores/equipamentos/drivers/toledo/ToledoFrameBuilder.js'), /protocol\/ToledoFrameBuilder/);
    assert.match(read('backend/motores/equipamentos/drivers/toledo/protocol/Toledo90AXEngine.js'), /ToledoRxBuffer/);
  });

  it('prix4 builder marcado como legado', () => {
    const src = read('backend/motores/equipamentos/drivers/toledo/prix4/ToledoPrix4FrameBuilder.js');
    assert.match(src, /LEGADO|laborat|NÃO usar em produção/i);
  });
});
