/**
 * Sprint 15.6 — Testes Central de Orquestração de Balanças
 */
'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const EquipmentOrchestrator = require('../../backend/motores/equipamentos/orchestrator/EquipmentOrchestrator');
const { resetOrchestrator } = require('../../backend/motores/equipamentos/orchestrator');
const { JOB_TYPES, JOB_STATUS } = require('../../backend/motores/equipamentos/orchestrator/EquipmentJob');
const EquipmentScheduler = require('../../backend/motores/equipamentos/orchestrator/EquipmentScheduler');

const BALANCAS = [
  { id: 1, nome: 'Prix IV Açougue', host: '10.0.0.101', porta: 9000, firmware: '90AX-1.0' },
  { id: 2, nome: 'Prix IV Padaria', host: '10.0.0.102', porta: 9000, firmware: '90AX-1.0' },
  { id: 3, nome: 'Prix IV Hortifruti', host: '10.0.0.103', porta: 9000, firmware: '90AX-1.1' }
];

function criarOrch(overrides = {}) {
  const syncLog = [];
  const orch = new EquipmentOrchestrator({
    autoStartScheduler: false,
    syncRunner: async (job) => {
      syncLog.push(job.alvo.equipamentoId);
      await new Promise((r) => setTimeout(r, 5));
      return { success: true, versao: 1, equipamentoId: job.alvo.equipamentoId };
    },
    pingRunner: async (alvo) => ({
      ok: alvo.host !== '10.0.0.199',
      tempoRespostaMs: 12,
      firmware: alvo.firmware || '90AX'
    }),
    listEquipamentos: async () => BALANCAS,
    ...overrides
  });
  orch.registrarParque(BALANCAS);
  orch._syncLog = syncLog;
  return orch;
}

describe('Orchestrator 15.6 — múltiplas balanças / fila', () => {
  afterEach(() => resetOrchestrator());

  it('enfileira e executa sync independente por balança', async () => {
    const orch = criarOrch();
    const jobs = orch.criarJobs({
      tipo: JOB_TYPES.SYNC_DELTA,
      equipamentos: BALANCAS.map((b) => ({
        equipamentoId: b.id,
        nome: b.nome,
        host: b.host,
        porta: b.porta
      })),
      usuario: 'teste'
    });
    assert.equal(jobs.length, 3);
    assert.ok(jobs.every((j) => j.status === JOB_STATUS.PENDENTE || j.status === JOB_STATUS.EXECUTANDO));

    const ok = await orch.drain(3000);
    assert.equal(ok, true);
    const done = orch.listarJobs({ limite: 20 }).filter((j) => j.status === JOB_STATUS.CONCLUIDO);
    assert.equal(done.length, 3);
    assert.equal(new Set(orch._syncLog).size, 3);
  });

  it('fila serial por equipamento e paralela entre equipamentos', async () => {
    let maxParallel = 0;
    let current = 0;
    const orch = criarOrch({
      syncRunner: async (job) => {
        current += 1;
        maxParallel = Math.max(maxParallel, current);
        await new Promise((r) => setTimeout(r, 20));
        current -= 1;
        return { success: true, id: job.alvo.equipamentoId };
      }
    });

    orch.criarJobs({
      tipo: JOB_TYPES.SYNC_FULL,
      equipamentos: [
        { equipamentoId: 1, host: '10.0.0.101', porta: 9000 },
        { equipamentoId: 1, host: '10.0.0.101', porta: 9000 },
        { equipamentoId: 2, host: '10.0.0.102', porta: 9000 },
        { equipamentoId: 3, host: '10.0.0.103', porta: 9000 }
      ]
    });

    await orch.drain(5000);
    assert.ok(maxParallel >= 2, `esperava paralelismo entre balanças, got ${maxParallel}`);
    assert.ok(maxParallel <= 3);
    const concluidos = orch.listarJobs({ status: JOB_STATUS.CONCLUIDO });
    assert.equal(concluidos.length, 4);
  });

  it('cancela job pendente', async () => {
    const orch = criarOrch({
      syncRunner: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { success: true };
      }
    });
    const jobs = orch.criarJobs({
      tipo: JOB_TYPES.SYNC_DELTA,
      equipamentos: [
        { equipamentoId: 1, host: '10.0.0.101' },
        { equipamentoId: 1, host: '10.0.0.101' }
      ]
    });
    const cancelado = orch.cancelarJob(jobs[1].id);
    assert.ok(cancelado);
    assert.equal(cancelado.status, JOB_STATUS.CANCELADO);
  });
});

