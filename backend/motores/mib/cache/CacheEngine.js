'use strict';

/**
 * Cache LRU de pesquisas MIB.
 */
class CacheEngine {
  /**
   * @param {number} [maxEntries=200]
   */
  constructor(maxEntries = 200) {
    this._max = Math.max(1, Number(maxEntries) || 200);
    /** @type {Map<string, { itens: any[], meta: object, ts: number }>} */
    this._map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * @param {string} chave
   */
  get(chave) {
    const key = String(chave || '');
    if (!key || !this._map.has(key)) {
      this.misses += 1;
      return undefined;
    }
    const val = this._map.get(key);
    this._map.delete(key);
    this._map.set(key, val);
    this.hits += 1;
    return val;
  }

  /**
   * @param {string} chave
   * @param {any[]} itens
   * @param {object} [meta]
   */
  set(chave, itens, meta = {}) {
    const key = String(chave || '');
    if (!key) return;
    if (this._map.has(key)) this._map.delete(key);
    this._map.set(key, {
      itens: Array.isArray(itens) ? itens : [],
      meta: meta || {},
      ts: Date.now()
    });
    while (this._map.size > this._max) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
  }

  invalidatePrefix(prefixo) {
    const p = String(prefixo || '');
    if (!p) return 0;
    let n = 0;
    for (const key of [...this._map.keys()]) {
      if (key.startsWith(p)) {
        this._map.delete(key);
        n += 1;
      }
    }
    return n;
  }

  clear() {
    this._map.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      tamanho: this._map.size,
      max: this._max,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Number((this.hits / total).toFixed(3)) : 0
    };
  }
}

module.exports = CacheEngine;
