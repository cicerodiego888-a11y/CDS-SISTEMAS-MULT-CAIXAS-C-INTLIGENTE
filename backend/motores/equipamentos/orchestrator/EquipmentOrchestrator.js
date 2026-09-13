/**
 * Sprint 15.6 — EquipmentOrchestrator
 * Central de orquestração do parque de balanças.
 */

'use strict';

const EquipmentQueue = require('./EquipmentQueue');
const EquipmentDispatcher = require('./EquipmentDispatcher');
const EquipmentScheduler = require('./EquipmentScheduler');
const EquipmentHealthService = require('./EquipmentHealthService');
const EquipmentNotificationService = require('./EquipmentNotificationService');
const EquipmentStatistics = require('./EquipmentStatistics');
const { JOB_TYPES, JOB_STATUS, criarJob } = require('./EquipmentJob');

class EquipmentOrchestrator {
  /**
   * @param {Object} [deps]
   * @param {Function} [deps.syncRunner] async (job) => resultado
   * @param {Function} [deps.listEquipamentos] async () => equipamentos[]
   * @param {Function} [deps.pingRunner] async (alvo) => { ok, tempoRespostaMs, firmware }
   * @param {boolean} [deps.autoStartScheduler]
   */
  constructor(deps = {}) {
    this.agora = deps.agora || (() => new Date());
    this.queue = deps.queue || new EquipmentQueue();
    this.health = deps.health || new EquipmentHealthService({ agora: this.agora });
    this.notifications = deps.notifications || new EquipmentNotificationService({ agora: this.agora });
    this.stats = deps.stats || new EquipmentStatistics({
      health: this.health,
      queue: this.queue,
      notifications: this.notifications
    });

    this.syncRunner = deps.syncRunner || this._defaultSyncRunner.bind(this);
    this.pingRunner = deps.pingRunner || this._defaultPingRunner.bind(this);
    this.listEquipamentos = deps.listEquipamentos || (async () => []);

    this.dispatcher = deps.dispatcher || new EquipmentDispatcher({
      queue: this.queue,
      agora: this.agora,
      executor: (job) => this._executarJob(job),
      onJobStart: (job) => this._onJobStart(job),
      onJobDone: (job) => this._onJobDone(job),
      onJobError: (job, err) => this._onJobError(job, err)
    });

    this.scheduler = deps.scheduler || new EquipmentScheduler({
      agora: this.agora,
      tickMs: deps.schedulerTickMs || 15000,
      onFire: (schedule) => this._onScheduleFire(schedule)
    });

    if (deps.autoStartScheduler) {
      this.scheduler.start();
    }
  }

  async _defaultSyncRunner(job) {
    const { createSyncService } = require('../drivers/toledo/sync/ToledoSyncService');
    const svc = createSyncService();
    const modo = job.tipo === JOB_TYPES.SYNC_FULL
      ? 'full'
      : (job.tipo === JOB_TYPES.SYNC_INCREMENTAL ? 'incremental' : 'delta');
    const payload = job.payload || {};
    return svc.sync(modo, {
      confirm: true,
      host: job.alvo.host,
      porta: job.alvo.porta,
      equipamentoId: job.alvo.equipamentoId,
      produtos: payload.produtos || [],
      engine: '90AX',
      usuario: job.usuario,
      ...payload
    });
  }

  async _defaultPingRunner(alvo) {
    const inicio = Date.now();
    try {
      const connectionManager = require('../connection/ConnectionManager');
      await connectionManager.connect({
        equipamentoId: alvo.equipamentoId,
        host: alvo.host,
        porta: alvo.porta || 9000
      });
      return {
        ok: true,
        tempoRespostaMs: Date.now() - inicio,
        firmware: alvo.firmware || null
      };
    } catch (err) {
      return {
        ok: false,
        tempoRespostaMs: Date.now() - inicio,
        error: err.message
      };
    }
  }

