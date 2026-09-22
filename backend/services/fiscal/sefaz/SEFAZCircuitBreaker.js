/**
 * Circuit Breaker por CNPJ + ambiente.
 * Estados: CLOSED | OPEN | HALF_OPEN
 */
'use strict';

const {
  CIRCUIT_STATE,
  CIRCUIT_OPEN_MS,
  chaveIdentidade
} = require('./sefazGateConstants');

class SEFAZCircuitBreaker {
  constructor(opts = {}) {
    this._agora = opts.agora || (() => Date.now());
    this._openMs = opts.openMs != null ? Number(opts.openMs) : CIRCUIT_OPEN_MS;
    /** @type {Map<string, { state: string, openedAt: number, lastError: string|null, halfOpenUsed: boolean }>} */
    this._map = new Map();
  }

  _key(cnpj, ambiente) {
    return chaveIdentidade(cnpj, ambiente);
  }

  _ensure(cnpj, ambiente) {
    const key = this._key(cnpj, ambiente);
    if (!this._map.has(key)) {
      this._map.set(key, {
        state: CIRCUIT_STATE.CLOSED,
        openedAt: 0,
        lastError: null,
        halfOpenUsed: false
      });
    }
    return this._map.get(key);
  }

  obterEstado(cnpj, ambiente) {
    const row = this._ensure(cnpj, ambiente);
    if (row.state === CIRCUIT_STATE.OPEN) {
      const elapsed = this._agora() - row.openedAt;
      if (elapsed >= this._openMs) {
        row.state = CIRCUIT_STATE.HALF_OPEN;
        row.halfOpenUsed = false;
      }
    }
    return {
      state: row.state,
      openedAt: row.openedAt ? new Date(row.openedAt).toISOString() : null,
      lastError: row.lastError
    };
  }

  podeConsultar(cnpj, ambiente) {
    const st = this.obterEstado(cnpj, ambiente);
    if (st.state === CIRCUIT_STATE.CLOSED) {
      return { permitido: true, state: st.state };
    }
    if (st.state === CIRCUIT_STATE.OPEN) {
      return {
        permitido: false,
        state: st.state,
        motivo: 'CIRCUIT_OPEN',
        retry_at: new Date((this._ensure(cnpj, ambiente).openedAt || this._agora()) + this._openMs).toISOString()
      };
    }
    // HALF_OPEN — uma consulta de teste
    const row = this._ensure(cnpj, ambiente);
    if (row.halfOpenUsed) {
      return { permitido: false, state: st.state, motivo: 'CIRCUIT_HALF_OPEN_BUSY' };
    }
    return { permitido: true, state: st.state, halfOpen: true };
  }

  marcarHalfOpenEmUso(cnpj, ambiente) {
    const row = this._ensure(cnpj, ambiente);
    if (row.state === CIRCUIT_STATE.HALF_OPEN) {
      row.halfOpenUsed = true;
    }
  }

  registrarSucesso(cnpj, ambiente) {
    const row = this._ensure(cnpj, ambiente);
    row.state = CIRCUIT_STATE.CLOSED;
    row.openedAt = 0;
    row.lastError = null;
    row.halfOpenUsed = false;
  }

  registrarFalha(cnpj, ambiente, motivo) {
    const row = this._ensure(cnpj, ambiente);
    row.state = CIRCUIT_STATE.OPEN;
    row.openedAt = this._agora();
    row.lastError = motivo || 'FALHA';
    row.halfOpenUsed = false;
  }

  forcarOpen(cnpj, ambiente, motivo) {
    this.registrarFalha(cnpj, ambiente, motivo);
  }

  _resetForTests() {
    this._map.clear();
  }
}

module.exports = {
  SEFAZCircuitBreaker,
  circuitBreakerPadrao: new SEFAZCircuitBreaker()
};
