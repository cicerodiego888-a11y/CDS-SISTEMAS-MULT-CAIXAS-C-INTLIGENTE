'use strict';

/**
 * Memória operacional da conversa (por sessão/usuário).
 * Em memória + opcional persistência leve de histórico (não é dado de negócio).
 */
class OperationalMemory {
  constructor() {
    /** @type {Map<string, object>} */
    this._sessions = new Map();
  }

  _key(ctx) {
    return `${ctx.operador_id || 0}:${ctx.sessao_id || 'default'}`;
  }

  get(ctx) {
    const k = this._key(ctx);
    if (!this._sessions.has(k)) {
      this._sessions.set(k, {
        turnos: [],
        ultimaLista: [],
        ultimasEntidades: {},
        ultimoIntent: null,
        pendenteConfirmacao: null
      });
    }
    return this._sessions.get(k);
  }

  rememberTurn(ctx, turno) {
    const mem = this.get(ctx);
    mem.turnos.push({
      ...turno,
      em: new Date().toISOString()
    });
    if (mem.turnos.length > 40) mem.turnos.shift();
    if (turno.intent) mem.ultimoIntent = turno.intent;
    if (turno.entidades) mem.ultimasEntidades = { ...mem.ultimasEntidades, ...turno.entidades };
    if (Array.isArray(turno.lista) && turno.lista.length) {
      mem.ultimaLista = turno.lista;
    }
  }

  setPendente(ctx, pendente) {
    this.get(ctx).pendenteConfirmacao = pendente;
  }

  clearPendente(ctx) {
    this.get(ctx).pendenteConfirmacao = null;
  }

  history(ctx, limite = 20) {
    return this.get(ctx).turnos.slice(-limite);
  }
}

module.exports = OperationalMemory;
