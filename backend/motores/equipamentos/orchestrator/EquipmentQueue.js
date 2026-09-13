/**
 * Sprint 15.6 — EquipmentQueue
 * Fila por equipamento (uma execução por vez por balança).
 */

'use strict';

const { JOB_STATUS } = require('./EquipmentJob');

class EquipmentQueue {
  constructor(deps = {}) {
    /** @type {Map<string, Object[]>} */
    this._filas = new Map();
    /** @type {Map<string, Object>} */
    this._executando = new Map();
    /** @type {Object[]} */
    this._historico = [];
    this._limiteHistorico = deps.limiteHistorico || 500;
  }

  enqueue(job) {
    const key = job.key;
    if (!this._filas.has(key)) this._filas.set(key, []);
    const fila = this._filas.get(key);
    fila.push(job);
    fila.sort((a, b) => (b.prioridade || 0) - (a.prioridade || 0)
      || String(a.criadoEm).localeCompare(String(b.criadoEm)));
    return job;
  }

  /**
   * Próximo job pendente da fila (sem remover se já há execução).
   * @param {string} key
   * @returns {Object|null}
   */
  peekNext(key) {
    if (this._executando.has(key)) return null;
    const fila = this._filas.get(key) || [];
    return fila.find((j) => j.status === JOB_STATUS.PENDENTE) || null;
  }

  /**
   * Remove da fila e marca como em execução.
   * @param {string} key
   * @returns {Object|null}
   */
  dequeueForExecution(key) {
    if (this._executando.has(key)) return null;
    const fila = this._filas.get(key) || [];
    const idx = fila.findIndex((j) => j.status === JOB_STATUS.PENDENTE);
    if (idx < 0) return null;
    const [job] = fila.splice(idx, 1);
    this._executando.set(key, job);
    return job;
  }

  finish(job) {
    if (this._executando.get(job.key)?.id === job.id) {
      this._executando.delete(job.key);
    }
    this._historico.unshift(job);
    if (this._historico.length > this._limiteHistorico) {
      this._historico.length = this._limiteHistorico;
    }
  }

  cancel(jobId, motivo = 'cancelado') {
    for (const [key, fila] of this._filas.entries()) {
      const idx = fila.findIndex((j) => j.id === jobId && j.status === JOB_STATUS.PENDENTE);
      if (idx >= 0) {
        const [job] = fila.splice(idx, 1);
        job.status = JOB_STATUS.CANCELADO;
        job.erro = motivo;
        job.finalizadoEm = new Date().toISOString();
        this._historico.unshift(job);
        return job;
      }
      void key;
    }
    const exec = [...this._executando.values()].find((j) => j.id === jobId);
    if (exec) {
      exec.status = JOB_STATUS.CANCELADO;
      exec.erro = motivo;
      exec.finalizadoEm = new Date().toISOString();
      this._executando.delete(exec.key);
      this._historico.unshift(exec);
      return exec;
    }
    return null;
  }

  list(filtros = {}) {
    const pendentes = [];
    for (const fila of this._filas.values()) {
      pendentes.push(...fila);
    }
    const executando = [...this._executando.values()];
    let todos = [...executando, ...pendentes, ...this._historico];
    if (filtros.status) {
      todos = todos.filter((j) => j.status === filtros.status);
    }
    if (filtros.equipamentoId != null) {
      const id = Number(filtros.equipamentoId);
      todos = todos.filter((j) => Number(j.alvo?.equipamentoId) === id);
    }
    if (filtros.key) {
      todos = todos.filter((j) => j.key === filtros.key);
    }
    const limite = Number(filtros.limite) || 100;
    return todos.slice(0, limite);
  }

  snapshot() {
    let pendentes = 0;
    for (const fila of this._filas.values()) pendentes += fila.length;
    return {
      filasAtivas: this._filas.size,
      pendentes,
      executando: this._executando.size,
      historico: this._historico.length,
      porEquipamento: [...this._filas.entries()].map(([key, fila]) => ({
        key,
        pendentes: fila.length,
        executando: this._executando.has(key)
      }))
    };
  }

  keysComPendentes() {
    const keys = new Set();
    for (const [key, fila] of this._filas.entries()) {
      if (fila.some((j) => j.status === JOB_STATUS.PENDENTE)) keys.add(key);
    }
    return [...keys];
  }

  keysExecutando() {
    return [...this._executando.keys()];
  }

  clear() {
    this._filas.clear();
    this._executando.clear();
    this._historico = [];
  }
}

module.exports = EquipmentQueue;
