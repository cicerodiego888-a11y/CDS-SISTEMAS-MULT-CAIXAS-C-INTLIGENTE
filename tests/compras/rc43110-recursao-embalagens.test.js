/**
 * RC4.31.10 — Recursão Compras ↔ Produto-Embalagens eliminada
 * Executar: node tests/compras/rc43110-recursao-embalagens.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');

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

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function carregarResolver() {
  const src = ler('frontend/erp/js/produto-apresentacao-resolver.js');
  const sandbox = { global: {}, window: {}, console };
  sandbox.window = sandbox.global;
  vm.runInNewContext(src, sandbox, { filename: 'produto-apresentacao-resolver.js' });
  return sandbox.global.ProdutoApresentacaoResolver;
}

console.log('\n=== RC4.31.10 — Recursão Embalagens / Compras ===\n');

test('produto-embalagens.js NÃO referencia produtoUsaEmbalagemComercialCompra', () => {
  const src = ler('frontend/erp/js/produto-embalagens.js');
  assert.doesNotMatch(src, /produtoUsaEmbalagemComercialCompra/);
});

test('compras.js produtoUsaEmbalagemComercialCompra NÃO chama obterApresentacaoCompraProduto', () => {
  const src = ler('frontend/erp/js/compras.js');
  const fn = src.match(/function produtoUsaEmbalagemComercialCompra[\s\S]*?\n}/);
  assert.ok(fn, 'função produtoUsaEmbalagemComercialCompra não encontrada');
  assert.doesNotMatch(fn[0], /obterApresentacaoCompraProduto/);
  assert.doesNotMatch(fn[0], /ProdutoEmbalagensUI\.obterApresentacaoCompraProduto/);
});

test('compras.js delega embalagem comercial ao ProdutoApresentacaoResolver', () => {
  const src = ler('frontend/erp/js/compras.js');
  assert.match(src, /ProdutoApresentacaoResolver\.produtoUsaEmbalagemComercial/);
});

test('produto-embalagens.js delega apresentação ao ProdutoApresentacaoResolver', () => {
  const src = ler('frontend/erp/js/produto-embalagens.js');
  assert.match(src, /ProdutoApresentacaoResolver\.resolverApresentacaoCompra/);
});

test('app.js carrega produto-apresentacao-resolver antes de produto-embalagens (compras)', () => {
  const src = ler('frontend/erp/js/app.js');
  const bloco = src.match(/compras:\s*\[[\s\S]*?\]/);
  assert.ok(bloco);
  const idxResolver = bloco[0].indexOf('produto-apresentacao-resolver');
  const idxEmb = bloco[0].indexOf('produto-embalagens');
  assert.ok(idxResolver >= 0 && idxEmb >= 0);
  assert.ok(idxResolver < idxEmb, 'resolver deve vir antes de produto-embalagens');
});

test('resolver: produto com embalagens CX compra=1 → usa embalagem comercial', () => {
  const R = carregarResolver();
  const produto = {
    id: 1,
    compra_por_embalagem: 1,
    embalagens: [
      { tipo: 'CX', quantidade: 12, compra: 1, ativa: 1, principal: 1 }
    ]
  };
  assert.strictEqual(R.produtoUsaEmbalagemComercial(produto), true);
  const ap = R.resolverApresentacaoCompra(produto);
  assert.strictEqual(ap.tipo, 'CX');
  assert.strictEqual(ap.quantidade, 12);
});

test('resolver: produto legado PACOTE × 6 → apresentação e flag comercial', () => {
  const R = carregarResolver();
  const produto = {
    id: 2,
    quantidade_por_embalagem: 6,
    unidade_comercial: 'PACOTE',
    compra_por_embalagem: 1
  };
  assert.strictEqual(R.produtoUsaEmbalagemComercial(produto), true);
  const ap = R.resolverApresentacaoCompra(produto);
  assert.strictEqual(Number(ap.quantidade), 6);
});

test('resolver: produto UN simples → sem embalagem comercial', () => {
  const R = carregarResolver();
  const produto = { id: 3, unidade: 'UN', quantidade_por_embalagem: 0 };
  assert.strictEqual(R.produtoUsaEmbalagemComercial(produto), false);
  assert.strictEqual(R.resolverApresentacaoCompra(produto), null);
});

test('resolver: chamadas encadeadas não disparam RangeError (ex-recursão)', () => {
  const R = carregarResolver();
  const produto = {
    id: 99,
    quantidade_por_embalagem: 12,
    unidade_comercial: 'CAIXA',
    compra_por_embalagem: 1
  };
  for (let i = 0; i < 50; i += 1) {
    R.produtoUsaEmbalagemComercial(produto);
    R.resolverApresentacaoCompra(produto);
  }
});

test('BUG regressão: obterApresentacao + produtoUsaEmbalagem em sequência (simula Compras)', () => {
  const R = carregarResolver();
  const produto = {
    id: 50,
    nome: 'Refrigerante 2L',
    compra_por_embalagem: 1,
    embalagens: [{ tipo: 'CX', quantidade: 6, compra: 1, ativa: 1 }]
  };
  const usa = R.produtoUsaEmbalagemComercial(produto);
  const ap = R.resolverApresentacaoCompra(produto);
  assert.strictEqual(usa, true);
  assert.ok(ap);
  assert.strictEqual(ap.tipo, 'CX');
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
