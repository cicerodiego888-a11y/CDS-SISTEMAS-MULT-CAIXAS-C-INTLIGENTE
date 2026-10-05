/**
 * PDV — F12 controls priority/display, not sale-product eligibility.
 * Fiscal and nonfiscal products remain searchable in either mode.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function test(nome, fn) {
  try {
    fn();
    console.log(`  OK  ${nome}`);
    return true;
  } catch (err) {
    console.error(`  FALHOU  ${nome}`);
    console.error(`    ${err.message}`);
    return false;
  }
}

const pdv = fs.readFileSync(path.join(__dirname, '../../frontend/pdv/js/pdv.js'), 'utf8');
const busca = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/pdvBuscaProduto.js'), 'utf8');
const mip = fs.readFileSync(
  path.join(__dirname, '../../backend/motores/produto-identidade/services/PdvProdutoIdentificacaoService.js'),
  'utf8'
);

let ok = 0;
let fail = 0;

if (test('Catálogo PDV pede ambos os tipos para venda em qualquer modo F12', () => {
  assert.match(pdv, /function urlProdutosPdv\(\)[\s\S]*?modo_fiscal=0/);
})) ok++; else fail++;

if (test('Consulta F1 busca ambos os tipos em qualquer modo F12', () => {
  assert.match(pdv, /consulta-pdv\/buscar\?q=.*modo_fiscal=0/);
})) ok++; else fail++;

if (test('pdvEstoqueDisponivel no F12 usa só saldo_fiscal (A)', () => {
  assert.match(pdv, /function pdvEstoqueDisponivel\([\s\S]*?pdvModoFiscalAtivo\(\)[\s\S]*?saldo_fiscal/);
})) ok++; else fail++;

if (test('validarEstoqueVenda não bloqueia só NF no F12 (motor F+NF)', () => {
  assert.match(pdv, /F12 não bloqueia produto só com saldo NF/);
  assert.doesNotMatch(
    pdv,
    /function validarEstoqueVenda\([\s\S]*?modoFiscal && quantidade > saldoFiscal/
  );
})) ok++; else fail++;

if (test('pdvRotuloEstoque no F12 não imprime NF', () => {
  assert.match(pdv, /function pdvRotuloEstoque\([\s\S]*?pdvModoFiscalAtivo\(\)[\s\S]*?return String\(fiscal\)/);
})) ok++; else fail++;

if (test('Autocomplete consulta ambos os tipos; MIP B não é descartado pelo modo', () => {
  assert.match(busca, /busca-operacional\?q=.*modo_fiscal=0/);
  assert.doesNotMatch(busca, /produtoEhNaoFiscal|filtrarResultadosModoFiscal/);
})) ok++; else fail++;

if (test('Catálogo e inclusão não filtram por item_fiscal no F12', () => {
  assert.match(pdv, /function pdvProdutoPermitidoNoModoAtual\(produto\)[\s\S]*?return !!produto/);
  assert.match(pdv, /function filtrarCatalogoPdvModoAtual/);
  assert.match(pdv, /produto\.item_fiscal \|\| 0/);
})) ok++; else fail++;

if (test('MIP devolve produto B sob F12 sem converter sua natureza', () => {
  assert.doesNotMatch(mip, /_contextoModoFiscal|_produtoEhNaoFiscal|f12_somente_item_fiscal/);
  assert.match(pdv, /item_fiscal: Number\(produto\.item_fiscal \|\| 0\)/);
})) ok++; else fail++;

console.log(`Resultado: ${ok} OK, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
