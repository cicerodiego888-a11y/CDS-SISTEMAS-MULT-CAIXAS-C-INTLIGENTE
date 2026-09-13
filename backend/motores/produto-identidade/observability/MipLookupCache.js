/**
 * Cache LRU simples para lookups do catálogo MIP (Sprint 08).
 * Sem TTL — invalidação explícita via clear() (testes / dual-write futuro).
 * @module motores/produto-identidade/observability/MipLookupCache
 */

class MipLookupCache {
  /**
   * @param {number} [maxEntries=500]
   */
  constructor(maxEntries = 500) {
    this._max = Math.max(1, Number(maxEntries) || 500);
    /** @type {Map<string, any>} */
    this._map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * @param {string} key
   */
  get(key) {
    if (!this._map.has(key)) {
      this.misses += 1;
      return undefined;
    }
    const val = this._map.get(key);
    // refresh LRU
    this._map.delete(key);
    this._map.set(key, val);
    this.hits += 1;
    return val;
  }

  /**
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    if (this._map.has(key)) this._map.delete(key);
    this._map.set(key, value);
    while (this._map.size > this._max) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
  }

  clear() {
    this._map.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get tamanho() {
    return this._map.size;
  }

  stats() {
    return {
      tamanho: this._map.size,
      max: this._max,
      hits: this.hits,
      misses: this.misses,
      hitRate: (this.hits + this.misses) > 0
        ? Number((this.hits / (this.hits + this.misses)).toFixed(3))
        : 0
    };
  }
}

module.exports = MipLookupCache;
