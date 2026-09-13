/**
 * Sprint 15.4 — Testes Sync oficial Toledo 90AX
 */
'use strict';

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
  _tables: {},
  run(sql, params, cb) {
    const fn = typeof params === 'function' ? params : cb;
    const s = String(sql || '');
    if (/CREATE TABLE/i.test(s) || /ALTER TABLE/i.test(s) || /CREATE INDEX/i.test(s)) {
      if (fn) fn.call({ lastID: 0, changes: 0 }, null);
      return;
    }
    if (/INSERT INTO equipamentos_sync\b/i.test(s)) {
      this._syncId = (this._syncId || 0) + 1;
      if (fn) fn.call({ lastID: this._syncId, changes: 1 }, null);
      return;
    }
    if (/INSERT INTO equipamentos_sync_itens/i.test(s)) {
      this._itemId = (this._itemId || 0) + 1;
      if (fn) fn.call({ lastID: this._itemId, changes: 1 }, null);
      return;
    }
    if (fn) fn.call({ lastID: 0, changes: 1 }, null);
  },
  all(sql, params, cb) {
    const fn = typeof params === 'function' ? params : cb;
    const s = String(sql || '');
    if (/PRAGMA table_info/i.test(s)) {
      // Simula colunas já existentes para evitar ALTER repetido problemático
      if (fn) {
        fn(null, [
          { name: 'id' }, { name: 'tipo' }, { name: 'status' }, { name: 'modo' },
          { name: 'equipamento_id' }, { name: 'usuario_id' }, { name: 'tempo_ms' },
          { name: 'observacoes' }, { name: 'versao_carga' }, { name: 'tentativas' }
        ]);
      }
      return;
    }
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

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');

const planner = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncPlanner');
const batchBuilder = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoBatchBuilder');
const ToledoRetryPolicy = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoRetryPolicy');
const ToledoSyncProgress = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncProgress');
const validator = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncValidator');
const report = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncReport');
const ToledoSyncExecutor = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncExecutor');
const { createSyncService } = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncService');
const { createEngine } = require('../../backend/motores/equipamentos/drivers/toledo/protocol/Toledo90AXEngine');
const frameBuilder = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoFrameBuilder');
const frameParser = require('../../backend/motores/equipamentos/drivers/toledo/protocol/ToledoFrameParser');
const { ConnectionManager } = require('../../backend/motores/equipamentos/connection/ConnectionManager');
const ConnectionPool = require('../../backend/motores/equipamentos/connection/ConnectionPool');
const { CODES } = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncErrors');

const CDS = [
  { plu: '101', descricao: 'Picanha', preco: 89.9, tara: 0, departamento: 1, produto_id: 1 },
  { plu: '102', descricao: 'Fraldinha', preco: 45, tara: 0, departamento: 1, produto_id: 2 },
  { plu: '103', descricao: 'Alcatra', preco: 50, tara: 0, departamento: 1, produto_id: 3 }
];

const SNAPSHOT = [
  { plu: '101', descricao: 'Picanha Old', preco: 80, tara: 0, departamento: 1 },
  { plu: '103', descricao: 'Alcatra', preco: 50, tara: 0, departamento: 1 }
];

function startAckServer() {
  return new Promise((resolve) => {
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('data', (buf) => {
        try {
          const parsed = frameParser.parse(buf);
          const ack = frameBuilder.build('AK', { echo: parsed.command, ok: true });
          socket.write(ack);
        } catch (_) { /* ignore */ }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        host: '127.0.0.1',
        porta: server.address().port,
        fechar: () => new Promise((r) => {
          for (const s of sockets) {
            try { s.destroy(); } catch (_) { /* ignore */ }
          }
          server.close(() => r());
          setTimeout(r, 200).unref?.();
        })
      });
    });
  });
}

