/**
 * RC14.15.8 / RC14.15.9 — Identidade PLU = código do item (sem Código MGV6)
 * npm run test:mgv6-identidade-plu-v1
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const identity = require('../../backend/motores/equipamentos/mgv6/MGV6IdentityResolver');
const builder = require('../../backend/motores/equipamentos/mgv6/MGV6FileBuilder');
const exporter = require('../../backend/motores/equipamentos/mgv6/MGV6Exporter');
const { CODES } = require('../../backend/motores/equipamentos/mgv6/MGV6Errors');
const { REGISTRO_LENGTH } = require('../../backend/motores/equipamentos/mgv6/MGV6Configuration');

const MILHO_39 = {
  codigo: '012841',
  nome: 'Milho Grão Kg',
  descricao: 'Milho Grão Kg',
  plu: '39',
  integrar_balanca: 1,
  preco: 2.79,
  preco_venda: 2.79
};

const MILHO_12746 = {
  codigo: '099999',
  nome: 'Milho Grao',
  descricao: 'Milho Grao',
  plu: '12746',
  integrar_balanca: 1,
  preco: 2.5,
  preco_venda: 2.5
};

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mgv6-14158-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
});

describe('RC14.15.9 — testes obrigatórios', () => {
  it('1. PLU 39 sem codigo_mgv6 → PASS', () => {
    const id = identity.resolverIdentidade({ ...MILHO_39 });
    assert.equal(id.codigoItem, '39');
    assert.equal(id.origem, 'PLU');
    assert.equal(id.codigoItem9, '000000039');
    assert.equal(id.cccccc, '000039');
  });

  it('2. PLU 12746 sem codigo_mgv6 → PASS', () => {
    const id = identity.resolverIdentidade({ ...MILHO_12746 });
    assert.equal(id.codigoItem, '12746');
    assert.equal(id.codigoItem9, '000012746');
    assert.equal(id.cccccc, '012746');
  });

  it('3. PLU 39 + codigo_mgv6 12746 (legado DB) → PLU vence', () => {
    const reg = builder.buildRecord({
      ...MILHO_39,
      codigo_mgv6: '12746',
      codigoMgv6: '12746'
    }, {});
    assert.equal(reg.substring(2, 11), '000000039');
  });

  it('4. Sem PLU + so codigo_mgv6 → PLU_REQUIRED (não usa legado)', () => {
    assert.throws(
      () => identity.resolverIdentidade({
        nome: 'Só legado MGV6',
        integrar_balanca: 1,
        codigo_mgv6: '12746'
      }),
      (e) => e.code === CODES.PRODUCT_PLU_REQUIRED
    );
  });

  it('5. Sem PLU + integrar=1 → PLU_REQUIRED', () => {
    assert.throws(
      () => identity.resolverIdentidade({
        nome: 'Sem identidade',
        integrar_balanca: 1,
        codigo: '012841',
        codigo_barras: '7891234567890'
      }),
      (e) => e.code === CODES.PRODUCT_PLU_REQUIRED
    );
  });

  it('6. integrar_balanca=0 → não exportado', () => {
    const { resolvidos, excluidos } = identity.resolverLista([
      { ...MILHO_39, integrar_balanca: 0 }
    ]);
    assert.equal(resolvidos.length, 0);
    assert.equal(excluidos.length, 1);
  });

  it('7. EAN + sem PLU → não usa EAN', () => {
    assert.throws(
      () => identity.resolverIdentidade({
        nome: 'Só EAN',
        integrar_balanca: 1,
        codigo_barras: '7891234567890'
      }),
      (e) => e.code === CODES.PRODUCT_PLU_REQUIRED
    );
  });

  it('8. Código interno + sem PLU → não usa interno', () => {
    assert.throws(
      () => identity.resolverIdentidade({
        nome: 'Só interno',
        integrar_balanca: 1,
        codigo: '012841'
      }),
      (e) => e.code === CODES.PRODUCT_PLU_REQUIRED
    );
  });
});

describe('RC14.15.9 — caso oficial Milho 012841 / PLU 39', () => {
  it('resolver → 39; builder → 000000039; export TXITENS 320', async () => {
    const p = { ...MILHO_39 };
    const id = identity.resolverIdentidade(p);
    assert.equal(id.codigoItem, '39');
    assert.equal(id.cccccc, '000039');
    assert.equal(id.codigoItem9, '000000039');

    const reg = builder.buildRecord(p, {});
    assert.equal(reg.length, REGISTRO_LENGTH);
    assert.equal(reg.substring(2, 11), '000000039');

    const folder = path.join(tmpRoot, 'milho39');
    fs.mkdirSync(folder, { recursive: true });
    const result = await exporter.exportarProdutos([p], {
      exportFolder: folder,
      fileName: 'TXITENS.TXT',
      encoding: 'WINDOWS-1252',
      lineEnding: 'CRLF',
      autoLaunch: false
    });
    assert.equal(result.arquivo, 'TXITENS.TXT');
    assert.equal(result.registroLength, 320);
    const bytes = fs.readFileSync(result.caminho);
    assert.equal(bytes.length, 322);
    assert.equal(bytes.subarray(0, 11).toString('latin1'), '01000000039');
  });

  it('UI cadastro não expõe Código MGV6', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/produtos.js'),
      'utf8'
    );
    assert.doesNotMatch(src, /id=["']codigo_mgv6["']/);
    assert.doesNotMatch(src, /Código MGV6/);
    assert.match(src, /PLU \/ Código do item da balança/);
  });
});
