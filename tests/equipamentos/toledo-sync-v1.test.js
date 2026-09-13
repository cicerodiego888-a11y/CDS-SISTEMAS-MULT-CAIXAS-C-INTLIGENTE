/**
 * Sprint 14.8 — Testes Motor de Sincronização de PLUs V1.0
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const comparator = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncComparator');
const planner = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncPlanner');
const report = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncReport');
const downloadParser = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoDownloadParser');
const ToledoSyncRepository = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncRepository');
const ToledoDownloadEngine = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoDownloadEngine');
const ToledoSyncExecutor = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncExecutor');
const { ToledoSyncEngine } = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncEngine');
const SyncController = require('../../backend/motores/equipamentos/drivers/toledo/sync/SyncController');
const { CODES } = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncErrors');
const frameBuilder = require('../../backend/motores/equipamentos/drivers/toledo/ToledoFrameBuilder');
const { COMMANDS } = require('../../backend/motores/equipamentos/drivers/toledo/ToledoProtocol');

const PLUS_BALANCA = [
  { plu: '101', descricao: 'Picanha Old', preco: 80, tara: 0, departamento: 1 },
  { plu: '103', descricao: 'Alcatra', preco: 50, tara: 0, departamento: 1 }
];

const PLUS_CDS = [
  { plu: '101', descricao: 'Picanha', preco: 89.9, tara: 0, departamento: 1, produto_id: 1 },
  { plu: '102', descricao: 'Fraldinha', preco: 45, tara: 0, departamento: 1, produto_id: 2 },
  { plu: '103', descricao: 'Alcatra', preco: 50, tara: 0, departamento: 1, produto_id: 3 }
];

function mockDriverDownload(plus = PLUS_BALANCA) {
  return {
    host: '10.0.0.170',
    porta: 9000,
    _online: true,
    isOnline() { return true; },
    async connect() { return { status: 'CONNECTED', handshake: true, latencia: 1 }; },
    async sendFrame(buf) {
      this._lastTx = buf;
      return buf.length;
    },
    async receiveFrame() {
      return frameBuilder.buildAck({ plus });
    }
  };
}

function mockPluEngineOk() {
  return {
    cancel() {},
    async upload(produto) {
      return { success: true, plu: produto.plu, syncId: 1 };
    }
  };
}

describe('Sync V1 — Download', () => {
  it('downloadAll lê PLUs via framing DP', async () => {
    const engine = new ToledoDownloadEngine({
      persistir: false,
      driverFactory: () => mockDriverDownload()
    });
    const r = await engine.downloadAll({ host: '10.0.0.170', porta: 9000 });
    assert.equal(r.success, true);
    assert.equal(r.total, 2);
    assert.equal(r.plus[0].plu, '101');
    assert.ok(Buffer.isBuffer(engine._engine()._getDriver('10.0.0.170', 9000)._lastTx));
    assert.equal(
      engine._engine()._getDriver('10.0.0.170', 9000)._lastTx.toString('ascii', 1, 3),
      COMMANDS.DOWNLOAD_PLU
    );
  });

  it('downloadRange parcial', async () => {
    const plus = [{ plu: '101', descricao: 'Picanha', preco: 10 }];
    const engine = new ToledoDownloadEngine({
      persistir: false,
      driverFactory: () => mockDriverDownload(plus)
    });
    const r = await engine.downloadRange('100', '150', { host: '10.0.0.170', porta: 9000 });
    assert.equal(r.success, true);
    assert.equal(r.range.from, '100');
    assert.equal(r.total, 1);
  });
});

describe('Sync V1 — Comparator', () => {
  it('classifica IGUAL ALTERADO NOVO AUSENTE', () => {
    const rows = comparator.compare(PLUS_CDS, [
      ...PLUS_BALANCA,
      { plu: '999', descricao: 'Só Balança', preco: 1 }
    ]);
    const byPlu = Object.fromEntries(rows.map((r) => [r.plu, r.situacao]));
    assert.equal(byPlu['101'], 'ALTERADO');
    assert.equal(byPlu['102'], 'NOVO');
    assert.equal(byPlu['103'], 'IGUAL');
    assert.equal(byPlu['999'], 'AUSENTE');
  });
});

describe('Sync V1 — Planner', () => {
  it('gera plano com ações', () => {
    const comparacao = comparator.compare(PLUS_CDS, PLUS_BALANCA);
    const plano = planner.plan(comparacao);
    const byPlu = Object.fromEntries(plano.itens.map((i) => [i.plu, i.acao]));
    assert.equal(byPlu['101'], 'ATUALIZAR');
    assert.equal(byPlu['102'], 'ENVIAR');
    assert.equal(byPlu['103'], 'IGNORAR');
    assert.equal(plano.resumo.aExecutar, 2);
  });
});

describe('Sync V1 — Executor', () => {
  it('exige confirm: true e executa plano', async () => {
    const executor = new ToledoSyncExecutor({
      pluEngine: mockPluEngineOk()
    });
    const plano = planner.plan(comparator.compare(PLUS_CDS, PLUS_BALANCA));
    await assert.rejects(
      () => executor.execute(plano.itens, { host: '10.0.0.170', porta: 9000 }),
      (err) => err.code === CODES.SYNC_NOT_CONFIRMED
    );
    const r = await executor.execute(plano.itens, {
      host: '10.0.0.170',
      porta: 9000,
      confirm: true,
      persistir: false
    });
    assert.equal(r.ok, 2);
    assert.equal(r.erro, 0);
  });
});

describe('Sync V1 — Repository', () => {
  it('persiste sync e itens', async () => {
    const repo = new ToledoSyncRepository();
    const id = await repo.criarSync({ tipo: 'PLU', host: '10.0.0.170', porta: 9000 });
    assert.ok(id);
    await repo.atualizarSync(id, { status: 'DOWNLOAD_OK', produtos_lidos: 2 });
    const itemId = await repo.inserirItem({
      sync_id: id,
      produto_id: 1,
      plu: '101',
      acao: 'ATUALIZAR',
      status: 'PENDENTE'
    });
    await repo.atualizarItem(itemId, { status: 'OK' });
    const row = await repo.buscarPorId(id);
    assert.equal(row.produtos_lidos, 2);
    assert.equal(row.itens.length, 1);
    assert.equal(row.itens[0].status, 'OK');
    const hist = await repo.historico({ limite: 5, host: '10.0.0.170' });
    assert.ok(hist.some((h) => h.id === id));
  });
});

describe('Sync V1 — Relatório', () => {
  it('monta relatório final', () => {
    const comparacao = comparator.compare(PLUS_CDS, PLUS_BALANCA);
    const plano = planner.plan(comparacao);
    const rel = report.buildReport({
      syncId: 1,
      comparacao,
      plano,
      execucao: {
        resultados: [
          { acao: 'ATUALIZAR', success: true },
          { acao: 'ENVIAR', success: true }
        ],
        durationMs: 1500
      },
      iniciadoEm: new Date(Date.now() - 1500).toISOString(),
      produtosLidos: 2
    });
    assert.equal(rel.produtosEnviados, 1);
    assert.equal(rel.produtosAtualizados, 1);
    assert.equal(rel.falhas, 0);
    assert.ok(rel.tempoTotal);
  });
});

describe('Sync V1 — Engine + API + Histórico', () => {
  let engine;

  beforeEach(() => {
    engine = new ToledoSyncEngine({
      persistir: false,
      driverFactory: () => mockDriverDownload(),
      pluEngine: mockPluEngineOk(),
      repository: {
        async criarSync() { return 42; },
        async atualizarSync() {},
        async inserirItem() { return 1; },
        async atualizarItem() {},
        async historico() {
          return [{ id: 42, status: 'CONCLUIDO', produtos_lidos: 2 }];
        },
        async buscarPorId(id) {
          return { id: Number(id), status: 'CONCLUIDO', itens: [], relatorio: { falhas: 0 } };
        }
      }
    });
  });

  it('fluxo download → compare → sync', async () => {
    const dl = await engine.download({ host: '10.0.0.170', porta: 9000, persistir: false });
    assert.equal(dl.total, 2);
    const cmp = await engine.compare({ produtos: PLUS_CDS });
    assert.equal(cmp.resumo.alterados, 1);
    assert.equal(cmp.resumo.novos, 1);
    await assert.rejects(
      () => engine.sync({ host: '10.0.0.170', porta: 9000, persistir: false }),
      (err) => err.code === CODES.SYNC_NOT_CONFIRMED
    );
    const sync = await engine.sync({
      host: '10.0.0.170',
      porta: 9000,
      confirm: true,
      persistir: false
    });
    assert.equal(sync.success, true);
    assert.ok(sync.relatorio);
    assert.equal(sync.relatorio.produtosAtualizados, 1);
  });

  it('histórico e getById', async () => {
    const hist = await engine.history({ limite: 10 });
    assert.equal(hist[0].id, 42);
    const row = await engine.getById(42);
    assert.equal(row.status, 'CONCLUIDO');
  });

  it('parser download e controller export', () => {
    const raw = frameBuilder.buildAck({ plus: PLUS_BALANCA });
    const parsed = downloadParser.parseResponse(raw);
    assert.equal(parsed.plus.length, 2);
    assert.equal(typeof SyncController.download, 'function');
    assert.equal(typeof SyncController.compare, 'function');
    assert.equal(typeof SyncController.sync, 'function');
    assert.equal(typeof SyncController.history, 'function');
    assert.equal(typeof SyncController.getById, 'function');
  });
});
