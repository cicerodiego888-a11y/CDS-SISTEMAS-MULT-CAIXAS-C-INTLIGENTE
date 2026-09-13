/**
 * RC14.15.15 — Busca PLU exata no PDV (termo atual = autoridade)
 * npm run test:pdv-busca-plu-exata-v1
 */

'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const CatalogSnapshot = require('../../backend/motores/mib/catalog/CatalogSnapshot');

const FIXTURES = [
  { id: 1, codigo: '012841', nome: 'Milho Grão Kg', plu: '39', codigo_barras: '', nome_busca: 'milho grao kg' },
  { id: 2, codigo: '3', nome: 'Costela Bovina Kg', plu: '3', codigo_barras: '', nome_busca: 'costela bovina kg' },
  { id: 3, codigo: '12746', nome: 'Milho Grao', plu: '12746', codigo_barras: '', nome_busca: 'milho grao' },
  { id: 4, codigo: '99', nome: 'TESTE CDS SISTEMAS', plu: '99', codigo_barras: '', nome_busca: 'teste cds sistemas' },
  { id: 5, codigo: '103', nome: 'Produto PLU 103', plu: '103', codigo_barras: '', nome_busca: 'produto plu 103' },
  { id: 6, codigo: '7891000100103', nome: 'EAN Exemplo', plu: '', codigo_barras: '7891000100103', nome_busca: 'ean exemplo' }
];

let helpers;

before(() => {
  global.document = {
    getElementById() { return null; }
  };
  // eslint-disable-next-line global-require
  require('../../frontend/shared/js/buscaProdutoTexto.js');
  require('../../frontend/shared/js/pdvBuscaProduto.js');
  helpers = global.PdvBuscaProduto && global.PdvBuscaProduto._test;
  assert.ok(helpers, 'PdvBuscaProduto._test deve estar exportado');
});

describe('RC14.15.15 — match numérico exato (helpers PDV)', () => {
  it('TESTE 01 — PLU 39 corresponde só a Milho Grão Kg', () => {
    const hits = FIXTURES.filter((p) => helpers.produtoCorrespondeAoTermo(p, '39'));
    assert.equal(hits.length, 1);
    assert.equal(hits[0].nome, 'Milho Grão Kg');
    assert.equal(hits.some((p) => /Costela/i.test(p.nome)), false);
  });

  it('TESTE 02 — PLU 3 corresponde só a Costela Bovina', () => {
    const hits = FIXTURES.filter((p) => helpers.produtoCorrespondeAoTermo(p, '3'));
    assert.equal(hits.length, 1);
    assert.equal(hits[0].nome, 'Costela Bovina Kg');
  });

  it('TESTE 03 — PLU 12746 independente do 39', () => {
    const hits = FIXTURES.filter((p) => helpers.produtoCorrespondeAoTermo(p, '12746'));
    assert.equal(hits.length, 1);
    assert.equal(hits[0].plu, '12746');
    assert.equal(helpers.produtoCorrespondeAoTermo(FIXTURES[0], '12746'), false);
  });

  it('TESTE 04 — PLU 99 → TESTE CDS SISTEMAS', () => {
    const hits = FIXTURES.filter((p) => helpers.produtoCorrespondeAoTermo(p, '99'));
    assert.equal(hits.length, 1);
    assert.match(hits[0].nome, /TESTE CDS SISTEMAS/i);
  });

  it('TESTE 09 — termo 3 não confirma 39/103/12746', () => {
    assert.equal(helpers.identificadoresNumericosIguais('3', '39'), false);
    assert.equal(helpers.identificadoresNumericosIguais('3', '103'), false);
    assert.equal(helpers.identificadoresNumericosIguais('3', '12746'), false);
    const filtrados = helpers.filtrarResultadosParaTermo(FIXTURES, '3');
    assert.equal(filtrados.length, 1);
    assert.equal(filtrados[0].plu, '3');
  });

  it('039 ≡ 39 (zero-pad) sem substring', () => {
    assert.equal(helpers.identificadoresNumericosIguais('039', '39'), true);
    assert.equal(helpers.identificadoresNumericosIguais('000003', '3'), true);
  });
});

