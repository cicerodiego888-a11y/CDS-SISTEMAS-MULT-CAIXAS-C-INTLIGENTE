/**
 * RC14.13.2 — DriverAdapter: contrato oficial ERP
 */
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  paraContratoErp,
  paraContratoErpLista,
  sdkIdParaCodigoLegado
} = require('../../backend/motores/equipamentos/sdk/DriverAdapter');

const sdk = require('../../backend/motores/equipamentos/sdk');
const DriverSdkController = require('../../backend/motores/equipamentos/sdk/DriverSdkController');

describe('RC14.13.2 — DriverAdapter unitário', () => {
  it('Toledo: codigo legado + codigo_sdk + nome_exibicao', () => {
    const out = paraContratoErp({
      id: 'toledo-prix4',
      codigo: 'toledo-prix4',
      nomeExibicao: 'Toledo Prix IV Uno',
      fabricante: 'Toledo',
      modelo: 'Prix IV Uno',
      transportes: ['ethernet', 'serial'],
      status: 'homologacao',
      meta: { catalogoLegado: 'TOLEDO_PRIX4_UNO' }
    });

    assert.equal(out.codigo, 'TOLEDO_PRIX4_UNO');
    assert.equal(out.codigo_sdk, 'toledo-prix4');
    assert.equal(out.nome_exibicao, 'Toledo Prix IV Uno');
    assert.equal(out.transporte, 'ethernet');
    assert.deepEqual(out.transportes, ['ethernet', 'serial']);
    assert.equal(out.ativo, true);
    assert.equal(out.status, 'homologado');
    assert.equal(out.fabricante, 'Toledo');
    assert.equal(out.modelo, 'Prix IV Uno');
  });

  it('Filizola: gera codigo legado a partir do id SDK', () => {
    const out = paraContratoErp({
      id: 'filizola-platina',
      codigo: 'filizola-platina',
      nomeExibicao: 'Filizola Platina',
      fabricante: 'Filizola',
      modelo: 'Platina',
      transportes: ['serial', 'ethernet'],
      status: 'estrutura'
    });
    assert.equal(out.codigo, 'FILIZOLA_PLATINA');
    assert.equal(out.codigo_sdk, 'filizola-platina');
    assert.equal(out.nome_exibicao, 'Filizola Platina');
    assert.equal(out.transporte, 'serial');
    assert.ok(out.transportes.includes('ethernet'));
  });

  it('Genérico: transporte serial', () => {
    const out = paraContratoErp({
      id: 'generico-serial',
      codigo: 'generico-serial',
      nomeExibicao: 'Genérico Serial',
      transportes: ['serial'],
      status: 'estrutura'
    });
    assert.equal(out.codigo, 'GENERICO_SERIAL');
    assert.equal(out.codigo_sdk, 'generico-serial');
    assert.equal(out.transporte, 'serial');
    assert.deepEqual(out.transportes, ['serial']);
    assert.equal(out.nome_exibicao, 'Genérico Serial');
  });

  it('sdkIdParaCodigoLegado', () => {
    assert.equal(sdkIdParaCodigoLegado('toledo-prix4'), 'TOLEDO_PRIX4');
    assert.equal(sdkIdParaCodigoLegado('TOLEDO_PRIX4_UNO'), 'TOLEDO_PRIX4_UNO');
  });

  it('lista e nulos', () => {
    assert.deepEqual(paraContratoErpLista(null), []);
    assert.equal(paraContratoErp(null), null);
    const lista = paraContratoErpLista([
      { id: 'a-b', nomeExibicao: 'A', transportes: ['usb'] }
    ]);
    assert.equal(lista.length, 1);
    assert.equal(lista[0].codigo, 'A_B');
  });
});

describe('RC14.13.2 — SDK listarDrivers já adaptado', () => {
  before(() => {
    sdk.ensureLoaded({ forcar: true });
  });

  it('listarDrivers devolve contrato ERP', () => {
    const drivers = sdk.listarDrivers();
    assert.ok(Array.isArray(drivers));
    assert.ok(drivers.length >= 3);

    const toledo = drivers.find((d) => d.codigo_sdk === 'toledo-prix4' || d.codigo === 'TOLEDO_PRIX4_UNO');
    assert.ok(toledo, 'Toledo deve estar na lista');
    assert.equal(toledo.codigo, 'TOLEDO_PRIX4_UNO');
    assert.equal(toledo.codigo_sdk, 'toledo-prix4');
    assert.ok(toledo.nome_exibicao);
    assert.ok(!Object.prototype.hasOwnProperty.call(toledo, 'nomeExibicao')
      || toledo.nome_exibicao === toledo.nomeExibicao
      || toledo.nome_exibicao);

    const filizola = drivers.find((d) => d.codigo_sdk === 'filizola-platina');
    assert.ok(filizola);
    assert.equal(filizola.codigo, 'FILIZOLA_PLATINA');

    const generico = drivers.find((d) => d.codigo_sdk === 'generico-serial');
    assert.ok(generico);
    assert.equal(generico.transporte, 'serial');
  });
});

describe('RC14.13.2 — API /drivers (controller)', () => {
  it('listar responde contrato erp-oficial-v1', async () => {
    const captured = { status: 200, body: null };
    const res = {
      json(data) {
        captured.body = data;
        return res;
      },
      status(code) {
        captured.status = code;
        return res;
      }
    };
    await DriverSdkController.listar({ query: {} }, res);
    assert.equal(captured.body.success, true);
    assert.equal(captured.body.contrato, 'erp-oficial-v1');
    assert.ok(Array.isArray(captured.body.drivers));
    assert.ok(captured.body.drivers.length >= 1);

    const t = captured.body.drivers.find((d) => d.codigo === 'TOLEDO_PRIX4_UNO');
    assert.ok(t);
    assert.equal(t.nome_exibicao, 'Toledo Prix IV Uno');
    assert.equal(t.codigo_sdk, 'toledo-prix4');
    assert.equal(t.transporte, 'ethernet');
    assert.ok(Array.isArray(t.transportes));
    assert.equal(t.ativo, true);
  });
});

describe('RC14.13.2 — Front continua em snake_case', () => {
  it('equipamentos.js ainda usa nome_exibicao / codigo (sem mudança de tela)', () => {
    const front = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/equipamentos.js'),
      'utf8'
    );
    assert.match(front, /d\.nome_exibicao/);
    assert.match(front, /d\.codigo/);
    assert.doesNotMatch(front, /d\.nomeExibicao/);
  });
});
