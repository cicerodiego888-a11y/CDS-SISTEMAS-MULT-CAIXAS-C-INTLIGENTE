/**
 * Sprint 15.1 / RC14.14.7 — ConnectionStateMachine
 * Estados unificados. CONNECTING nunca vai para IDLE sem CONNECTED.
 */

'use strict';

const STATES = Object.freeze({
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  BUSY: 'BUSY',
  IDLE: 'IDLE',
  RECONNECTING: 'RECONNECTING',
  ERROR: 'ERROR'
});

/**
 * Transições permitidas.
 * RC14.14.7 — PROIBIDO: CONNECTING → IDLE e RECONNECTING → IDLE
 * (sucesso de socket deve passar por CONNECTED).
 */
const TRANSICOES = Object.freeze({
  [STATES.DISCONNECTED]: new Set([STATES.CONNECTING, STATES.ERROR]),
  [STATES.CONNECTING]: new Set([
    STATES.CONNECTED,
    STATES.DISCONNECTED,
    STATES.ERROR
  ]),
  [STATES.CONNECTED]: new Set([
    STATES.BUSY,
    STATES.IDLE,
    STATES.RECONNECTING,
    STATES.DISCONNECTED,
    STATES.ERROR
  ]),
  [STATES.IDLE]: new Set([
    STATES.BUSY,
    STATES.CONNECTED,
    STATES.RECONNECTING,
    STATES.DISCONNECTED,
    STATES.ERROR
  ]),
  [STATES.BUSY]: new Set([
    STATES.CONNECTED,
    STATES.IDLE,
    STATES.RECONNECTING,
    STATES.DISCONNECTED,
    STATES.ERROR
  ]),
  [STATES.RECONNECTING]: new Set([
    STATES.CONNECTING,
    STATES.CONNECTED,
    STATES.DISCONNECTED,
    STATES.ERROR
  ]),
  [STATES.ERROR]: new Set([STATES.DISCONNECTED, STATES.CONNECTING, STATES.RECONNECTING])
});

class ConnectionStateMachine {
  /**
   * @param {{estadoInicial?:string, onTransition?:Function}} [opcoes]
   */
  constructor(opcoes = {}) {
    this._estado = opcoes.estadoInicial || STATES.DISCONNECTED;
    this._historico = [];
    this._onTransition = typeof opcoes.onTransition === 'function' ? opcoes.onTransition : null;
  }

  get estado() {
    return this._estado;
  }

  get historico() {
    return this._historico.slice();
  }

  /** Conexão utilizável para I/O. */
  get ativo() {
    return this._estado === STATES.CONNECTED
      || this._estado === STATES.IDLE
      || this._estado === STATES.BUSY;
  }

  podeTransitar(para) {
    const dest = String(para || '').toUpperCase();
    const permitidos = TRANSICOES[this._estado];
    return Boolean(permitidos && permitidos.has(dest));
  }

  /**
   * @param {string} para
   * @param {object} [meta]
   * @returns {{from:string, to:string, em:string, meta:object}}
   */
  transitar(para, meta = {}) {
    const dest = String(para || '').toUpperCase();
    if (!STATES[dest]) {
      const err = new Error(`Estado inválido: ${para}`);
      err.code = 'STATE_INVALIDO';
      throw err;
    }

    // RC14.14.7 — bloqueio explícito (mesmo se alguém reintroduzir na tabela)
    if (
      (this._estado === STATES.CONNECTING || this._estado === STATES.RECONNECTING)
      && dest === STATES.IDLE
    ) {
      const err = new Error(
        `Transição proibida RC14.14.7: ${this._estado} → IDLE (obrigatório passar por CONNECTED)`
      );
      err.code = 'STATE_TRANSITION_PROIBIDA';
      err.from = this._estado;
      err.to = dest;
      throw err;
    }

    if (this._estado === dest) {
      return { from: this._estado, to: dest, em: new Date().toISOString(), meta, noop: true };
    }
    if (!this.podeTransitar(dest)) {
      const err = new Error(`Transição inválida: ${this._estado} → ${dest}`);
      err.code = 'STATE_TRANSITION_INVALIDA';
      err.from = this._estado;
      err.to = dest;
      throw err;
    }
    const from = this._estado;
    this._estado = dest;
    const evento = {
      from,
      to: dest,
      em: new Date().toISOString(),
      meta: meta || {}
    };
    this._historico.push(evento);
    if (this._historico.length > 100) this._historico.shift();
    if (this._onTransition) {
      try { this._onTransition(evento); } catch (_) { /* ignore */ }
    }
    return evento;
  }

  /** Força estado (recovery / bootstrap) sem validar. */
  forcar(para, meta = {}) {
    const dest = String(para || '').toUpperCase();
    const from = this._estado;
    this._estado = dest;
    const evento = { from, to: dest, em: new Date().toISOString(), meta: { ...meta, forcado: true } };
    this._historico.push(evento);
    if (this._onTransition) {
      try { this._onTransition(evento); } catch (_) { /* ignore */ }
    }
    return evento;
  }

  reset() {
    this._estado = STATES.DISCONNECTED;
    this._historico = [];
  }
}

module.exports = ConnectionStateMachine;
module.exports.ConnectionStateMachine = ConnectionStateMachine;
module.exports.STATES = STATES;
module.exports.TRANSICOES = TRANSICOES;
