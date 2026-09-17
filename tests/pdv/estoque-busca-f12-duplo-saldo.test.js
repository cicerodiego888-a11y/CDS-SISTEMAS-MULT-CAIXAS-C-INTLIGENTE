/**
 * PDV — F12 oculta rótulo NF; motores F+NF continuam incluindo produto NF.
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

let ok = 0;
let fail = 0;

if (test('Catálogo PDV carrega com modo_fiscal=0 (motor F+NF)', () => {
  assert.match(pdv, /function urlProdutosPdv\(\)[\s\S]*?modo_fiscal=0/);
})) ok++; else fail++;

if (test('Consulta F1 busca com modo_fiscal=0', () => {
  assert.match(pdv, /consulta-pdv\/buscar\?q=.*modo_fiscal=0/);
})) ok++; else fail++;

if (test('pdvEstoqueDisponivel operacional usa F+NF', () => {
  assert.match(pdv, /function pdvEstoqueDisponivel\([\s\S]*?pdvResolverSaldosProduto[\s\S]*?estoque_atual/);
  assert.match(
    pdv,
    /function pdvEstoqueDisponivel\(produto\) \{\s*const saldos = pdvResolverSaldosProduto\(produto\);\s*return Number\(saldos\.estoque_atual \|\| 0\);/
  );
})) ok++; else fail++;

if (test('validarEstoqueVenda não bloqueia só NF no F12', () => {
  assert.match(pdv, /F12 não bloqueia produto só com saldo NF/);
  assert.doesNotMatch(
    pdv,
    /function validarEstoqueVenda\([\s\S]*?modoFiscal && quantidade > saldoFiscal/
  );
})) ok++; else fail++;

if (test('pdvRotuloEstoque no F12 não imprime NF', () => {
  assert.match(pdv, /function pdvRotuloEstoque\([\s\S]*?pdvModoFiscalAtivo\(\)[\s\S]*?return String\(fiscal\)/);
})) ok++; else fail++;

if (test('Autocomplete PDV busca com modo_fiscal=0', () => {
  assert.match(busca, /function obterModoFiscal\(\)[\s\S]*?return '0'/);
})) ok++; else fail++;

if (test('PDV não filtra item_fiscal do catálogo no F12', () => {
  assert.doesNotMatch(pdv, /function pdvProdutoPermitidoNoModoAtual/);
})) ok++; else fail++;

console.log(`Resultado: ${ok} OK, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
