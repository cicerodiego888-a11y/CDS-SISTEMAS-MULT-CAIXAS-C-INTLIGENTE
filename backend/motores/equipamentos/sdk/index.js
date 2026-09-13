/**
 * Sprint 15.7 / RC14.14.3 — Device Profile SDK
 *
 * Plataforma extensível para novos fabricantes sem alterar o núcleo.
 * Identidade Toledo: DriverIdentityResolver → TOLEDO_PRIX4_UNO
 */

'use strict';

const DeviceProfile = require('./DeviceProfile');
const DriverCapabilities = require('./DriverCapabilities');
const DriverManifest = require('./DriverManifest');
const DriverCompatibility = require('./DriverCompatibility');
const DriverValidator = require('./DriverValidator');
const DriverAdapter = require('./DriverAdapter');
const DriverIdentityResolver = require('./DriverIdentityResolver');
const registry = require('./DriverRegistry');
const loader = require('./DriverLoader');
const officialLoader = require('./OfficialDriverLoader');
const DriverTemplateGenerator = require('./DriverTemplateGenerator');

function ensureLoaded(opcoes = {}) {
  return officialLoader.ensureLoaded(opcoes);
}

function reload() {
  return officialLoader.reload();
}

function listarDrivers(filtros = {}) {
  ensureLoaded();
  return DriverAdapter.paraContratoErpLista(registry.listar(filtros));
}

function obterDriver(id) {
  ensureLoaded();
  const resolved = DriverIdentityResolver.resolve(id);
  const p = registry.buscar(resolved.codigo)
    || registry.buscar(resolved.codigo_sdk)
    || registry.buscar(id);
  return p ? DriverAdapter.paraContratoErp(p) : null;
}

module.exports = {
  DeviceProfile,
  DriverCapabilities,
  DriverManifest,
  DriverCompatibility,
  DriverValidator,
  DriverAdapter,
  DriverIdentityResolver,
  OfficialDriverLoader: officialLoader,
  registry,
  loader,
  officialLoader,
  DriverTemplateGenerator,
  get DriverSdkRoutes() {
    return require('./DriverSdkRoutes');
  },
  get DriverSdkController() {
    return require('./DriverSdkController');
  },
  ensureLoaded,
  reload,
  listarDrivers,
  obterDriver,
  paraContratoErp: DriverAdapter.paraContratoErp,
  paraContratoErpLista: DriverAdapter.paraContratoErpLista
};
