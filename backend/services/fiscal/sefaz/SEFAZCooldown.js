/**
 * Cooldown operacional por CNPJ+ambiente (+ tipo opcional).
 */
'use strict';

const {
  COOLDOWN_137_MS,
  COOLDOWN_656_MS,
  chaveIdentidade
} = require('./sefazGateConstants');

class SEFAZCooldown {
  constructor(opts = {}) {
    this._agora = opts.agora || (() => Date.now());
    this._cooldown137Ms = opts.cooldown137Ms != null ? Number(opts.cooldown137Ms) : COOLDOWN_137_MS;
    this._cooldown656Ms = opts.cooldown656Ms != null ? Number(opts.cooldown656Ms) : COOLDOWN_656_MS;
    /** @type {Map<string, { ate: number, motivo: string, cStat: string|null, tipo: string|null, request_id: string|null }>} */
    this._map = new Map();
  }

  _key(cnpj, ambiente) {
    return chaveIdentidade(cnpj, ambiente);
  }

  obter(cnpj, ambiente) {
    const key = this._key(cnpj, ambiente);
    const row = this._map.get(key);
    if (!row) return null;
    if (row.ate <= this._agora()) {
      this._map.delete(key);
      return null;
    }
    return {
      ativo: true,
      cooldown_ate: new Date(row.ate).toISOString(),
      motivo: row.motivo,
      cStat: row.cStat,
      tipoConsulta: row.tipo,
      request_id: row.request_id,
      wait_ms: Math.max(0, row.ate - this._agora())
    };
  }

  estaAtivo(cnpj, ambiente) {
    return this.obter(cnpj, ambiente) != null;
  }

  registrar({ cnpj, ambiente, cStat, tipo, request_id, duracaoMs, motivo }) {
    const c = String(cStat || '');
    let ms = Number(duracaoMs);
    if (!Number.isFinite(ms) || ms <= 0) {
      if (c === '656') ms = this._cooldown656Ms;
      else if (c === '137') ms = this._cooldown137Ms;
      else ms = this._cooldown656Ms;
    }
    const ate = this._agora() + ms;
    this._map.set(this._key(cnpj, ambiente), {
      ate,
      motivo: motivo || (c === '656' ? 'CSTAT_656' : (c === '137' ? 'CSTAT_137' : 'COOLDOWN')),
      cStat: c || null,
      tipo: tipo || null,
      request_id: request_id || null
    });
    return this.obter(cnpj, ambiente);
  }

  limpar(cnpj, ambiente) {
    this._map.delete(this._key(cnpj, ambiente));
  }

  _resetForTests() {
    this._map.clear();
  }
}

module.exports = {
  SEFAZCooldown,
  cooldownPadrao: new SEFAZCooldown()
};
