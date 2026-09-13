/**
 * RC4.31.12.10 — Painel MUC simplificado (preço único no formulário)
 * Executar: node tests/compras/rc43112.10-painel-muc-simplificado.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const compras = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');

let ok = 0;
let falhas = 0;

function test(nome, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FAIL  ${nome}`);
    console.error(`       ${err.message}`);
  }
}

console.log('\n=== RC4.31.12.10 — Painel MUC simplificado ===\n');

test('painel MUC não possui campo de preço editável', () => {
  assert.doesNotMatch(compras, /id="valor_total_fracionado_item"/);
  assert.doesNotMatch(compras, /Preço da embalagem/);
  assert.doesNotMatch(compras, /label_valor_embalagem_compra/);
});

test('Preço de Compra único no formulário', () => {
  assert.match(compras, /function obterValorTotalCompraMuc/);
  assert.match(compras, /obterValorTotalCompraMuc\(\)/);
  assert.match(compras, /id="label_preco_compra_item"/);
  assert.match(compras, /Preço da \$\{tipo\}|Preço compra \(unidade\)/);
  assert.match(compras, /onPrecoCompraItemInput/);
});

test('simulação MUC lê total derivado do formulário e não sobrescreve #preco_item', () => {
  assert.match(compras, /const valorTotal = obterValorTotalCompraMuc\(\)/);
  assert.match(compras, /function obterPrecoUnitarioComercialFormularioMuc/);
  assert.doesNotMatch(compras, /\$\('#preco_item'\)\.val\(formatarCustoUnitarioVenda\(custoUnitario\)\)/);
});

test('recálculo ao alterar quantidade, embalagem e preço', () => {
  assert.match(compras, /#quantidade_embalagens_item, #quantidade_por_embalagem_item/);
  assert.match(compras, /onPrecoCompraItemInput[\s\S]*agendarSimulacaoMucCompra/);
  assert.match(compras, /onEmbalagemCompraSelecionada/);
});

test('painel exibe conversão e custo unitário prévia', () => {
  assert.match(compras, /Unidade de Estoque/);
  assert.match(compras, /Quantidade por Unidade\/Embalagem/);
  assert.match(compras, /resultado_custo_unitario_fracionado/);
  assert.match(compras, /resultado_qtd_total_fracionado/);
});

test('formação de preço usa custo unitário MUC para margem', () => {
  assert.match(compras, /ultimaSimulacaoMucCompra\?\.custoUnitario/);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
