'use strict';

/**
 * Monitor de memória — limpa cache adaptativo sem tocar HotCache/favoritos.
 */
class MemoryMonitor {
  /**
   * @param {{
   *   cache: import('../cache/AdaptiveCache'),
   *   hotCache: import('../cache/HotCache'),
   *   config: import('../config/MibConfig'),
   *   logger?: object,
   *   onTrim?: Function
   * }} deps
   */
  constructor(deps) {
    this.cache = deps.cache;
    this.hotCache = deps.hotCache;
    this.config = deps.config;
    this.logger = deps.logger || null;
    this.onTrim = typeof deps.onTrim === 'function' ? deps.onTrim : null;
    this._timer = null;
    this.trimCount = 0;
  }

  start(intervalMs = 15000) {
    this.stop();
    this._timer = setInterval(() => this.verificar(), intervalMs);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  usoMb() {
    const mem = process.memoryUsage();
    return {
      rss: Number((mem.rss / 1024 / 1024).toFixed(1)),
      heapUsed: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
      heapTotal: Number((mem.heapTotal / 1024 / 1024).toFixed(1))
    };
  }

  verificar() {
    const limite = Number(this.config.get('limiteRamMb')) || 512;
    const uso = this.usoMb();
    if (uso.heapUsed < limite) return null;

    const protegidos = this.hotCache ? this.hotCache.idsProtegidos() : new Set();
    const removidos = this.cache.trim(Math.floor(this.cache._max * 0.5), protegidos);
    this.trimCount += 1;
    if (this.logger) {
      this.logger.warn('memory', {
        heapUsed: uso.heapUsed,
        limite,
        removidos
      });
    }
    const result = { ...uso, limite, removidos, trimCount: this.trimCount };
    if (this.onTrim) {
      try { this.onTrim(result); } catch (_) { /* ignore */ }
    }
    return result;
  }
}

module.exports = MemoryMonitor;
