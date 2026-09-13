'use strict';

/**
 * Cache adaptativo LRU + LFU.
 * Entradas frequentes (LFU alto) resistem à evicção.
 * Chaves protegidas (HotCache / favoritos) nunca são removidas pelo trim.
 */
class AdaptiveCache {
  /**
   * @param {number} [maxEntries=300]
   */
  constructor(maxEntries = 300) {
    this._max = Math.max(1, Number(maxEntries) || 300);
    /** @type {Map<string, { itens: any[], meta: object, ts: number, freq: number }>} */
    this._map = new Map();
    /** @type {Set<string>} */
    this._protegidas = new Set();
    this.hits = 0;
    this.misses = 0;
  }

  setMax(n) {
    this._max = Math.max(1, Number(n) || 300);
    this._evict();
  }

  proteger(chave) {
    if (chave) this._protegidas.add(String(chave));
  }

  desproteger(chave) {
    this._protegidas.delete(String(chave));
  }

  get(chave) {
    const key = String(chave || '');
    if (!key || !this._map.has(key)) {
      this.misses += 1;
      return undefined;
    }
    const val = this._map.get(key);
    val.freq = (val.freq || 0) + 1;
    val.ts = Date.now();
    // LRU refresh
    this._map.delete(key);
    this._map.set(key, val);
    this.hits += 1;
    return val;
  }

  set(chave, itens, meta = {}) {
    const key = String(chave || '');
    if (!key) return;
    const prev = this._map.get(key);
    if (prev) this._map.delete(key);
    this._map.set(key, {
      itens: Array.isArray(itens) ? itens : [],
      meta: meta || {},
      ts: Date.now(),
      freq: prev ? (prev.freq || 1) : 1
    });
    this._evict();
  }

  /**
   * Remove entradas menos valiosas (baixo LFU + mais antigas),
   * preservando protegidas e top-LFU.
   * @param {number} [alvo] — tamanho desejado após trim
   * @param {Set<number>} [idsProtegidos]
   */
  trim(alvo, idsProtegidos = null) {
    const target = Math.max(10, Number(alvo) || Math.floor(this._max * 0.6));
    if (this._map.size <= target) return 0;

    const entries = [...this._map.entries()].map(([k, v]) => ({
      key: k,
      freq: v.freq || 0,
      ts: v.ts || 0,
      protegida: this._protegidas.has(k) || this._entryTemIdProtegido(v, idsProtegidos)
    }));

    // Score: freq alto + recente = manter
    entries.sort((a, b) => {
      if (a.protegida !== b.protegida) return a.protegida ? 1 : -1;
      if (a.freq !== b.freq) return a.freq - b.freq;
      return a.ts - b.ts;
    });

    let removidos = 0;
    for (const e of entries) {
      if (this._map.size <= target) break;
      if (e.protegida) continue;
      this._map.delete(e.key);
      removidos += 1;
    }
    return removidos;
  }

  _entryTemIdProtegido(val, idsProtegidos) {
    if (!idsProtegidos || !idsProtegidos.size || !val?.itens) return false;
    return val.itens.some((p) => idsProtegidos.has(Number(p.id)));
  }

  _evict() {
    while (this._map.size > this._max) {
      // Candidato: menor score LFU entre os 25% mais antigos (LRU)
      const keys = [...this._map.keys()];
      const janela = Math.max(1, Math.floor(keys.length * 0.25));
      let victim = null;
      let worst = Infinity;
      for (let i = 0; i < janela; i += 1) {
        const k = keys[i];
        if (this._protegidas.has(k)) continue;
        const freq = this._map.get(k)?.freq || 0;
        if (freq < worst) {
          worst = freq;
          victim = k;
        }
      }
      if (!victim) {
        // fallback: remove oldest não protegida
        victim = keys.find((k) => !this._protegidas.has(k)) || keys[0];
      }
      if (!victim) break;
      this._map.delete(victim);
    }
  }

  invalidatePrefix(prefixo) {
    const p = String(prefixo || '');
    if (!p) return 0;
    let n = 0;
    for (const key of [...this._map.keys()]) {
      if (key.startsWith(p) && !this._protegidas.has(key)) {
        this._map.delete(key);
        n += 1;
      }
    }
    return n;
  }

  clear(force = false) {
    if (force) {
      this._map.clear();
    } else {
      for (const key of [...this._map.keys()]) {
        if (!this._protegidas.has(key)) this._map.delete(key);
      }
    }
    this.hits = 0;
    this.misses = 0;
  }

  stats() {
    const total = this.hits + this.misses;
    let maxFreq = 0;
    for (const v of this._map.values()) {
      if ((v.freq || 0) > maxFreq) maxFreq = v.freq;
    }
    return {
      tamanho: this._map.size,
      max: this._max,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Number((this.hits / total).toFixed(3)) : 0,
      protegidas: this._protegidas.size,
      maxFreq,
      modo: 'LRU+LFU'
    };
  }
}

module.exports = AdaptiveCache;
