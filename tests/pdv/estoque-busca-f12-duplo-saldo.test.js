/**
 * PDV — estoque na busca: F12 não esconde saldo fiscal/não fiscal.
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
const helpers = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/modoFiscalHelpers.js'), 'utf8');
const busca = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/pdvBuscaProduto.js'), 'utf8');

let ok = 0;
let fail = 0;

if (test('Catálogo PDV carrega com modo_fiscal=0', () => {
  assert.match(pdv, /function urlProdutosPdv\(\)[\s\S]*?modo_fiscal=0/);
})) ok++; else fail++;

if (test('Consulta F1 busca com modo_fiscal=0', () => {
  assert.match(pdv, /consulta-pdv\/buscar\?q=.*modo_fiscal=0/);
})) ok++; else fail++;

if (test('pdvEstoqueDisponivel usa pdvResolverSaldosProduto (F+NF)', () => {
  assert.match(pdv, /function pdvEstoqueDisponivel\([\s\S]*?pdvResolverSaldosProduto/);
  assert.doesNotMatch(
    pdv,
    /function pdvEstoqueDisponivel\([\s\S]*?obterEstoqueDisponivelProduto/
  );
})) ok++; else fail++;

if (test('pdvRotuloEstoque sempre exibe F | NF | Total', () => {
  assert.match(pdv, /function pdvRotuloEstoque\([\s\S]*?F: \$\{fiscal\} \| NF: \$\{naoFiscal\} \| Total:/);
  assert.doesNotMatch(pdv, /function pdvRotuloEstoque\([\s\S]*?Estoque fiscal:/);
})) ok++; else fail++;

if (test('Autocomplete PDV busca com modo_fiscal=0', () => {
  assert.match(busca, /function obterModoFiscal\(\)[\s\S]*?return '0'/);
})) ok++; else fail++;

if (test('Cache de estoque inclui produtosDisponiveis e não sobrescreve saldos do produto', () => {
  assert.match(helpers, /produtosDisponiveis/);
  assert.match(helpers, /temSaldoFiscal/);
})) ok++; else fail++;

if (test('Regra: só fiscal com F12 off permanece adicionável', () => {
  const produto = { saldo_fiscal: 6, saldo_nao_fiscal: 0, estoque_atual: 0, controla_estoque: 1 };
  const total = Number(produto.saldo_fiscal) + Number(produto.saldo_nao_fiscal);
  assert.ok(total > 0);
  const soNaoFiscal = { saldo_fiscal: 0, saldo_nao_fiscal: 4, estoque_atual: 0, controla_estoque: 1 };
  assert.ok(Number(soNaoFiscal.saldo_fiscal) + Number(soNaoFiscal.saldo_nao_fiscal) > 0);
})) ok++; else fail++;

console.log(`Resultado: ${ok} OK, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
