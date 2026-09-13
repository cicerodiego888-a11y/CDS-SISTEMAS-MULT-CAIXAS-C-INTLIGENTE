/**
 * RC4.31.12 — Compra manual inteligente por embalagem comercial (MUC)
 * Executar: node tests/compras/rc43112-compra-manual-muc.test.js
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

console.log('\n=== RC4.31.12 — Compra Manual MUC ===\n');

test('API simular-conversao-muc registrada', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
  assert.match(src, /simular-conversao-muc/);
  assert.match(src, /muc\.simular/);
});

test('MUC simular — 1 pacote × 10 UN = 10 UN estoque', () => {
  const muc = obterMuc(null);
  const r = muc.simular({ quantidadeCompra: 1, quantidadePorApresentacao: 10, valorTotal: 9.9 });
  assert.strictEqual(r.quantidadeEstoque, 10);
  assert.strictEqual(r.custoUnitario, 0.99);
});

test('MUC simular — 2 caixas × 24 UN = 48 UN', () => {
  const muc = obterMuc(null);
  const r = muc.simular({ quantidadeCompra: 2, quantidadePorApresentacao: 24, valorTotal: 48 });
  assert.strictEqual(r.quantidadeEstoque, 48);
  assert.strictEqual(r.custoUnitario, 1);
});

test('MUC simular — 5 fardos × 12 UN = 60 UN', () => {
  const muc = obterMuc(null);
  const r = muc.simular({ quantidadeCompra: 5, quantidadePorApresentacao: 12, valorTotal: 300 });
  assert.strictEqual(r.quantidadeEstoque, 60);
  assert.strictEqual(r.custoUnitario, 5);
});

test('MUC simular — 3 pacotes × 10 UN, R$ 9,90 → unitário R$ 0,99', () => {
  const muc = obterMuc(null);
  const r = muc.simular({ quantidadeCompra: 3, quantidadePorApresentacao: 10, valorTotal: 29.7 });
  assert.strictEqual(r.quantidadeEstoque, 30);
  assert.strictEqual(r.custoUnitario, 0.99);
});

test('processarItemCompra usa origem MANUAL por padrão', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
  assert.match(src, /origem: item\.origem_conversao \|\| opcoes\.origem \|\| 'MANUAL'/);
});

test('UI — Comprar em e cliente MUC', () => {
  const compras = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
  assert.match(compras, /Comprar em/);
  assert.match(compras, /Resumo/);
  assert.match(compras, /CompraMucClient/);
  assert.match(compras, /origem_conversao: 'MANUAL'/);
  assert.match(compras, /embalagem_id/);
  const app = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/app.js'), 'utf8');
  assert.ok(app.indexOf('compra-muc-client.js') < app.indexOf("'/erp/js/compras.js'"));
});

test('ProdutoApresentacaoResolver — listarEmbalagensCompra', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produto-apresentacao-resolver.js'), 'utf8');
  assert.match(src, /listarEmbalagensCompra/);
});

test('Persistência compras_itens — colunas MUC', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
  assert.match(src, /embalagem_id/);
  assert.match(src, /resultado_conversao_json/);
  assert.match(src, /fator_conversao/);
  assert.match(src, /origem_conversao/);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
