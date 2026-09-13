/**
 * Registry oficial dos providers do CDS Monitoring Engine.
 * Análogo conceitual ao WebServiceRegistry fiscal — domínio independente.
 */

class MonitoringRegistry {
  constructor() {
    /** @type {Map<string, Object>} */
    this._providers = new Map();
  }

  /**
   * @param {Object} provider — deve expor { id, collect(context) }
   */
  register(provider) {
    if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) {
      throw new Error('MonitoringRegistry: provider.id obrigatório');
    }
    if (typeof provider.collect !== 'function') {
      throw new Error(`MonitoringRegistry: provider "${provider.id}" sem collect()`);
    }
    this._providers.set(provider.id, provider);
    return this;
  }

  has(id) {
    return this._providers.has(id);
  }

  get(id) {
    return this._providers.get(id) || null;
  }

  list() {
    return Array.from(this._providers.keys());
  }

  all() {
    return Array.from(this._providers.values());
  }

  clear() {
    this._providers.clear();
  }
}

module.exports = {
  MonitoringRegistry
};
