/**
 * RC4.31.12.5 — Compra por Unidade Comercial
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { obterMuc } = require('../../backend/motores/muc');

const ROOT = path.join(__dirname, '../..');

function carregarResolver() {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produto-apresentacao-resolver.js'), 'utf8');
    const fn = new Function(`${src}; return ProdutoApresentacaoResolver;`);
    return fn();
}

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

console.log('\n=== RC4.31.12.5 — Compra por Unidade Comercial ===\n');

test('resolver expõe resolverUnidadeComercialProduto e formatarRotuloOpcaoCompra', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produto-apresentacao-resolver.js'), 'utf8');
  assert.match(src, /resolverUnidadeComercialProduto/);
  assert.match(src, /formatarRotuloOpcaoCompra/);
  assert.match(src, /UNIDADE_COMERCIAL/);
  assert.match(src, /EMBALAGEM_COMERCIAL/);
});

test('caso 01 — 1 Vara = 6 MT', () => {
  const R = carregarResolver();
  const muc = obterMuc(null);
  const produto = {
    id: 1,
    compra_por_embalagem: 1,
    unidade: 'mt',
    embalagens: [
      { id: 10, tipo: 'ROLO', descricao: 'Vara', quantidade: 6, compra: 1, ativa: 1, principal: 1, unidade: 'mt' }
    ]
  };
  const opcoes = R.listarEmbalagensCompra(produto);
  assert.strictEqual(opcoes[0].tipo_origem_compra, 'UNIDADE_COMERCIAL');
  assert.match(R.formatarRotuloOpcaoCompra(opcoes[0]), /Vara \(6/);
  const sim = muc.simular({ quantidadeCompra: 1, quantidadePorApresentacao: 6, valorTotal: 12 });
  assert.strictEqual(sim.quantidadeEstoque, 6);
});

test('caso 02 — 2 Barras = 24 MT', () => {
  const muc = obterMuc(null);
  const sim = muc.simular({ quantidadeCompra: 2, quantidadePorApresentacao: 12, valorTotal: 48 });
  assert.strictEqual(sim.quantidadeEstoque, 24);
});

test('caso 03 — 1 Tubo = 3 MT', () => {
  const muc = obterMuc(null);
  const sim = muc.simular({ quantidadeCompra: 1, quantidadePorApresentacao: 3, valorTotal: 15 });
  assert.strictEqual(sim.quantidadeEstoque, 3);
});

test('caso 04 — 1 Caixa = 60 MT (10 varas × 6 MT)', () => {
  const R = carregarResolver();
  const muc = obterMuc(null);
  const produto = {
    id: 2,
    compra_por_embalagem: 1,
    unidade: 'mt',
    embalagens: [
      { id: 11, tipo: 'ROLO', descricao: 'Vara', quantidade: 6, compra: 1, ativa: 1, principal: 1, unidade: 'mt' },
      { id: 12, tipo: 'CX', descricao: 'Caixa', quantidade: 60, compra: 1, ativa: 1, unidade: 'mt' }
    ]
  };
  const opcoes = R.listarEmbalagensCompra(produto);
  assert.strictEqual(opcoes.length, 2);
  assert.strictEqual(opcoes[0].tipo_origem_compra, 'UNIDADE_COMERCIAL');
  assert.strictEqual(opcoes[1].tipo_origem_compra, 'EMBALAGEM_COMERCIAL');
  const sim = muc.simular({ quantidadeCompra: 1, quantidadePorApresentacao: 60, valorTotal: 600 });
  assert.strictEqual(sim.quantidadeEstoque, 60);
});

test('caso 05 — produto sem embalagem, só unidade comercial legada', () => {
  const R = carregarResolver();
  const produto = {
    id: 3,
    compra_por_embalagem: 1,
    unidade: 'mt',
    unidade_comercial: 'VARA',
    quantidade_por_embalagem: 6
  };
  const opcoes = R.listarEmbalagensCompra(produto);
  assert.strictEqual(opcoes.length, 1);
  assert.strictEqual(opcoes[0].tipo_origem_compra, 'UNIDADE_COMERCIAL');
});

test('persistência — tipo_origem_compra no backend e frontend', () => {
  const compras = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
  assert.match(compras, /tipo_origem_compra/);
  assert.match(ui, /tipo_origem_compra/);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
