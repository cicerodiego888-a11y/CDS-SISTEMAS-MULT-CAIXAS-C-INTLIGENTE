/**
 * RC4.31.12.1 — Finalização compra manual por embalagem comercial
 * Executar: node tests/compras/rc43112.1-finalizacao-embalagem-comercial.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const { obterMuc } = require('../../backend/motores/muc');

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

console.log('\n=== RC4.31.12.1 — Finalização Embalagem Comercial ===\n');

test('UI — Comprar em, Preço de Compra único e painel Resumo', () => {
  const compras = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
  assert.match(compras, /Comprar em/);
  assert.match(compras, /obterValorTotalCompraMuc/);
  assert.match(compras, /<strong>Resumo<\/strong>/);
  assert.match(compras, /restaurandoEmbalagemCompraEdicao/);
});

test('normalizeItemCompra preserva metadados MUC', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
  assert.match(src, /embalagem_id: item\.embalagem_id/);
  assert.match(src, /origem_conversao: item\.origem_conversao/);
  assert.match(src, /fator_conversao: item\.fator_conversao/);
});

test('listarEmbalagensCompra inclui unidade comercial como primeira opção', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produto-apresentacao-resolver.js'), 'utf8');
  assert.match(src, /resolverUnidadeComercialProduto/);
  assert.match(src, /UNIDADE_COMERCIAL/);
});

test('carregamento assíncrono de embalagens após selecionar produto', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
  assert.match(src, /carregarEmbalagensProdutoCompra\(produto\)\.then/);
  assert.match(src, /finalizarPainelEmbalagemComercialCompra/);
});

test('aceite — 3 pacotes × 10 UN = 30 UN no estoque via MUC', () => {
  const muc = obterMuc(null);
  const r = muc.simular({ quantidadeCompra: 3, quantidadePorApresentacao: 10, valorTotal: 29.7 });
  assert.strictEqual(r.quantidadeEstoque, 30);
  assert.strictEqual(r.custoUnitario, 0.99);
});

test('aceite — operador informa embalagem, sistema grava quantidade convertida', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
  assert.match(src, /quantidade_embalagens/);
  assert.match(src, /quantidade_por_embalagem/);
  assert.match(src, /origem_conversao: 'MANUAL'/);
  assert.match(src, /CompraMucClient\.simularConversao/);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
