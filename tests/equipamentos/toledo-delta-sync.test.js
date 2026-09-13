/**
 * Sprint 15.5 — Testes Delta Sync / Versionamento / Rollback / Auditoria
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ToledoSnapshotService = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSnapshotService');
const ToledoDeltaEngine = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoDeltaEngine');
const ToledoDeltaRepository = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoDeltaRepository');
const ToledoVersionManager = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoVersionManager');
const ToledoLoadManager = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoLoadManager');
const ToledoConflictResolver = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoConflictResolver');
const ToledoSyncAudit = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncAudit');
const ToledoRollbackService = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoRollbackService');
const planner = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncPlanner');
const { createSyncService } = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncService');
const { CODES } = require('../../backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncErrors');

const CDS_V1 = [
  { plu: '101', descricao: 'Picanha', preco: 80, departamento: 1, produto_id: 1 },
  { plu: '103', descricao: 'Alcatra', preco: 50, departamento: 1, produto_id: 3 }
];

const CDS_V2 = [
  { plu: '101', descricao: 'Picanha Premium', preco: 89.9, departamento: 1, produto_id: 1 },
  { plu: '102', descricao: 'Fraldinha', preco: 45, departamento: 2, produto_id: 2 },
  { plu: '103', descricao: 'Alcatra', preco: 50, departamento: 1, produto_id: 3 }
];

describe('Delta 15.5 — Snapshot / Hash', () => {
  it('gera snapshot com hash estável', () => {
    const svc = new ToledoSnapshotService();
    const a = svc.criar(CDS_V1);
    const b = svc.criar(CDS_V1);
    assert.ok(a.hash);
    assert.equal(a.hash, b.hash);
    assert.equal(a.totalPlus, 2);
    assert.ok(a.departamentos.length >= 1);
  });

  it('hash muda quando produto muda', () => {
    const svc = new ToledoSnapshotService();
    const a = svc.criar(CDS_V1);
    const b = svc.criar(CDS_V2);
    assert.notEqual(a.hash, b.hash);
  });
});

describe('Delta 15.5 — Delta Engine / Alterações', () => {
  it('detecta novos, alterados e removidos', () => {
    const snaps = new ToledoSnapshotService();
    const ant = snaps.criar(CDS_V1);
    const atu = snaps.criar(CDS_V2);
    const delta = ToledoDeltaEngine.compute(atu, ant);
    assert.equal(delta.resumo.novos, 1);
    assert.equal(delta.resumo.alterados, 1);
    assert.equal(delta.resumo.removidos, 0);
    assert.ok(delta.mudancasPreco.length >= 1);
    assert.equal(delta.semAlteracoes, false);
  });

  it('semAlteracoes quando hash igual', () => {
    const snaps = new ToledoSnapshotService();
    const s = snaps.criar(CDS_V1);
    const delta = ToledoDeltaEngine.compute(s, s);
    assert.equal(delta.semAlteracoes, true);
    assert.equal(delta.hashIgual, true);
  });

  it('planDelta integra com planner 15.4', () => {
    const snaps = new ToledoSnapshotService();
    const delta = ToledoDeltaEngine.compute(snaps.criar(CDS_V2), snaps.criar(CDS_V1));
    const plano = planner.planDelta(delta);
    assert.equal(plano.modo, 'delta');
    assert.equal(plano.resumo.aExecutar, 2);
    assert.ok(plano.carga.plus.length === 2);
  });
});

describe('Delta 15.5 — Versionamento / Load / Audit', () => {
  it('cria versões sequenciais com hash', async () => {
    const repo = new ToledoDeltaRepository({ memory: true });
    const versions = new ToledoVersionManager({ repository: repo });
    const alvo = { host: '10.0.0.1', porta: 9000 };
    const snaps = new ToledoSnapshotService();
    const s1 = snaps.criar(CDS_V1, { versao: 1 });
    const v1 = await versions.criar(alvo, { hash: s1.hash, snapshot: s1, status: 'INICIADO' });
    await versions.finalizar(v1.id, { status: 'SUCESSO', snapshot: s1, hash: s1.hash, itens: 2 });
    const s2 = snaps.criar(CDS_V2, { versao: 2 });
    const v2 = await versions.criar(alvo, { hash: s2.hash, snapshot: s2 });
    await versions.finalizar(v2.id, { status: 'SUCESSO', snapshot: s2, hash: s2.hash, itens: 3 });
    const list = await versions.listar(alvo);
    assert.equal(list.length, 2);
    assert.equal(list[0].versao, 2);
    assert.equal(list[1].versao, 1);
  });

  it('LoadManager reporta carga atual e tempo médio', async () => {
    const repo = new ToledoDeltaRepository({ memory: true });
    const versions = new ToledoVersionManager({ repository: repo });
    const loads = new ToledoLoadManager({ versionManager: versions, repository: repo });
    const alvo = { host: '10.0.0.2', porta: 9000 };
    const snaps = new ToledoSnapshotService();
    const s = snaps.criar(CDS_V1);
    const v = await versions.criar(alvo, { hash: s.hash, snapshot: s });
    await versions.finalizar(v.id, { status: 'SUCESSO', tempoMs: 1000, itens: 2, snapshot: s, hash: s.hash });
    const st = await loads.refresh(alvo);
    assert.ok(st.cargaAtual);
    assert.equal(st.cargaAtual.versao, 1);
    assert.ok(st.ultimaBemSucedida);
  });

  it('auditoria registra campos do delta', async () => {
    const repo = new ToledoDeltaRepository({ memory: true });
    const audit = new ToledoSyncAudit({ repository: repo });
    const snaps = new ToledoSnapshotService();
    const delta = ToledoDeltaEngine.compute(snaps.criar(CDS_V2), snaps.criar(CDS_V1));
    const ids = await audit.registrar({
      versionId: 1,
      equipamentoId: 10,
      campos: audit.fromDelta(delta),
      resultado: 'OK'
    });
    assert.ok(ids.length >= 1);
    const list = await audit.listar({ versionId: 1 });
    assert.ok(list.length >= 1);
    assert.ok(list[0].campo);
  });
});

describe('Delta 15.5 — Conflitos / Rollback', () => {
  it('detecta PLU duplicado', () => {
    const r = ToledoConflictResolver.detectar({
      produtos: [
        { plu: '1', descricao: 'A' },
        { plu: '1', descricao: 'B' }
      ]
    });
    assert.equal(r.ok, false);
    assert.ok(r.conflitos.some((c) => c.tipo === 'PLU_DUPLICADO'));
  });

  it('rollback restaura última carga OK sem apagar histórico', async () => {
    const repo = new ToledoDeltaRepository({ memory: true });
    const versions = new ToledoVersionManager({ repository: repo });
    const audit = new ToledoSyncAudit({ repository: repo });
    const rb = new ToledoRollbackService({ versionManager: versions, repository: repo, audit });
    const alvo = { host: '10.0.0.3', porta: 9000 };
    const snaps = new ToledoSnapshotService();
    const s1 = snaps.criar(CDS_V1);
    const v1 = await versions.criar(alvo, { hash: s1.hash, snapshot: s1 });
    await versions.finalizar(v1.id, { status: 'SUCESSO', snapshot: s1, hash: s1.hash, itens: 2 });
    const s2 = snaps.criar(CDS_V2);
    const v2 = await versions.criar(alvo, { hash: s2.hash, snapshot: s2 });
    await versions.finalizar(v2.id, { status: 'FALHA', snapshot: s2, hash: s2.hash, falhas: 1 });

    const result = await rb.rollback(alvo, { reenviar: false });
    assert.equal(result.success, true);
    assert.equal(result.restoredFrom.versao, 1);
    const list = await versions.listar(alvo);
    assert.ok(list.length >= 3); // v1, v2, rollback
    assert.ok(list.some((v) => v.status === 'ROLLBACK'));
  });
});

describe('Delta 15.5 — Service syncDelta', () => {
  it('não reenvia quando sem alterações', async () => {
    const repo = new ToledoDeltaRepository({ memory: true });
    const snaps = new ToledoSnapshotService();
    const s = snaps.criar(CDS_V1);
    const versions = new ToledoVersionManager({ repository: repo });
    const alvo = { host: '127.0.0.1', porta: 19000 };
    const v = await versions.criar(alvo, { hash: s.hash, snapshot: s });
    await versions.finalizar(v.id, { status: 'SUCESSO', snapshot: s, hash: s.hash });

    const engine = {
      bind() {},
      async execute() { throw new Error('não deveria enviar'); }
    };
    const service = createSyncService({
      memory: true,
      deltaRepository: repo,
      engine,
      connectionManager: {
        isConnected() { return true; },
        async connect() { return {}; }
      },
      repository: {
        async criarSync() { return 1; },
        async atualizarSync() {},
        async inserirItem() {},
        async atualizarItem() {},
        async buscarPorId() { return { itens: [] }; },
        async historico() { return []; }
      }
    });

    const r = await service.syncDelta({
      ...alvo,
      confirm: true,
      produtos: CDS_V1,
      persistir: false
    });
    assert.equal(r.semAlteracoes, true);
    assert.equal(r.code, CODES.NO_CHANGES);
  });

  it('executa delta e grava versão', async () => {
    const repo = new ToledoDeltaRepository({ memory: true });
    let enviados = 0;
    const engine = {
      bind() {},
      async execute() {
        enviados += 1;
        return { sucesso: true, checksum: 'AA', validacao: true, parsed: { valid: true, command: 'AK' } };
      }
    };
    const service = createSyncService({
      memory: true,
      deltaRepository: repo,
      engine,
      connectionManager: {
        isConnected() { return true; },
        async connect() { return {}; }
      },
      repository: {
        async criarSync() { return 7; },
        async atualizarSync() {},
        async inserirItem() { return 1; },
        async atualizarItem() {},
        async buscarPorId() { return { itens: [] }; },
        async historico() { return []; }
      }
    });

    const r = await service.syncDelta({
      host: '127.0.0.1',
      porta: 19001,
      confirm: true,
      produtos: CDS_V2,
      ultimaSync: CDS_V1,
      persistir: true,
      autoRollback: false
    });
    assert.equal(r.success, true);
    assert.equal(r.modo, 'delta');
    assert.ok(r.versao >= 1);
    assert.ok(r.hash);
    assert.ok(enviados >= 2);
  });
});
