/**
 * RC14.14.3 — DriverIdentityAudit
 * Valida consolidação: um código oficial, aliases, registries e pipeline.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const identity = require('./DriverIdentityResolver');

const ROOT = path.join(__dirname, '../../..');
const EQUIP = path.join(__dirname, '..');

function ler(relFromEquip) {
  try {
    return fs.readFileSync(path.join(EQUIP, relFromEquip), 'utf8');
  } catch {
    return '';
  }
}

function auditar() {
  const resolverSrc = ler('sdk/DriverIdentityResolver.js');
  const officialLoader = ler('sdk/OfficialDriverLoader.js');
  const adapter = ler('sdk/DriverAdapter.js');
  const protocol = ler('drivers/toledo/ToledoProtocol.js');
  const fingerprint = ler('fingerprint/DriverResolver.js');
  const catalog = ler('drivers/driverCatalog.js');
  const profile = ler('sdk/profiles/toledo-prix4.js');
  const frameMap = ler('laboratorio/frameBuilderMap.js');
  const service = ler('services/EquipamentosService.js');

  const resolverExiste = /CODIGO_OFICIAL\s*=\s*['"]TOLEDO_PRIX4_UNO['"]/.test(resolverSrc);
  const aliasesOk = /TOLEDO_PRIX4/.test(resolverSrc) && /toledo-prix4/.test(resolverSrc);
  const loaderUnificado = /OfficialDriverLoader|aplicarAliasesNosRegistries/.test(officialLoader);
  const adapterUsaResolver = /DriverIdentityResolver/.test(adapter);
  const protocoloCanonico = /DRIVER\s*=\s*['"]TOLEDO_PRIX4_UNO['"]/.test(protocol);
  const fingerprintCanonico = /TOLEDO_PRIX4_UNO/.test(fingerprint);
  const catalogoOficial = /codigo:\s*['"]TOLEDO_PRIX4_UNO['"]/.test(catalog);
  const sdkPreservaId = /id:\s*['"]toledo-prix4['"]/.test(profile)
    && /catalogoLegado:\s*['"]TOLEDO_PRIX4_UNO['"]/.test(profile);
  const frameMapOficial = /TOLEDO_PRIX4_UNO:.*protocol\/ToledoFrameBuilder/.test(frameMap.replace(/\n/g, ' '))
    || (/TOLEDO_PRIX4_UNO/.test(frameMap) && /protocol\/ToledoFrameBuilder/.test(frameMap));
  const cadastroCanonicaliza = /DriverIdentityResolver|canonical|canonicalize/.test(service);

  const resolveToledo = identity.canonical('TOLEDO_PRIX4') === identity.CODIGO_OFICIAL
    && identity.canonical('toledo-prix4') === identity.CODIGO_OFICIAL
    && identity.canonical('TOLEDO_PRIX4_UNO') === identity.CODIGO_OFICIAL;

  const ok = resolverExiste
    && aliasesOk
    && loaderUnificado
    && adapterUsaResolver
    && protocoloCanonico
    && fingerprintCanonico
    && catalogoOficial
    && sdkPreservaId
    && resolveToledo
    && cadastroCanonicaliza;

  return {
    ok,
    codigoOficial: identity.CODIGO_OFICIAL,
    codigoSdk: identity.CODIGO_SDK,
    resolverExiste,
    aliasesOk,
    loaderUnificado,
    adapterUsaResolver,
    protocoloCanonico,
    fingerprintCanonico,
    catalogoOficial,
    sdkPreservaId,
    frameMapOficial,
    cadastroCanonicaliza,
    resolveToledo,
    criterios: {
      umDriverOficial: protocoloCanonico && catalogoOficial,
      umRegistryViaAliases: aliasesOk && loaderUnificado,
      umLoaderOficial: loaderUnificado,
      umCodigoOficial: resolveToledo,
      sdkCompat: sdkPreservaId,
      discoveryCadastro: catalogoOficial && cadastroCanonicaliza
    }
  };
}

module.exports = {
  auditar,
  DriverIdentityAudit: { auditar }
};