describe('Sync 15.4 — Planner / Batch / Validator', () => {
  it('planFull envia todos', () => {
    const plano = planner.planFull(CDS, SNAPSHOT);
    assert.equal(plano.modo, 'full');
    assert.equal(plano.resumo.aExecutar, 3);
    assert.ok(plano.carga.plus.length === 3);
    assert.ok(plano.carga.departamentos.length >= 1);
  });

  it('planIncremental só alterações', () => {
    const plano = planner.planIncremental(CDS, SNAPSHOT);
    assert.equal(plano.modo, 'incremental');
    assert.equal(plano.resumo.aExecutar, 2); // 101 alterado + 102 novo
    assert.equal(plano.resumo.iguais, 1);
  });

  it('BatchBuilder gera lotes com checksum', () => {
    const lotes = batchBuilder.build(CDS, { tamanhoLote: 2, tipo: 'PLU' });
    assert.equal(lotes.length, 2);
    assert.equal(lotes[0].quantidade, 2);
    assert.ok(lotes[0].checksum);
    assert.equal(lotes[0].comando, 'uploadPlu');
  });

  it('validator rejeita item sem plu', () => {
    const v = validator.validarItemCarga({ descricao: 'x' }, 'PLU');
    assert.equal(v.ok, false);
  });

  it('validator aceita resposta 90AX', () => {
    const v = validator.validarResposta({
      sucesso: true,
      checksum: 'AB',
      validacao: true,
      parsed: { valid: true, command: 'AK' }
    });
    assert.equal(v.ok, true);
  });
});

describe('Sync 15.4 — Retry / Progress / Report', () => {
  it('retry policy tenta 3 vezes', async () => {
    let n = 0;
    const policy = new ToledoRetryPolicy({ maxAttempts: 3, backoffMs: [0, 0, 0] });
    const r = await policy.execute(async () => {
      n += 1;
      if (n < 3) throw new Error('fail');
      return { sucesso: true };
    });
    assert.equal(r.success, true);
    assert.equal(r.attempts, 3);
    assert.equal(n, 3);
  });

  it('retry não reenvia alreadyConfirmed', async () => {
    let n = 0;
    const policy = new ToledoRetryPolicy({ maxAttempts: 3 });
    const r = await policy.execute(async () => { n += 1; return { sucesso: true }; }, {
      alreadyConfirmed: true
    });
    assert.equal(r.skipped, true);
    assert.equal(n, 0);
  });

  it('progress calcula % e ETA', () => {
    const p = new ToledoSyncProgress();
    p.start({ totalItens: 10, lotesTotal: 2, modo: 'full' });
    p.markItem(true);
    p.markItem(true);
    const s = p.snapshot();
    assert.equal(s.percent, 20);
    assert.equal(s.itensRestantes, 8);
    assert.equal(s.modo, 'full');
  });

  it('report inclui tipos e resultado final', () => {
    const rel = report.buildReport({
      syncId: 1,
      modo: 'incremental',
      execucao: {
        durationMs: 1000,
        resultados: [
          { success: true, acao: 'ENVIAR', tipo: 'PLU' },
          { success: true, tipo: 'DEPARTAMENTO' },
          { success: false, tipo: 'PLU' }
        ]
      },
      iniciadoEm: new Date(Date.now() - 1000).toISOString(),
      finalizadoEm: new Date().toISOString()
    });
    assert.equal(rel.falhas, 1);
    assert.ok(rel.resultadoFinal);
    assert.equal(rel.engine, '90AX');
  });
});

