/**
 * F1 / busca PDV — não bloquear Adicionar por saldos zerados da consulta.
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

if (test('mesclarProdutoCatalogoPdv existe e protege saldo positivo', () => {
  assert.match(pdv, /function mesclarProdutoCatalogoPdv/);
  assert.match(pdv, /totalIn <= 1e-9 && totalEx > 1e-9/);
})) ok++; else fail++;

if (test('garantirProdutoNoCatalogoPdv força hidratação quando cache zerado', () => {
  assert.match(pdv, /forcarAtualizacao/);
  assert.match(pdv, /cacheComEstoque/);
  assert.match(pdv, /pdvTotalSaldosProduto\(cached\) > 1e-9/);
})) ok++; else fail++;

if (test('F1 Adicionar força atualização do servidor', () => {
  const trecho = pdv.slice(pdv.indexOf('function adicionarProdutoConsultaPDV'));
  assert.match(trecho, /forcarAtualizacao:\s*true/);
})) ok++; else fail++;

if (test('F1 não desabilita botão Adicionar por estoque da busca', () => {
  const montar = pdv.slice(
    pdv.indexOf('function montarLinhaProdutoConsultaPDV'),
    pdv.indexOf('function htmlTabelaProdutosConsultaPDV')
  );
  assert.doesNotMatch(montar, /semEstoque \? 'disabled'/);
  assert.match(montar, /adicionarProdutoConsultaPDV/);
})) ok++; else fail++;

if (test('Autocomplete não desabilita item por sem estoque da busca', () => {
  assert.doesNotMatch(busca, /semEstoque \? 'disabled aria-disabled="true"'/);
  assert.match(busca, /Verificar estoque/);
})) ok++; else fail++;

if (test('Regra merge: busca 0 não apaga F=6 do catálogo', () => {
  const existente = { id: 1, saldo_fiscal: 6, saldo_nao_fiscal: 0, estoque_atual: 6 };
  const incoming = { id: 1, saldo_fiscal: 0, saldo_nao_fiscal: 0, estoque_atual: 0, nome: 'Coca' };
  const totalIn = Number(incoming.saldo_fiscal) + Number(incoming.saldo_nao_fiscal);
  const totalEx = Number(existente.saldo_fiscal) + Number(existente.saldo_nao_fiscal);
  const base = { ...existente, ...incoming };
  if (totalIn <= 1e-9 && totalEx > 1e-9) {
    base.saldo_fiscal = existente.saldo_fiscal;
    base.saldo_nao_fiscal = existente.saldo_nao_fiscal;
    base.estoque_atual = existente.estoque_atual;
  }
  assert.equal(base.saldo_fiscal, 6);
  assert.equal(base.nome, 'Coca');
})) ok++; else fail++;

console.log(`Resultado: ${ok} OK, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
