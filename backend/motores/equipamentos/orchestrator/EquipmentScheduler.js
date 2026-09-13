/**
 * Sprint 15.6 — EquipmentScheduler
 * Agendamentos: diário, semanal, por horário e por evento.
 */

'use strict';

const crypto = require('crypto');
const { JOB_TYPES } = require('./EquipmentJob');

const SCHEDULE_TIPOS = Object.freeze({
  DIARIO: 'diario',
  SEMANAL: 'semanal',
  HORARIO: 'horario',
  EVENTO: 'evento'
});

function novoId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `sch-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function parseHora(hora) {
  const m = String(hora || '00:00').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { h: 0, min: 0 };
  return { h: Math.min(23, Number(m[1])), min: Math.min(59, Number(m[2])) };
}

class EquipmentScheduler {
  /**
   * @param {Object} deps
   * @param {Function} [deps.onFire] (schedule) => void
   * @param {Function} [deps.agora]
   */
  constructor(deps = {}) {
    /** @type {Map<string, Object>} */
    this._schedules = new Map();
    this.onFire = deps.onFire || (() => {});
    this.agora = deps.agora || (() => new Date());
    this._timer = null;
    this._tickMs = deps.tickMs || 15000;
    this._ultimaChave = new Map(); // scheduleId -> 'YYYY-MM-DD-HH:MM'
  }

  criar(dados = {}) {
    const id = dados.id || novoId();
    const schedule = {
      id,
      nome: dados.nome || `Agenda ${id.slice(0, 8)}`,
      tipo: dados.tipo || SCHEDULE_TIPOS.DIARIO,
      hora: dados.hora || '03:00',
      diasSemana: Array.isArray(dados.diasSemana) ? dados.diasSemana.map(Number) : [1, 2, 3, 4, 5],
      evento: dados.evento || null,
      equipamentoIds: Array.isArray(dados.equipamentoIds) ? dados.equipamentoIds : [],
      equipamentos: Array.isArray(dados.equipamentos)
        ? dados.equipamentos
        : (Array.isArray(dados.equipamentosDetalhe) ? dados.equipamentosDetalhe : []),
      modoSync: dados.modoSync || dados.tipoJob || JOB_TYPES.SYNC_DELTA,
      ativo: dados.ativo !== false,
      usuario: dados.usuario || null,
      criadoEm: dados.criadoEm || this.agora().toISOString(),
      ultimoDisparo: null
    };
    this._schedules.set(id, schedule);
    return { ...schedule };
  }

  listar() {
    return [...this._schedules.values()].map((s) => ({ ...s }));
  }

  obter(id) {
    const s = this._schedules.get(id);
    return s ? { ...s } : null;
  }

  atualizar(id, patch = {}) {
    const s = this._schedules.get(id);
    if (!s) return null;
    Object.assign(s, patch, { id: s.id });
    return { ...s };
  }

  remover(id) {
    return this._schedules.delete(id);
  }

  /**
   * Disparo manual por evento (ex.: produto alterado).
   * @param {string} evento
   * @returns {Object[]}
   */
  dispararEvento(evento) {
    const fired = [];
    for (const s of this._schedules.values()) {
      if (!s.ativo || s.tipo !== SCHEDULE_TIPOS.EVENTO) continue;
      if (s.evento && s.evento !== evento) continue;
      s.ultimoDisparo = this.agora().toISOString();
      this.onFire(s);
      fired.push({ ...s });
    }
    return fired;
  }

  /**
   * Avalia agendas por horário (chamado pelo tick).
   * @returns {Object[]}
   */
  tick(agora = this.agora()) {
    const fired = [];
    const d = agora instanceof Date ? agora : new Date(agora);
    const dia = d.getDay(); // 0=dom
    const chaveMinuto = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

    for (const s of this._schedules.values()) {
      if (!s.ativo) continue;
      if (s.tipo === SCHEDULE_TIPOS.EVENTO) continue;

      const { h, min } = parseHora(s.hora);
      if (d.getHours() !== h || d.getMinutes() !== min) continue;

      if (s.tipo === SCHEDULE_TIPOS.SEMANAL && !s.diasSemana.includes(dia)) continue;

      // horario = uma vez no minuto; diario = todos os dias no horário; semanal = dias filtrados
      if (this._ultimaChave.get(s.id) === chaveMinuto) continue;
      this._ultimaChave.set(s.id, chaveMinuto);
      s.ultimoDisparo = d.toISOString();
      this.onFire(s);
      fired.push({ ...s });
    }
    return fired;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      try { this.tick(); } catch (_) { /* ignore */ }
    }, this._tickMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

EquipmentScheduler.SCHEDULE_TIPOS = SCHEDULE_TIPOS;

module.exports = EquipmentScheduler;