describe('RC14.15.15 — CatalogSnapshot sem includes em PLU numérico', () => {
  it('termo 3 não retorna 39/103/12746', () => {
    const snap = new CatalogSnapshot(FIXTURES);
    const r = snap.filtrar('3', { limite: 20 });
    assert.equal(r.length, 1);
    assert.equal(String(r[0].plu), '3');
  });

  it('termo 39 retorna só Milho Grão Kg', () => {
    const snap = new CatalogSnapshot(FIXTURES);
    const r = snap.filtrar('39', { limite: 20 });
    assert.equal(r.length, 1);
    assert.match(r[0].nome, /Milho Grão Kg/i);
  });

  it('TESTE 10 — busca por nome preservada', () => {
    const snap = new CatalogSnapshot(FIXTURES);
    const r = snap.filtrar('milho', { limite: 20 });
    assert.ok(r.length >= 2);
    assert.ok(r.some((p) => p.plu === '39'));
    assert.ok(r.some((p) => p.plu === '12746'));
  });

  it('TESTE 11 — EAN exato preservado', () => {
    const snap = new CatalogSnapshot(FIXTURES);
    const r = snap.filtrar('7891000100103', { limite: 20 });
    assert.equal(r.length, 1);
    assert.equal(r[0].codigo_barras, '7891000100103');
  });

  it('TESTE 12 — código interno exato preservado', () => {
    const snap = new CatalogSnapshot(FIXTURES);
    const r = snap.filtrar('012841', { limite: 20 });
    assert.equal(r.length, 1);
    assert.equal(r[0].codigo, '012841');
  });
});

describe('RC14.15.15 — proteções de fonte (stale / Enter / MIP)', () => {
  it('pdvBuscaProduto invalida termo antigo e bloqueia match_exato stale', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'frontend/shared/js/pdvBuscaProduto.js'),
      'utf8'
    );
    assert.match(src, /termoDosResultados/);
    assert.match(src, /_termoOrigem/);
    assert.match(src, /obterTermoAtualDoInput/);
    assert.match(src, /respostaAindaValida/);
    assert.match(src, /ultimoMipBusca\.termo !== termo/);
    assert.match(src, /Resultado desatualizado/);
    assert.match(src, /identificadoresNumericosIguais/);
    assert.match(src, /filtrarResultadosParaTermo/);
    assert.match(src, /origem === termo && \(!ehTermoSomenteDigitos\(termo\) \|\| produtoCorrespondeAoTermo/);
    assert.match(src, /ehTermoSomenteDigitos\(termoAtual\)/);
    assert.doesNotMatch(src, /plu\.includes\(termo\)/);
  });

  it('label PDV menciona PLU', () => {
    const html = fs.readFileSync(
      path.join(ROOT, 'frontend/pdv/pages/pdv.html'),
      'utf8'
    );
    assert.match(html, /Código de barras \/ Código interno \/ PLU \/ Nome/);
    assert.match(html, /PLU ou nome do produto/);
  });

  it('debounce permanece 220 ms', () => {
    assert.equal(helpers.DEBOUNCE_MS, 220);
  });

  it('simula Enter stale: resultado de "3" não corresponde a termo "39"', () => {
    const costela = FIXTURES[1];
    assert.equal(helpers.produtoCorrespondeAoTermo(costela, '39'), false);
    const filtrados = helpers.filtrarResultadosParaTermo(
      [{ ...costela, match_exato: 1, _termoOrigem: '3' }],
      '39'
    );
    assert.equal(filtrados.length, 0);
  });

  it('simula resposta MIP antiga descartável por termo', () => {
    const milho = FIXTURES[0];
    assert.equal(helpers.produtoCorrespondeAoTermo(milho, '39'), true);
    assert.equal(helpers.produtoCorrespondeAoTermo(milho, '3'), false);
  });
});

describe('busca PDV por nome completo (02M / FUSÃO)', () => {
  it('FITA 02M encontra cadastro 2M com acento', () => {
    const produto = {
      id: 80,
      codigo: '80',
      nome: 'FITA ISOLANTE 19MM X 2M PT AUTO FUSAO SCOTCH',
      plu: '',
      codigo_barras: ''
    };
    assert.equal(
      helpers.produtoCorrespondeAoTermo(produto, 'FITA ISOLANTE 19MM X 02M PT AUTO FUSÃO SCOTCH'),
      true
    );
    assert.equal(helpers.produtoCorrespondeAoTermo(produto, 'ANTIRRESPINGO DE SOLDA'), false);
  });

  it('confirmação por nome não exige includes literal do termo', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/pdvBuscaProduto.js'), 'utf8');
    assert.match(src, /if \(ehTermoSomenteDigitos\(termoAtual\)\)/);
    assert.match(src, /produtosDisponiveis/);
  });
});

describe('RC14.15.15 — barreiras (sem alterar bancos/motores proibidos)', () => {
  it('não toca MGV6 / TCP / produto_identificadores schema', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'frontend/shared/js/pdvBuscaProduto.js'),
      'utf8'
    );
    assert.doesNotMatch(src, /MGV6|ConnectionManager|ToledoPrixIVDriver/);
    const catalog = fs.readFileSync(
      path.join(ROOT, 'backend/motores/mib/catalog/CatalogSnapshot.js'),
      'utf8'
    );
    assert.match(catalog, /RC14\.15\.15/);
    assert.match(catalog, /soDigitos/);
  });
});
