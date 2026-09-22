/**
 * SEFAZRateLimiter — frequência mínima por CNPJ+ambiente+tipo.
 */
'use strict';

const {
  RATE_LIMIT_MIN_INTERVAL_MS,
  chaveIdentidade,
  normalizarAmbiente
} = require('./sefazGateConstants');

class SEFAZRateLimiter {
  constructor(opts = {}) {
    this._minIntervalMs = opts.minIntervalMs != null
      ? Number(opts.minIntervalMs)
      : RATE_LIMIT_MIN_INTERVAL_MS;
    this._agora = opts.agora || (() => Date.now());
    /** @type {Map<string, number>} */
    this._ultimoMs = new Map();
  }

  _chave(cnpj, ambiente, tipo) {
    return `${chaveIdentidade(cnpj, ambiente)}|${String(tipo || '')}`;
  }

  podeConsultar(cnpj, ambiente, tipo) {
    const info = this.quandoConsultar(cnpj, ambiente, tipo);
    return info.permitido === true;
  }

  quandoConsultar(cnpj, ambiente, tipo) {
    const key = this._chave(cnpj, ambiente, tipo);
    const agora = this._agora();
    const ultimo = this._ultimoMs.get(key) || 0;
    const elapsed = agora - ultimo;
    if (!ultimo || elapsed >= this._minIntervalMs) {
      return {
        permitido: true,
        retry_at: null,
        wait_ms: 0,
        motivo: null
      };
    }
    const wait = this._minIntervalMs - elapsed;
    return {
      permitido: false,
      retry_at: new Date(agora + wait).toISOString(),
      wait_ms: wait,
      motivo: 'RATE_LIMIT'
    };
  }

  motivoBloqueio(cnpj, ambiente, tipo) {
    const info = this.quandoConsultar(cnpj, ambiente, tipo);
    return info.permitido ? null : info.motivo;
  }

  registrarConsulta(cnpj, ambiente, tipo) {
    this._ultimoMs.set(this._chave(cnpj, ambiente, tipo), this._agora());
  }

  _resetForTests() {
    this._ultimoMs.clear();
  }
}

module.exports = {
  SEFAZRateLimiter,
  rateLimiterPadrao: new SEFAZRateLimiter()
};
