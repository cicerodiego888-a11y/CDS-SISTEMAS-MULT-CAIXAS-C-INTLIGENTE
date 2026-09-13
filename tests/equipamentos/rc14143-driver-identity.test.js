/**
 * RC14.14.3 — Consolidação da identidade oficial do Driver Toledo
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const identity = require('../../backend/motores/equipamentos/sdk/DriverIdentityResolver');
const { auditar } = require('../../backend/motores/equipamentos/sdk/DriverIdentityAudit');
const { paraContratoErp } = require('../../backend/motores/equipamentos/sdk/DriverAdapter');
const officialLoader = require('../../backend/motores/equipamentos/sdk/OfficialDriverLoader');
const sdkRegistry = require('../../backend/motores/equipamentos/sdk/DriverRegistry');
const pluginRegistry = require('../../backend/motores/equipamentos/drivers/DriverRegistry');
const { DRIVER } = require('../../backend/motores/equipamentos/drivers/toledo/ToledoProtocol');
const DriverResolver = require('../../backend/motores/equipamentos/fingerprint/DriverResolver');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC14.14.3 — DriverIdentityResolver', () => {
  it('aliases resolvem para TOLEDO_PRIX4_UNO', () => {
    assert.equal(identity.CODIGO_OFICIAL, 'TOLEDO_PRIX4_UNO');
    assert.equal(identity.canonical('TOLEDO_PRIX4'), 'TOLEDO_PRIX4_UNO');
    assert.equal(identity.canonical('toledo-prix4'), 'TOLEDO_PRIX4_UNO');
    assert.equal(identity.canonical('TOLEDO_PRIX4_UNO'), 'TOLEDO_PRIX4_UNO');
    assert.equal(identity.nomeExibicao('TOLEDO_PRIX4'), 'Toledo Prix IV Uno');
    assert.equal(identity.codigoSdk('TOLEDO_PRIX4_UNO'), 'toledo-prix4');
  });

  it('resolve retorna runtime + plugin modules', () => {
    const r = identity.resolve('toledo-prix4');
    assert.equal(r.codigo, 'TOLEDO_PRIX4_UNO');
    assert.equal(r.codigo_sdk, 'toledo-prix4');
    assert.match(r.runtimeModule, /ToledoPrixIVDriver/);
    assert.match(r.pluginModule, /ToledoPrix4UnoDriver/);
  });
});

describe('RC14.14.3 — Adapter / Protocol / Fingerprint', () => {
  it('Adapter sem meta.catalogoLegado ainda gera UNO', () => {
    const out = paraContratoErp({
      id: 'toledo-prix4',
      codigo: 'toledo-prix4',
      nomeExibicao: 'Toledo Prix IV Uno',
      fabricante: 'Toledo',
      modelo: 'Prix IV Uno',
      transportes: ['ethernet'],
      status: 'homologacao'
    });
    assert.equal(out.codigo, 'TOLEDO_PRIX4_UNO');
    assert.equal(out.codigo_sdk, 'toledo-prix4');
    assert.equal(out.nome_exibicao, 'Toledo Prix IV Uno');
  });

  it('PROTOCOL.DRIVER canônico', () => {
    assert.equal(DRIVER, 'TOLEDO_PRIX4_UNO');
  });

  it('Fingerprint → TOLEDO_PRIX4_UNO', () => {
    const r = new DriverResolver().resolve('TOLEDO_90AX');
    assert.equal(r.driver, 'TOLEDO_PRIX4_UNO');
  });
});

describe('RC14.14.3 — OfficialDriverLoader + aliases nos registries', () => {
  it('carrega e resolve aliases no SDK e plugin registry', () => {
    officialLoader.reload();
    assert.ok(sdkRegistry.buscar('toledo-prix4'));
    assert.ok(sdkRegistry.buscar('TOLEDO_PRIX4_UNO'));
    assert.ok(sdkRegistry.buscar('TOLEDO_PRIX4'));
    assert.ok(pluginRegistry.buscar('TOLEDO_PRIX4_UNO'));
    assert.ok(pluginRegistry.buscar('TOLEDO_PRIX4'));
    assert.ok(pluginRegistry.buscar('toledo-prix4'));
  });

  it('OfficialDriverLoader.resolver', () => {
    const r = officialLoader.resolver('TOLEDO_PRIX4');
    assert.equal(r.codigo, 'TOLEDO_PRIX4_UNO');
    assert.ok(r.profile || r.plugin);
  });
});

describe('RC14.14.3 — Cadastro / Discovery / FrameMap', () => {
  it('EquipamentosService canonicaliza driver_codigo', () => {
    const src = read('backend/motores/equipamentos/services/EquipamentosService.js');
    assert.match(src, /DriverIdentityResolver/);
    assert.match(src, /canonical/);
  });

  it('frameBuilderMap UNO → protocol oficial', () => {
    const src = read('backend/motores/equipamentos/laboratorio/frameBuilderMap.js');
    assert.match(src, /TOLEDO_PRIX4_UNO:\s*'[^']*protocol\/ToledoFrameBuilder/);
  });

  it('catalogo oficial TOLEDO_PRIX4_UNO', () => {
    const src = read('backend/motores/equipamentos/drivers/driverCatalog.js');
    assert.match(src, /codigo:\s*'TOLEDO_PRIX4_UNO'/);
    assert.match(src, /Toledo Prix IV Uno/);
  });
});

describe('RC14.14.3 — DriverIdentityAudit', () => {
  it('auditoria estrutural passa', () => {
    const r = auditar();
    assert.equal(r.ok, true, JSON.stringify(r, null, 2));
  });
});
