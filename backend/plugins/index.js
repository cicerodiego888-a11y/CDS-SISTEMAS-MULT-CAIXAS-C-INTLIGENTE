'use strict';

/**
 * CIA-APPS — plataforma de plugins (copilotos especializados).
 * Não altera regras de negócio do ERP/PDV.
 */

const {
  PluginManager,
  obterPluginManager,
  resetPluginManager
} = require('./core/PluginManager');
const PluginSandbox = require('./core/PluginSandbox');
const FeatureFlags = require('./core/FeatureFlags');
const PluginLogger = require('./core/PluginLogger');
const CircuitBreaker = require('./core/CircuitBreaker');
const {
  CIA_APPS_VERSION,
  CIA_APPS_STATUS,
  CIA_APPS_CODIGO,
  CIA_APPS_RELEASE_DATE
} = require('./version');

/**
 * Bootstrap seguro — falha nunca propaga.
 * @param {{ db?: any }} [opts]
 */
async function bootstrapPlugins(opts = {}) {
  try {
    const pm = obterPluginManager({ db: opts.db });
    if (opts.db) pm.setDb(opts.db);
    const results = await pm.loadAll();
    return { ok: true, results, dashboard: pm.dashboard() };
  } catch (err) {
    console.error(JSON.stringify({
      tag: 'CIA-APPS',
      evento: 'BOOTSTRAP_ERROR',
      erro: err.message
    }));
    return { ok: false, error: err.message };
  }
}

module.exports = {
  CIA_APPS_VERSION,
  CIA_APPS_STATUS,
  CIA_APPS_CODIGO,
  CIA_APPS_RELEASE_DATE,
  PluginManager,
  PluginSandbox,
  FeatureFlags,
  PluginLogger,
  CircuitBreaker,
  obterPluginManager,
  resetPluginManager,
  bootstrapPlugins
};