  async _executarJob(job) {
    if (job.tipo === JOB_TYPES.HEALTH_CHECK || job.tipo === JOB_TYPES.CONNECT) {
      const ping = await this.pingRunner(job.alvo);
      this.health.registrarHeartbeat(job.alvo, ping);
      if (!ping.ok) {
        this.notifications.offline(job.alvo, ping.error);
        throw new Error(ping.error || 'Health check falhou');
      }
      return { success: true, health: ping };
    }

    if (job.tipo === JOB_TYPES.DIAGNOSTIC) {
      const ping = await this.pingRunner(job.alvo);
      this.health.registrarHeartbeat(job.alvo, ping);
      return { success: Boolean(ping.ok), diagnostic: ping };
    }

    const result = await this.syncRunner(job);
    if (result && result.success === false) {
      const err = new Error(result.error || result.mensagem || 'Sync falhou');
      err.code = result.code;
      throw err;
    }
    return result || { success: true };
  }

  _onJobStart(job) {
    if (String(job.tipo).startsWith('SYNC_')) {
      this.health.marcarSincronizando(job.alvo);
      this.health.upsert(job.alvo, { filaPendentes: this._filaDoEquipamento(job.key) });
    }
  }

  _onJobDone(job) {
    const ok = job.status === JOB_STATUS.CONCLUIDO;
    if (String(job.tipo).startsWith('SYNC_')) {
      this.health.registrarSync(job.alvo, {
        ok: true,
        versao: job.resultado?.versao || job.resultado?.version || null
      });
      this.stats.registrarDuracao(job.duracaoMs, true);
    }
    this.health.upsert(job.alvo, { filaPendentes: this._filaDoEquipamento(job.key) });
    void ok;
  }

  _onJobError(job, err) {
    if (String(job.tipo).startsWith('SYNC_')) {
      this.health.registrarSync(job.alvo, { ok: false, erro: err?.message });
      this.stats.registrarDuracao(job.duracaoMs, false);
      this.notifications.syncFalhou(job.alvo, err);
    } else if (job.tipo === JOB_TYPES.HEALTH_CHECK) {
      this.notifications.offline(job.alvo, err?.message);
    }
    this.health.upsert(job.alvo, { filaPendentes: this._filaDoEquipamento(job.key) });
  }

  _filaDoEquipamento(key) {
    return this.queue.list({ key, limite: 1000 })
      .filter((j) => j.status === JOB_STATUS.PENDENTE || j.status === JOB_STATUS.EXECUTANDO)
      .length;
  }

  _onScheduleFire(schedule) {
    const alvos = this._resolverAlvosSchedule(schedule);
    if (!alvos.length) return [];
    return this.criarJobs({
      tipo: schedule.modoSync || JOB_TYPES.SYNC_DELTA,
      equipamentos: alvos,
      scheduleId: schedule.id,
      usuario: schedule.usuario || 'scheduler',
      payload: { origem: 'scheduler', scheduleId: schedule.id }
    });
  }

  _resolverAlvosSchedule(schedule) {
    if (Array.isArray(schedule.equipamentos) && schedule.equipamentos.length
      && typeof schedule.equipamentos[0] === 'object') {
      return schedule.equipamentos;
    }
    // equipamentoIds numéricos — resolução lazy pelo caller via registerEquipamentos
    if (Array.isArray(schedule.equipamentoIds) && schedule.equipamentoIds.length) {
      return schedule.equipamentoIds.map((id) => {
        const h = this.health.listar().find((x) => Number(x.equipamentoId) === Number(id));
        return h || { equipamentoId: id };
      });
    }
    return this.health.listar().map((h) => ({
      equipamentoId: h.equipamentoId,
      nome: h.nome,
      host: h.host,
      porta: h.porta,
      firmware: h.firmware
    }));
  }

  /**
   * Registra / atualiza parque de balanças no health.
   */
  registrarParque(equipamentos = []) {
    return equipamentos.map((eq) => this.health.upsert({
      equipamentoId: eq.id ?? eq.equipamentoId ?? eq.equipamento_id,
      nome: eq.nome || eq.descricao,
      host: eq.host || eq.ip || eq.endereco_ip,
      porta: eq.porta ?? eq.porta_tcp ?? 9000,
      firmware: eq.firmware || eq.versao_firmware,
      loja: eq.loja || eq.setor
    }, {
      status: eq.status || eq.estado || undefined
    }));
  }

