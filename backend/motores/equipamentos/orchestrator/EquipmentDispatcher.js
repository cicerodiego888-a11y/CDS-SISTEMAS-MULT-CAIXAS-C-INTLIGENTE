/**
 * Sprint 15.6 — EquipmentDispatcher
 * Distribui jobs para várias balanças com execução independente.
 */

'use strict';

const {
  criarJob,
  marcarExecutando,
  marcarConcluido,
  marcarErro,
  JOB_TYPES
} = require('./EquipmentJob');

class EquipmentDispatcher {
  /**
   * @param {Object} deps
   * @param {import('./EquipmentQueue')} deps.queue
   * @param {Function} [deps.executor] async (job) => resultado
   * @param {Function} [deps.onJobStart]
   * @param {Function} [deps.onJobDone]
   * @param {Function} [deps.onJobError]
   * @param {Function} [deps.agora]
   */
  constructor(deps = {}) {
    this.queue = deps.queue;
    this.executor = deps.executor || (async () => ({ success: true, skipped: true }));
    this.onJobStart = deps.onJobStart || (() => {});
    this.onJobDone = deps.onJobDone || (() => {});
    this.onJobError = deps.onJobError || (() => {});
    this.agora = deps.agora || (() => new Date());
    /** @type {Set<string>} */
    this._pumping = new Set();
  }

  /**
   * Enfileira jobs para um ou vários equipamentos.
   * @param {Object} pedido
   * @returns {Object[]}
   */
  enqueueMany(pedido = {}) {
    const alvos = Array.isArray(pedido.equipamentos)
      ? pedido.equipamentos
      : (pedido.equipamento ? [pedido.equipamento] : [pedido]);

    const jobs = alvos.map((alvo) => {
      const job = criarJob({
        ...alvo,
        tipo: pedido.tipo || alvo.tipo || JOB_TYPES.SYNC_DELTA,
        payload: pedido.payload || alvo.payload || {},
        prioridade: pedido.prioridade ?? alvo.prioridade,
        usuario: pedido.usuario || alvo.usuario,
        scheduleId: pedido.scheduleId || null,
        maxTentativas: pedido.maxTentativas
      });
      this.queue.enqueue(job);
      return job;
    });

    this.pumpAll();
    return jobs;
  }

  /**
   * Dispara processamento paralelo (1 worker por equipamento).
   */
  pumpAll() {
    for (const key of this.queue.keysComPendentes()) {
      this._pumpKey(key).catch(() => {});
    }
  }

  async _pumpKey(key) {
    if (this._pumping.has(key)) return;
    this._pumping.add(key);
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const job = this.queue.dequeueForExecution(key);
        if (!job) break;
        await this._executar(job);
      }
    } finally {
      this._pumping.delete(key);
    }
  }

  async _executar(job) {
    marcarExecutando(job, this.agora());
    this.onJobStart(job);
    try {
      const resultado = await this.executor(job);
      marcarConcluido(job, resultado || { success: true }, this.agora());
      this.queue.finish(job);
      this.onJobDone(job);
    } catch (err) {
      marcarErro(job, err, this.agora());
      this.queue.finish(job);
      this.onJobError(job, err);
    }
  }

  /**
   * Aguarda esvaziar filas (testes / sync bloqueante).
   * @param {number} [timeoutMs]
   */
  async drain(timeoutMs = 10000) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeoutMs) {
      this.pumpAll();
      const snap = this.queue.snapshot();
      if (snap.pendentes === 0 && snap.executando === 0 && this._pumping.size === 0) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    return false;
  }
}

module.exports = EquipmentDispatcher;
