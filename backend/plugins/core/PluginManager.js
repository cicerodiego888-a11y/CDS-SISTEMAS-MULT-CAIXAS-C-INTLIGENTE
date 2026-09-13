'use strict';

const fs = require('fs');
const path = require('path');
const PluginSandbox = require('./PluginSandbox');
const FeatureFlags = require('./FeatureFlags');
const PluginLogger = require('./PluginLogger');
const { CIA_APPS_VERSION, CIA_APPS_CODIGO, CIA_APPS_STATUS } = require('../version');

/**
 * Plugin Manager — carga dinâmica, enable/disable sem reiniciar.
 */
class PluginManager {
  /**
   * @param {{ pluginsDir?: string, db?: any, timeoutMs?: number }} [opts]
   */
  constructor(opts = {}) {
    this.pluginsDir = opts.pluginsDir || path.join(__dirname, '..');
    this.db = opts.db || null;
    this.timeoutMs = Number(opts.timeoutMs) || 8000;
    this.flags = new FeatureFlags();
    this.logger = new PluginLogger();
    /** @type {Map<string, object>} */
    this.registry = new Map();
    this._startedAt = Date.now();
  }

  setDb(db) {
    this.db = db;
  }

  /**
   * Descobre pastas com manifest.json (exceto core/).
   */
  discover() {
    const dirs = fs.readdirSync(this.pluginsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !['core', 'node_modules'].includes(d.name))
      .map((d) => d.name);

    const found = [];
    for (const name of dirs) {
      const base = path.join(this.pluginsDir, name);
      const manifestPath = path.join(base, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        found.push({ id: manifest.id || name, dir: base, manifest });
      } catch (_) { /* ignore broken manifest */ }
    }
    return found;
  }

  /**
   * Carrega todos os plugins descobertos (falha individual não aborta).
   */
  async loadAll() {
    const list = this.discover();
    const results = [];
    for (const item of list) {
      results.push(await this.load(item.id));
    }
    return results;
  }

  /**
   * @param {string} pluginId
   */
  async load(pluginId) {
    if (this.registry.has(pluginId) && this.registry.get(pluginId).loaded) {
      return { ok: true, pluginId, already: true };
    }

    const found = this.discover().find((p) => p.id === pluginId || path.basename(p.dir) === pluginId);
    if (!found) {
      return { ok: false, pluginId, error: 'Plugin não encontrado' };
    }

    const permissionsPath = path.join(found.dir, 'permissions.json');
    let permissions = {};
    if (fs.existsSync(permissionsPath)) {
      try {
        permissions = JSON.parse(fs.readFileSync(permissionsPath, 'utf8'));
      } catch (_) { /* ignore */ }
    }

    const pluginTimeout = Number(found.manifest.timeoutMs) || this.timeoutMs;
    const sandbox = new PluginSandbox({ timeoutMs: pluginTimeout });
    let instance = null;
    let loadError = null;

    try {
      const pluginPath = path.join(found.dir, 'plugin.js');
      delete require.cache[require.resolve(pluginPath)];
      // eslint-disable-next-line import/no-dynamic-require
      const factory = require(pluginPath);
      instance = typeof factory === 'function' ? factory() : factory;
    } catch (err) {
      loadError = err.message;
    }

    const entry = {
      id: found.manifest.id || pluginId,
      version: found.manifest.version || '0.0.0',
      name: found.manifest.name || pluginId,
      description: found.manifest.description || '',
      motors: found.manifest.motors || [],
      enabled: found.manifest.enabled !== false,
      permissions,
      dir: found.dir,
      instance,
      sandbox,
      timeoutMs: pluginTimeout,
      loaded: false,
      loadError,
      lastHealth: null,
      stats: { calls: 0, errors: 0, totalMs: 0 }
    };

    if (instance && typeof instance.load === 'function' && !loadError) {
      const r = await sandbox.run(() => instance.load({
        db: this.db,
        manager: this,
        manifest: found.manifest,
        permissions
      }));
      if (r.ok) {
        entry.loaded = true;
      } else {
        entry.loadError = r.error;
        entry.loaded = false;
      }
      this.logger.registrar({
        plugin: entry.id,
        evento: 'load',
        ok: r.ok,
        erro: r.error,
        tempoMs: r.tempoMs,
        memoriaMb: this._memMb()
      });
    } else if (!loadError && instance) {
      entry.loaded = true;
    }

    this.registry.set(entry.id, entry);
    this.flags.set(entry.id, entry.enabled, { scope: 'global' });
    return {
      ok: entry.loaded,
      pluginId: entry.id,
      error: entry.loadError || null
    };
  }

  async unload(pluginId) {
    const entry = this.registry.get(pluginId);
    if (!entry) return { ok: false, error: 'Plugin não carregado' };

    if (entry.instance && typeof entry.instance.unload === 'function') {
      await entry.sandbox.run(() => entry.instance.unload());
    }
    entry.loaded = false;
    entry.instance = null;
    this.logger.registrar({ plugin: pluginId, evento: 'unload', ok: true, memoriaMb: this._memMb() });
    return { ok: true, pluginId };
  }