  criarJobs(pedido = {}) {
    const jobs = this.dispatcher.enqueueMany(pedido);
    for (const job of jobs) {
      this.health.upsert(job.alvo, {
        filaPendentes: this._filaDoEquipamento(job.key)
      });
    }
    return jobs;
  }

  listarJobs(filtros = {}) {
    return this.queue.list(filtros);
  }

  cancelarJob(jobId, motivo = 'cancelado pelo usuário') {
    return this.queue.cancel(jobId, motivo);
  }

  criarAgenda(dados = {}) {
    return this.scheduler.criar(dados);
  }

  listarAgendas() {
    return this.scheduler.listar();
  }

  dispararEvento(evento) {
    return this.scheduler.dispararEvento(evento);
  }

  tickScheduler(agora) {
    return this.scheduler.tick(agora);
  }

  async healthCheckAll(equipamentos) {
    const lista = equipamentos || await this.listEquipamentos();
    if (lista.length) this.registrarParque(lista);
    const alvos = (lista.length ? lista : this.health.listar()).map((eq) => ({
      equipamentoId: eq.id ?? eq.equipamentoId,
      nome: eq.nome,
      host: eq.host || eq.ip,
      porta: eq.porta ?? eq.porta_tcp ?? 9000,
      firmware: eq.firmware,
      tipo: JOB_TYPES.HEALTH_CHECK
    }));
    return this.criarJobs({
      tipo: JOB_TYPES.HEALTH_CHECK,
      equipamentos: alvos,
      usuario: 'health'
    });
  }

  healthList() {
    return this.health.listar();
  }

  notificacoes(limite = 50) {
    return this.notifications.listar(limite);
  }

  notifyRollback(alvo, detalhe) {
    return this.notifications.rollback(alvo, detalhe);
  }

  notifyDivergencia(alvo, mensagem) {
    return this.notifications.divergencia(alvo, mensagem);
  }

  notifyFirmware(alvo, mensagem) {
    return this.notifications.firmware(alvo, mensagem);
  }

  statistics() {
    return this.stats.snapshot();
  }

  dashboard() {
    const stats = this.statistics();
    const health = this.health.listar();
    const fila = this.queue.snapshot();
    const ultimaSync = health
      .map((h) => h.ultimaSync)
      .filter(Boolean)
      .sort()
      .reverse()[0] || null;

    return {
      quantidade: stats.balancas,
      online: stats.online,
      offline: stats.offline,
      sincronizando: stats.sincronizando,
      erro: stats.erro,
      tempoMedioMs: stats.tempoMedioSyncMs,
      fila: {
        pendentes: fila.pendentes,
        executando: fila.executando,
        porEquipamento: fila.porEquipamento
      },
      ultimaSincronizacao: ultimaSync,
      agendas: this.scheduler.listar().filter((a) => a.ativo).length,
      equipamentos: health.map((h) => ({
        equipamentoId: h.equipamentoId,
        nome: h.nome,
        host: h.host,
        porta: h.porta,
        status: h.status,
        firmware: h.firmware,
        carga: h.versaoCarga,
        ultimaSync: h.ultimaSync,
        tempoRespostaMs: h.tempoRespostaMs,
        fila: h.filaPendentes || 0
      })),
      notificacoes: this.notifications.listar(5)
    };
  }

  start() {
    this.scheduler.start();
    return { started: true };
  }

  stop() {
    this.scheduler.stop();
    return { stopped: true };
  }

  async drain(timeoutMs) {
    return this.dispatcher.drain(timeoutMs);
  }
}

EquipmentOrchestrator.JOB_TYPES = JOB_TYPES;
EquipmentOrchestrator.JOB_STATUS = JOB_STATUS;
EquipmentOrchestrator.criarJob = criarJob;

let singleton = null;

function getOrchestrator(deps) {
  if (!singleton || deps) {
    singleton = new EquipmentOrchestrator(deps || {});
  }
  return singleton;
}

function resetOrchestrator() {
  if (singleton) {
    singleton.stop();
    singleton = null;
  }
}

module.exports = EquipmentOrchestrator;
module.exports.getOrchestrator = getOrchestrator;
module.exports.resetOrchestrator = resetOrchestrator;
module.exports.equipmentOrchestrator = {
  get instance() {
    return getOrchestrator();
  }
};
