/**
 * RC14.14.3 — OfficialDriverLoader
 * Ponto único de carregamento: Plugin Registry + SDK Registry + aliases.
 *
 * Fluxo:
 *   OfficialDriverLoader
 *     → drivers/DriverLoader (plugins BaseDriver / Discovery)
 *     → sdk/DriverLoader (Device Profiles)
 *     → DriverIdentityResolver.aplicarAliases
 */

'use strict';

const identity = require('./DriverIdentityResolver');
const sdkLoader = require('./DriverLoader');
const sdkRegistry = require('./DriverRegistry');
const pluginLoader = require('../drivers/DriverLoader');
const pluginRegistry = require('../drivers/DriverRegistry');

let _carregado = false;
let _ultimoRelatorio = null;

function carregarTodos(opcoes = {}) {
  const forcar = opcoes.forcar === true;
  if (_carregado && !forcar && _ultimoRelatorio) {
    return _ultimoRelatorio;
  }

  const plugins = pluginLoader.carregarTodos({ forcar });
  const sdk = sdkLoader.carregarTodos({ forcar });

  identity.aplicarAliasesNosRegistries(pluginRegistry, sdkRegistry);

  _carregado = true;
  _ultimoRelatorio = {
    ok: true,
    timestamp: new Date().toISOString(),
    plugins,
    sdk,
    identidade: {
      codigo_oficial: identity.CODIGO_OFICIAL,
      codigo_sdk: identity.CODIGO_SDK,
      aliases: identity.ALIASES
    }
  };
  return _ultimoRelatorio;
}

function ensureLoaded(opcoes = {}) {
  return carregarTodos(opcoes);
}

function estaCarregado() {
  return _carregado && sdkLoader.estaCarregado?.() !== false;
}

function reload() {
  _carregado = false;
  return carregarTodos({ forcar: true });
}

function obterRelatorio() {
  return _ultimoRelatorio;
}

/**
 * Resolve identidade e localiza profile SDK / plugin.
 */
function resolver(codigoOuAlias) {
  const id = identity.resolve(codigoOuAlias);
  ensureLoaded();
  const profile = sdkRegistry.buscar(id.codigo)
    || sdkRegistry.buscar(id.codigo_sdk)
    || sdkRegistry.buscar(codigoOuAlias);
  const plugin = pluginRegistry.buscar(id.codigo)
    || pluginRegistry.buscar(codigoOuAlias);
  return {
    ...id,
    profile: profile || null,
    plugin: plugin || null
  };
}

module.exports = {
  carregarTodos,
  ensureLoaded,
  estaCarregado,
  reload,
  obterRelatorio,
  resolver,
  identity
};