describe('Orchestrator 15.6 — scheduler', () => {
  afterEach(() => resetOrchestrator());

  it('agenda diária dispara no horário', () => {
    const fired = [];
    const sch = new EquipmentScheduler({
      onFire: (s) => fired.push(s.id),
      agora: () => new Date('2026-07-30T03:00:00')
    });
    const agenda = sch.criar({
      tipo: 'diario',
      hora: '03:00',
      nome: 'Sync madrugada',
      equipamentos: [{ equipamentoId: 1, host: '10.0.0.101' }]
    });
    const r = sch.tick(new Date('2026-07-30T03:00:10'));
    assert.equal(r.length, 1);
    assert.equal(fired[0], agenda.id);
    // não dispara duas vezes no mesmo minuto
    assert.equal(sch.tick(new Date('2026-07-30T03:00:40')).length, 0);
  });

  it('agenda semanal respeita dia da semana', () => {
    const sch = new EquipmentScheduler({ agora: () => new Date() });
    sch.criar({
      tipo: 'semanal',
      hora: '10:00',
      diasSemana: [1], // segunda
      equipamentos: [{ equipamentoId: 1, host: '10.0.0.1' }]
    });
    // 2026-07-30 é quinta (4)
    const r = sch.tick(new Date('2026-07-30T10:00:00'));
    assert.equal(r.length, 0);
    // 2026-07-27 é segunda
    const r2 = sch.tick(new Date('2026-07-27T10:00:00'));
    assert.equal(r2.length, 1);
  });

  it('evento dispara sync via orchestrator', async () => {
    const orch = criarOrch();
    orch.criarAgenda({
      tipo: 'evento',
      evento: 'produto_alterado',
      equipamentos: BALANCAS.map((b) => ({
        equipamentoId: b.id,
        host: b.host,
        porta: b.porta
      })),
      modoSync: JOB_TYPES.SYNC_INCREMENTAL
    });
    const fired = orch.dispararEvento('produto_alterado');
    assert.equal(fired.length, 1);
    await orch.drain(3000);
    assert.ok(orch.listarJobs({ status: JOB_STATUS.CONCLUIDO }).length >= 3);
  });
});

describe('Orchestrator 15.6 — health / dashboard / notificações', () => {
  afterEach(() => resetOrchestrator());

  it('health check marca online/offline e notifica', async () => {
    const orch = criarOrch();
    orch.criarJobs({
      tipo: JOB_TYPES.HEALTH_CHECK,
      equipamentos: [
        { equipamentoId: 1, host: '10.0.0.101', porta: 9000 },
        { equipamentoId: 9, host: '10.0.0.199', porta: 9000, nome: 'Offline' }
      ]
    });
    await orch.drain(3000);
    const h1 = orch.health.obter({ equipamentoId: 1, host: '10.0.0.101', porta: 9000 });
    const h9 = orch.health.obter({ equipamentoId: 9, host: '10.0.0.199', porta: 9000 });
    assert.equal(h1.status, 'ONLINE');
    assert.equal(h9.status, 'OFFLINE');
    const notifs = orch.notificacoes();
    assert.ok(notifs.some((n) => n.tipo === 'balanca_offline' || n.tipo === 'sincronizacao_falhou'));
  });

  it('dashboard agrega parque', async () => {
    const orch = criarOrch();
    orch.health.registrarHeartbeat(
      { equipamentoId: 1, host: '10.0.0.101', porta: 9000, nome: 'Açougue' },
      { ok: true, tempoRespostaMs: 8 }
    );
    orch.health.registrarHeartbeat(
      { equipamentoId: 2, host: '10.0.0.102', porta: 9000 },
      { ok: false }
    );
    orch.criarJobs({
      tipo: JOB_TYPES.SYNC_DELTA,
      equipamentos: [{ equipamentoId: 1, host: '10.0.0.101', porta: 9000 }]
    });
    await orch.drain(2000);

    const dash = orch.dashboard();
    assert.ok(dash.quantidade >= 2);
    assert.ok(dash.online >= 1);
    assert.ok(Array.isArray(dash.equipamentos));
    assert.ok(dash.tempoMedioMs == null || dash.tempoMedioMs >= 0);
    assert.ok(dash.fila);
  });

  it('notifica rollback, firmware e divergência', () => {
    const orch = criarOrch();
    const alvo = { equipamentoId: 1, host: '10.0.0.101', nome: 'Açougue' };
    orch.notifyRollback(alvo, { versao: 2 });
    orch.notifyFirmware(alvo, 'FW antigo');
    orch.notifyDivergencia(alvo, 'hash diverge');
    const n = orch.notificacoes();
    assert.equal(n.length, 3);
    assert.ok(n.some((x) => x.tipo === 'rollback_executado'));
    assert.ok(n.some((x) => x.tipo === 'firmware_incompativel'));
    assert.ok(n.some((x) => x.tipo === 'divergencia_detectada'));
  });

  it('statistics reflete sync ok/erro', async () => {
    let falhou = false;
    const orch = criarOrch({
      syncRunner: async (job) => {
        if (job.alvo.equipamentoId === 2) {
          falhou = true;
          throw new Error('falha sync');
        }
        return { success: true };
      }
    });
    orch.criarJobs({
      tipo: JOB_TYPES.SYNC_DELTA,
      equipamentos: [
        { equipamentoId: 1, host: '10.0.0.101' },
        { equipamentoId: 2, host: '10.0.0.102' }
      ]
    });
    await orch.drain(3000);
    const st = orch.statistics();
    assert.equal(st.syncOk, 1);
    assert.equal(st.syncErro, 1);
    assert.equal(falhou, true);
    assert.ok(orch.notificacoes().some((n) => n.tipo === 'sincronizacao_falhou'));
  });
});
