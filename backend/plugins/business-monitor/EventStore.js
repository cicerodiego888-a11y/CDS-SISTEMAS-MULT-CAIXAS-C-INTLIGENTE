'use strict';

const PRIORIDADES = ['CRITICO', 'ALTO', 'MEDIO', 'BAIXO'];
const PRIORIDADE_PESO = { CRITICO: 0, ALTO: 1, MEDIO: 2, BAIXO: 3 };

/**
 * Central de eventos em memória — sem schema de banco.
 */
class EventStore {
  constructor(limite = 500) {
    this.limite = limite;
    /** @type {object[]} */
    this._events = [];
    this._seq = 0;
  }

  /**
   * @param {object} raw
   */
  push(raw) {
    const id = `bm-${Date.now()}-${++this._seq}`;
    const evento = {
      id,
      origem: raw.origem || 'business-monitor',
      monitor: raw.monitor || 'geral',
      tipo: raw.tipo || 'sinal',
      prioridade: PRIORIDADES.includes(raw.prioridade) ? raw.prioridade : 'MEDIO',
      data: raw.data || new Date().toISOString(),
      motor: raw.motor || 'CIP',
      impacto: raw.impacto || '',
      sugestao: raw.sugestao || '',
      mensagem: raw.mensagem || '',
      modulo: raw.modulo || null,
      status: 'aberto',
      fingerprint: raw.fingerprint || `${raw.monitor}:${raw.tipo}:${raw.mensagem}`,
      meta: raw.meta || null
    };

    // dedupe aberto com mesmo fingerprint
    const existing = this._events.find(
      (e) => e.status === 'aberto' && e.fingerprint === evento.fingerprint
    );
    if (existing) {
      existing.data = evento.data;
      existing.impacto = evento.impacto || existing.impacto;
      existing.contador = (existing.contador || 1) + 1;
      return existing;
    }

    this._events.push(evento);
    if (this._events.length > this.limite) this._events.shift();
    return evento;
  }

  list(filtros = {}) {
    let rows = [...this._events];
    if (filtros.status) rows = rows.filter((e) => e.status === filtros.status);
    if (filtros.prioridade) rows = rows.filter((e) => e.prioridade === filtros.prioridade);
    if (filtros.monitor) rows = rows.filter((e) => e.monitor === filtros.monitor);
    if (filtros.apenasAlertas) {
      rows = rows.filter((e) => e.prioridade === 'CRITICO' || e.prioridade === 'ALTO');
    }
    if (filtros.apenasOportunidades) {
      rows = rows.filter((e) => e.tipo === 'oportunidade' || e.monitor === 'oportunidade');
    }
    rows.sort((a, b) => {
      const pa = PRIORIDADE_PESO[a.prioridade] ?? 9;
      const pb = PRIORIDADE_PESO[b.prioridade] ?? 9;
      if (pa !== pb) return pa - pb;
      return String(b.data).localeCompare(String(a.data));
    });
    const limite = Number(filtros.limite) || 100;
    return rows.slice(0, limite);
  }

  get(id) {
    return this._events.find((e) => e.id === id) || null;
  }

  resolve(id, acao = 'resolver', nota = '') {
    const e = this.get(id);
    if (!e) return null;
    e.status = acao === 'ignorar' ? 'ignorado' : acao === 'tarefa' ? 'tarefa' : 'resolvido';
    e.resolvidoEm = new Date().toISOString();
    e.acao = acao;
    e.nota = String(nota || '').slice(0, 200);
    return e;
  }

  stats() {
    const abertos = this._events.filter((e) => e.status === 'aberto');
    const porPrioridade = {};
    for (const p of PRIORIDADES) porPrioridade[p] = abertos.filter((e) => e.prioridade === p).length;
    return {
      total: this._events.length,
      abertos: abertos.length,
      porPrioridade
    };
  }

  clear() {
    this._events = [];
  }
}

module.exports = { EventStore, PRIORIDADES };
