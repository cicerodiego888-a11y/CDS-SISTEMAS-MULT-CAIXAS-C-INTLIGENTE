/**
 * RC14.15.21 — EAN-13 MGV6 no PDV (CCCC posições 2–5).
 * npm run test:pdv-mgv6-ean13-v1
 */

'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const parser = require('../../frontend/shared/js/parseMGV6ScaleEan13');
const { parseMGV6ScaleEan13, calcularDigitoVerificadorEan13 } = parser;

const EAN_REAL = '2001000004522';

function montarEanMgv6(plu, totalCentavos) {
  const cccc = String(Number(plu)).padStart(4, '0');
  const tttttt = String(Number(totalCentavos)).padStart(6, '0');
  const doze = `2${cccc}0${tttttt}`;
  const dv = calcularDigitoVerificadorEan13(doze);
  return `${doze}${dv}`;
}

const CATALOGO = [
  { id: 1, nome: 'Peito de Frango', plu: '10', codigo: 'PF10', codigo_barras: '' },
  { id: 2, nome: 'Milho Grão Kg', plu: '39', codigo: '012841', codigo_barras: '' },
  { id: 3, nome: 'EAN comercial', plu: '', codigo: 'X', codigo_barras: '7891000100103' }
];

let helpers;

before(() => {
  global.document = { getElementById() { return null; } };
  require('../../frontend/shared/js/buscaProdutoTexto.js');
  require('../../frontend/shared/js/pdvBuscaProduto.js');
  helpers = global.PdvBuscaProduto && global.PdvBuscaProduto._test;
});

describe('RC14.15.21 — parseMGV6ScaleEan13 caso real', () => {
  it('2001000004522 → itemCode 0010 → PLU 10', () => {
    const r = parseMGV6ScaleEan13(EAN_REAL);
    assert.ok(r && r.ok);
    assert.equal(r.itemCode, '0010');
    assert.equal(r.plu, 10);
    assert.equal(r.prefix, '2');
    assert.equal(r.total, 452);
    assert.equal(r.dv, '2');
    assert.equal(r.type, 'MGV6_SCALE_EAN13');
    assert.notEqual(r.plu, 100);
    assert.notEqual(r.plu, 1000);
    assert.notEqual(r.plu, 4522);
    assert.notEqual(String(r.plu), EAN_REAL);
  });

  it('slice(1,5) é CCCC, não o preço', () => {
    assert.equal(EAN_REAL.slice(1, 5), '0010');
    assert.equal(EAN_REAL.slice(6, 12), '000452');
    assert.equal(Number(EAN_REAL.slice(1, 5)), 10);
    assert.equal(Number(EAN_REAL.slice(6, 12)), 452);
  });
});

describe('RC14.15.21 — validações', () => {
  it('DV inválido → rejeita (sem outro PLU)', () => {
    const r = parseMGV6ScaleEan13('2001000004523');
    assert.ok(r);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'DV_INVALID');
  });

  it('EAN comercial válido não é MGV6', () => {
    assert.equal(parseMGV6ScaleEan13('7891000100103'), null);
  });

  it('PLU direto 10 não é interpretado como EAN-13 MGV6', () => {
    assert.equal(parseMGV6ScaleEan13('10'), null);
  });

  it('12 dígitos não é EAN-13 MGV6', () => {
    assert.equal(parseMGV6ScaleEan13('200100000452'), null);
  });

  it('14 dígitos não é EAN-13 MGV6', () => {
    assert.equal(parseMGV6ScaleEan13('20010000045221'), null);
  });

  it('Toledo 6+5 (posição 6 ≠ 0) não é MGV6 tradicional 4 dígitos', () => {
    assert.equal(parseMGV6ScaleEan13('2000067010019'), null);
  });
});

describe('RC14.15.21 — CCCC por PLU (mesma config)', () => {
  it('PLU 3/10/25/35/99', () => {
    const casos = [
      [3, '0003'],
      [10, '0010'],
      [25, '0025'],
      [35, '0035'],
      [99, '0099']
    ];
    for (const [plu, cccc] of casos) {
      const ean = montarEanMgv6(plu, 452);
      const r = parseMGV6ScaleEan13(ean);
      assert.equal(r && r.ok, true, String(ean));
      assert.equal(r.itemCode, cccc);
      assert.equal(r.plu, plu);
    }
  });
});

describe('RC14.15.21 — simulação leitor PDV → Peito de Frango', () => {
  it('entrada do scanner 2001000004522 localiza PLU 10', () => {
    const r = parseMGV6ScaleEan13(EAN_REAL);
    const produto = CATALOGO.find((p) => Number(p.plu) === r.plu);
    assert.ok(produto);
    assert.equal(produto.nome, 'Peito de Frango');
    assert.equal(produto.plu, '10');
    assert.equal(CATALOGO.find((p) => p.plu === '39').nome, 'Milho Grão Kg');
    assert.notEqual(produto.nome, 'Milho Grão Kg');
  });

  it('termoIdentificacaoPdv converte EAN → 10', () => {
    assert.ok(helpers);
    assert.equal(helpers.termoIdentificacaoPdv(EAN_REAL), '10');
    assert.equal(helpers.termoIdentificacaoPdv('10'), '10');
    assert.equal(helpers.termoIdentificacaoPdv('7891000100103'), '7891000100103');
  });

  it('produtoCorrespondeAoTermo: EAN MGV6 casa com PLU 10, não com 39', () => {
    assert.equal(helpers.produtoCorrespondeAoTermo(CATALOGO[0], EAN_REAL), true);
    assert.equal(helpers.produtoCorrespondeAoTermo(CATALOGO[1], EAN_REAL), false);
    assert.equal(helpers.produtoCorrespondeAoTermo(CATALOGO[0], '10'), true);
    assert.equal(helpers.produtoCorrespondeAoTermo(CATALOGO[2], '7891000100103'), true);
  });
});

describe('RC14.15.21 — barreiras', () => {
  it('TXITENS / FileBuilder / ItemCodeFormat não foram alterados neste RC', () => {
    const builder = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/MGV6FileBuilder.js'),
      'utf8'
    );
    assert.match(builder, /formatMGV6ItemCode/);
    const parserSrc = fs.readFileSync(
      path.join(ROOT, 'frontend/shared/js/parseMGV6ScaleEan13.js'),
      'utf8'
    );
    assert.doesNotMatch(parserSrc, /MGV6FileBuilder|TXITENS|ConnectionManager|ToledoPrixIVDriver/);
  });

  it('PDV carrega o parser antes da busca', () => {
    const html = fs.readFileSync(path.join(ROOT, 'frontend/pdv/index.html'), 'utf8');
    const iParser = html.indexOf('parseMGV6ScaleEan13.js');
    const iBusca = html.indexOf('pdvBuscaProduto.js');
    assert.ok(iParser >= 0 && iBusca > iParser);
    const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
    assert.match(pdv, /parseMGV6ScaleEan13Pdv/);
    assert.match(pdv, /montarParseMotorMGV6/);
  });
});