  /**
   * Liga/desliga sem reiniciar processo.
   */
  setEnabled(pluginId, enabled, scopeOpts = {}) {
    this.flags.set(pluginId, enabled, scopeOpts);
    const entry = this.registry.get(pluginId);
    if (entry && (!scopeOpts.scope || scopeOpts.scope === 'global')) {
      entry.enabled = Boolean(enabled);
    }
    this.logger.registrar({
      plugin: pluginId,
      evento: enabled ? 'enable' : 'disable',
      ok: true
    });
    return { ok: true, pluginId, enabled: Boolean(enabled) };
  }

  isEnabled(pluginId, userCtx = {}) {
    const entry = this.registry.get(pluginId);
    return this.flags.isEnabled(pluginId, {
      empresa_id: userCtx.empresa_id,
      filial_id: userCtx.filial_id,
      perfil: userCtx.perfil || userCtx.role,
      usuario_id: userCtx.id || userCtx.usuario_id,
      defaultEnabled: entry ? entry.enabled !== false : true
    });
  }

  /**
   * Invoca método do plugin com sandbox.
   */
  async invoke(pluginId, method, args = {}, userCtx = {}) {
    const entry = this.registry.get(pluginId);
    if (!entry || !entry.loaded || !entry.instance) {
      return { ok: false, error: 'Plugin não disponível', code: 'PLUGIN_UNAVAILABLE' };
    }
    if (!this.isEnabled(pluginId, userCtx)) {
      return { ok: false, error: 'Plugin desligado (feature flag)', code: 'PLUGIN_DISABLED' };
    }
    if (typeof entry.instance[method] !== 'function') {
      return { ok: false, error: `Método ${method} inexistente`, code: 'PLUGIN_METHOD' };
    }

    const memBefore = this._memMb();
    const r = await entry.sandbox.run(
      () => entry.instance[method](args, {
        db: this.db,
        user: userCtx,
        permissions: entry.permissions
      }),
      { timeoutMs: args._timeoutMs || entry.timeoutMs || this.timeoutMs }
    );

    entry.stats.calls += 1;
    entry.stats.totalMs += r.tempoMs || 0;
    if (!r.ok) entry.stats.errors += 1;

    this.logger.registrar({
      plugin: pluginId,
      evento: method,
      ok: r.ok,
      erro: r.error,
      tempoMs: r.tempoMs,
      memoriaMb: this._memMb() - memBefore
    });

    if (!r.ok) {
      return {
        ok: false,
        error: r.error,
        code: r.code,
        tempoMs: r.tempoMs,
        pluginId
      };
    }
    return {
      ok: true,
      result: r.result,
      tempoMs: r.tempoMs,
      pluginId,
      version: entry.version
    };
  }

  async health(pluginId) {
    if (pluginId) {
      const entry = this.registry.get(pluginId);
      if (!entry) return { ok: false, error: 'não encontrado' };
      let pluginHealth = { ok: entry.loaded };
      if (entry.loaded && entry.instance && typeof entry.instance.health === 'function') {
        const r = await entry.sandbox.run(() => entry.instance.health());
        pluginHealth = r.ok ? r.result : { ok: false, error: r.error };
      }
      entry.lastHealth = pluginHealth;
      return {
        pluginId,
        loaded: entry.loaded,
        enabled: this.isEnabled(pluginId),
        version: entry.version,
        sandbox: entry.sandbox.health(),
        health: pluginHealth,
        stats: entry.stats,
        loadError: entry.loadError
      };
    }

    const plugins = [];
    for (const id of this.registry.keys()) {
      plugins.push(await this.health(id));
    }
    return {
      codigo: CIA_APPS_CODIGO,
      versao: CIA_APPS_VERSION,
      status: CIA_APPS_STATUS,
      uptimeMs: Date.now() - this._startedAt,
      memoriaMb: this._memMb(),
      plugins
    };
  }

  list() {
    return [...this.registry.values()].map((e) => ({
      id: e.id,
      name: e.name,
      version: e.version,
      description: e.description,
      motors: e.motors,
      loaded: e.loaded,
      enabled: this.isEnabled(e.id),
      loadError: e.loadError,
      stats: e.stats
    }));
  }

  dashboard() {
    const logs = this.logger.stats();
    return {
      codigo: CIA_APPS_CODIGO,
      versao: CIA_APPS_VERSION,
      status: CIA_APPS_STATUS,
      memoriaMb: this._memMb(),
      uptimeMs: Date.now() - this._startedAt,
      plugins: this.list(),
      flags: this.flags.list(),
      logs,
      recentes: this.logger.recentes(40)
    };
  }

  /**
   * Reinicia plugin (unload + load) — rollback operacional.
   */
  async restart(pluginId) {
    await this.unload(pluginId);
    return this.load(pluginId);
  }

  _memMb() {
    return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;
  }
}

/** @type {PluginManager|null} */
let singleton = null;

function obterPluginManager(opts) {
  if (!singleton) singleton = new PluginManager(opts || {});
  else if (opts?.db) singleton.setDb(opts.db);
  return singleton;
}

function resetPluginManager() {
  singleton = null;
}

module.exports = {
  PluginManager,
  obterPluginManager,
  resetPluginManager
};