describe('Sync 15.4 — Executor 90AX + Service', () => {
  let svcNet;
  let cm;

  beforeEach(async () => {
    // reset between tests handled in each it
  });

  it('executeBatches via 90AX', async () => {
    svcNet = await startAckServer();
    cm = new ConnectionManager({
      pool: new ConnectionPool(),
      repository: { async salvar() { return null; } },
      timeoutMs: 1000,
      autoReconnect: false,
      autoHeartbeat: false
    });
    try {
      await cm.connect({ host: svcNet.host, porta: svcNet.porta, persistir: false });
      const engine = createEngine({ connectionManager: cm });
      engine.bind({ host: svcNet.host, porta: svcNet.porta });
      const executor = new ToledoSyncExecutor({ engine });
      const progress = new ToledoSyncProgress();
      progress.start({ totalItens: 2, lotesTotal: 1 });
      const r = await executor.executeBatches(
        { plus: CDS.slice(0, 2) },
        {
          host: svcNet.host,
          porta: svcNet.porta,
          confirm: true,
          tamanhoLote: 10,
          progress
        }
      );
      assert.equal(r.success, true);
      assert.equal(r.ok, 2);
      assert.ok(r.lotes[0].confirmed);
      assert.ok(progress.snapshot().percent >= 100 || progress.snapshot().itensEnviados === 2);
    } finally {
      try { await cm.closeAll(); } catch (_) { /* ignore */ }
      await svcNet.fechar();
    }
  });

  it('syncFull e syncIncremental via Service', async () => {
    svcNet = await startAckServer();
    cm = new ConnectionManager({
      pool: new ConnectionPool(),
      repository: { async salvar() { return null; } },
      timeoutMs: 1000,
      autoReconnect: false,
      autoHeartbeat: false
    });
    try {
      const engine = createEngine({ connectionManager: cm });
      const service = createSyncService({
        connectionManager: cm,
        engine,
        repository: {
          async criarSync() { return 99; },
          async atualizarSync() {},
          async inserirItem() { return 1; },
          async atualizarItem() {},
          async buscarPorId() { return { itens: [] }; },
          async historico() { return []; }
        }
      });

      const full = await service.syncFull({
        host: svcNet.host,
        porta: svcNet.porta,
        confirm: true,
        produtos: CDS,
        ultimaSync: SNAPSHOT,
        persistir: false,
        tamanhoLote: 5
      });
      assert.equal(full.success, true);
      assert.equal(full.modo, 'full');
      assert.ok(full.relatorio);

      const inc = await service.syncIncremental({
        host: svcNet.host,
        porta: svcNet.porta,
        confirm: true,
        produtos: CDS,
        ultimaSync: SNAPSHOT,
        persistir: false
      });
      assert.equal(inc.success, true);
      assert.equal(inc.modo, 'incremental');
      assert.ok(inc.execucao.ok >= 2);
    } finally {
      try { await cm.closeAll(); } catch (_) { /* ignore */ }
      await svcNet.fechar();
    }
  });

  it('exige confirm e cancela com segurança', async () => {
    const engine = {
      bind() {},
      async execute() {
        await new Promise((r) => setTimeout(r, 300));
        return { sucesso: true, checksum: 'AA', validacao: true, parsed: { valid: true } };
      }
    };
    const service = createSyncService({
      connectionManager: {
        isConnected() { return true; },
        async connect() { return {}; }
      },
      engine,
      repository: {
        async criarSync() { return 1; },
        async atualizarSync() {},
        async inserirItem() {},
        async atualizarItem() {},
        async buscarPorId() { return null; },
        async historico() { return []; }
      }
    });

    await assert.rejects(
      () => service.syncFull({ produtos: CDS, host: '1.1.1.1', porta: 9 }),
      (e) => e.code === CODES.SYNC_NOT_CONFIRMED
    );

    const executor = new ToledoSyncExecutor({ engine });
    const run = executor.executeBatches(
      { plus: CDS },
      { confirm: true, host: '1.1.1.1', porta: 9 }
    );
    setTimeout(() => executor.cancel(), 20);
    await assert.rejects(() => run, (e) => e.code === CODES.SYNC_CANCELLED);
  });

  it('timeout/retry falha após esgotar', async () => {
    let attempts = 0;
    const engine = {
      bind() {},
      async execute() {
        attempts += 1;
        return { sucesso: false, error: 'timeout' };
      }
    };
    const executor = new ToledoSyncExecutor({
      engine,
      retryPolicy: new ToledoRetryPolicy({ maxAttempts: 3, backoffMs: [0, 0, 0] })
    });
    const r = await executor.executeBatches(
      { plus: [{ plu: '1', descricao: 'x', preco: 1 }] },
      { confirm: true, host: '127.0.0.1', porta: 1 }
    );
    assert.equal(r.success, false);
    assert.equal(attempts, 3);
  });
});
