/**
 * Camada de cache do Monitoring Engine.
 * Sprint M1: somente estrutura — sem cache real.
 */

class MonitoringCache {
  constructor() {
    this._enabled = false;
    this._store = new Map();
  }

  isEnabled() {
    return this._enabled === true;
  }

  /**
   * Sempre miss em M1 (estrutura preparada para M2+).
   * @returns {null}
   */
  get(/* chave */) {
    return null;
  }

  /**
   * No-op em M1.
   */
  set(/* chave, valor, ttlMs */) {
    return false;
  }

  clear() {
    this._store.clear();
  }
}

module.exports = {
  MonitoringCache,
  monitoringCache: new MonitoringCache()
};
