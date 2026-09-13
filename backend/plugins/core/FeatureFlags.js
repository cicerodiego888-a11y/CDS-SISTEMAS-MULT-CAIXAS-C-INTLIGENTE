'use strict';

/**
 * Feature flags em memória — sem alterar schema do banco.
 * Escopos: global | empresa | filial | perfil | usuario
 */
class FeatureFlags {
  constructor() {
    /** @type {Map<string, boolean>} */
    this._flags = new Map();
  }

  _key(pluginId, scope, scopeId) {
    return `${pluginId}::${scope || 'global'}::${scopeId == null ? '*' : scopeId}`;
  }

  /**
   * @param {string} pluginId
   * @param {boolean} enabled
   * @param {{ scope?: string, scopeId?: string|number|null }} [opts]
   */
  set(pluginId, enabled, opts = {}) {
    const scope = opts.scope || 'global';
    const scopeId = opts.scopeId == null ? '*' : opts.scopeId;
    this._flags.set(this._key(pluginId, scope, scopeId), Boolean(enabled));
  }

  /**
   * Resolve: usuario > perfil > filial > empresa > global > defaultEnabled
   * @param {string} pluginId
   * @param {{ empresa_id?: any, filial_id?: any, perfil?: string, usuario_id?: any, defaultEnabled?: boolean }} [ctx]
   */
  isEnabled(pluginId, ctx = {}) {
    const checks = [
      ['usuario', ctx.usuario_id],
      ['perfil', ctx.perfil],
      ['filial', ctx.filial_id],
      ['empresa', ctx.empresa_id],
      ['global', '*']
    ];
    for (const [scope, id] of checks) {
      if (id == null && scope !== 'global') continue;
      const k = this._key(pluginId, scope, scope === 'global' ? '*' : id);
      if (this._flags.has(k)) return this._flags.get(k);
    }
    return ctx.defaultEnabled !== false;
  }

  list() {
    const out = [];
    for (const [k, v] of this._flags.entries()) {
      const [pluginId, scope, scopeId] = k.split('::');
      out.push({ pluginId, scope, scopeId, enabled: v });
    }
    return out;
  }

  clear(pluginId) {
    for (const k of [...this._flags.keys()]) {
      if (k.startsWith(`${pluginId}::`)) this._flags.delete(k);
    }
  }
}

module.exports = FeatureFlags;
