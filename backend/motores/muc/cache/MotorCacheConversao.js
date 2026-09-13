/**
 * MUC RC2 — Cache desacoplado (motor permanece stateless)
 * @module motores/muc/cache/MotorCacheConversao
 */
'use strict';

const { gerarHash } = require('../dto/ResultadoConversaoDTO');

class MotorCacheConversao {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 200;
    this._store = new Map();
  }

  _chave(input) {
    return gerarHash({
      produtoId: input?.produtoId,
      apresentacaoId: input?.apresentacaoId ?? input?.embalagemId,
      item: input?.item,
      origem: input?.origem
    });
  }

  get(input) {
    const key = this._chave(input);
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > this.ttlMs) {
      this._store.delete(key);
      return null;
    }
    return entry.resultado;
  }

  set(input, resultado) {
    if (this._store.size >= this.maxEntries) {
      const first = this._store.keys().next().value;
      this._store.delete(first);
    }
    this._store.set(this._chave(input), { resultado, ts: Date.now() });
  }

  executar(input, executorFn) {
    const cached = this.get(input);
    if (cached) return cached;
    const resultado = executorFn(input);
    this.set(input, resultado);
    return resultado;
  }

  limpar() {
    this._store.clear();
  }

  tamanho() {
    return this._store.size;
  }
}

module.exports = { MotorCacheConversao };
