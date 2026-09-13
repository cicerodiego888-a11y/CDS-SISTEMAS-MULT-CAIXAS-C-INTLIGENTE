/**
 * Sprint 15.8 — EventStream (ring buffer + persistência)
 */

'use strict';

const { EventEmitter } = require('events');
const repo = require('./ObservabilityRepository');

const MAX_MEM = 500;

class EventStream extends EventEmitter {
  constructor() {
    super();
    this._buffer = [];
  }

  /**
   * @param {Object} evento
   */
  async push(evento = {}) {
    const item = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tipo: evento.tipo || 'info',
      severidade: evento.severidade || 'info',
      equipamentoId: evento.equipamentoId ?? null,
      driverId: evento.driverId || null,
      mensagem: evento.mensagem || '',
      payload: evento.payload || {},
      registradoEm: evento.registradoEm || new Date().toISOString()
    };

    this._buffer.unshift(item);
    if (this._buffer.length > MAX_MEM) this._buffer.length = MAX_MEM;

    try {
      item.dbId = await repo.inserirEvento(item);
    } catch {
      /* persistência best-effort */
    }

    this.emit('event', item);
    this.emit(item.tipo, item);
    return item;
  }

  listar({ limite = 100, tipo = null } = {}) {
    let lista = this._buffer;
    if (tipo) lista = lista.filter((e) => e.tipo === tipo);
    return lista.slice(0, Math.min(Number(limite) || 100, MAX_MEM));
  }

  async listarPersistido(opcoes = {}) {
    return repo.listarEventos(opcoes);
  }

  limpar() {
    this._buffer = [];
  }
}

const eventStream = new EventStream();

module.exports = eventStream;
module.exports.EventStream = EventStream;
