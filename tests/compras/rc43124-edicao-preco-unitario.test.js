/**
 * RC4.31.24 — Correção edição: preço unitário × modo embalagem
 * Executar: npm run test:compras-rc43124
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const comprasJs = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');

function embalagemIdCompraEhValido(embalagemId) {
  if (embalagemId == null || embalagemId === '') return false;
  const id = String(embalagemId);
  if (id.startsWith('temp-') || id.startsWith('unidade-') || id.startsWith('uc-')
    || id.startsWith('legado-') || id.startsWith('unidade-base-')) {
    return false;
  }
  return true;
}

function itemCompraEhFracionado(item = {}) {
  return Number(item.produto_fracionado ?? item.vendido_por_peso ?? 0) === 1;
}

function produtoUsaEmbalagemComercialCompra(produto) {
  return Boolean(produto && Number(produto.compra_por_embalagem || 0) === 1);
}

function itemUsaEmbalagemComercial(item = {}, produto = null) {
  if (!item || typeof item !== 'object') return false;
  if (itemCompraEhFracionado(item)) return false;
  const prod = produto || null;
  if (produtoUsaEmbalagemComercialCompra(prod)) return true;
  if (Number(item.compra_por_embalagem || 0) === 1) return true;
  if (embalagemIdCompraEhValido(item.embalagem_id)
    || embalagemIdCompraEhValido(item.produto_apresentacao_id)) {
    return true;
  }
  const origem = String(item.tipo_origem_compra || '').toUpperCase();
  if (origem === 'EMBALAGEM_COMERCIAL' || origem === 'UNIDADE_COMERCIAL') return true;
  return false;
}

function itemUsaModoPrecoEmbalagemCompra(item = {}, produto = null) {
  return itemCompraEhFracionado(item) || itemUsaEmbalagemComercial(item, produto);
}

function obterPrecoUnitarioComercialItemCompra(item = {}) {
  const salvo = Number(item.preco_unitario_comercial || 0);
  if (salvo > 0) return Number(salvo.toFixed(4));
  let qtd = Number(item.quantidade_embalagens || item.quantidade_comercial || 0);
  const total = Number(item.valor_total_embalagem || 0);
  if (!(qtd > 0)) {
    const fator = Number(item.quantidade_por_embalagem || item.fator_conversao || 0);
    const convertida = Number(item.quantidade_convertida || item.quantidade || 0);
    if (fator > 0 && convertida > 0) qtd = convertida / fator;
  }
  if (total > 0 && qtd > 0) return Number((total / qtd).toFixed(4));
  return 0;
}

function obterPrecoCampoFormularioEdicaoItem(draft = {}, produto = null) {
  const usaModoEmb = itemUsaModoPrecoEmbalagemCompra(draft, produto);
  if (!usaModoEmb) {
    return { valor: Number(draft.preco_unitario || 0), modoEmbalagem: false };
  }
  // RC4.31.28 — campo = unitário comercial (não o total)
  return { valor: obterPrecoUnitarioComercialItemCompra(draft), modoEmbalagem: true };
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

console.log('\n=== RC4.31.24 — Edição Preço Unitário × Embalagem ===\n');

test('Função canônica itemUsaEmbalagemComercial existe', () => {
  assert.match(comprasJs, /function itemUsaEmbalagemComercial\(/);
  assert.match(comprasJs, /function obterPrecoCampoFormularioEdicaoItem\(/);
  assert.match(comprasJs, /function itemUsaModoPrecoEmbalagemCompra\(/);
});

test('Produto comum com quantidade_embalagens (Central) NÃO entra em modo embalagem', () => {
  const item = {
    quantidade: 5,
    quantidade_embalagens: 5,
    quantidade_comercial: 5,
    preco_unitario: 10.09,
    subtotal: 50.45,
    valor_total_embalagem: 50.45,
    compra_em: ''
  };
  assert.strictEqual(itemUsaEmbalagemComercial(item), false);
  const preco = obterPrecoCampoFormularioEdicaoItem(item);
  assert.strictEqual(preco.modoEmbalagem, false);
  assert.strictEqual(preco.valor, 10.09);
});

test('Produto com compra_por_embalagem entra em modo embalagem', () => {
  const item = { preco_unitario: 2, valor_total_embalagem: 48, quantidade_embalagens: 2 };
  const produto = { compra_por_embalagem: 1 };
  assert.strictEqual(itemUsaEmbalagemComercial(item, produto), true);
  // RC4.31.28 — 48 / 2 = 24 (unitário comercial)
  assert.strictEqual(obterPrecoCampoFormularioEdicaoItem(item, produto).valor, 24);
});

test('tipo_origem_compra EMBALAGEM_COMERCIAL ativa modo', () => {
  assert.strictEqual(itemUsaEmbalagemComercial({
    tipo_origem_compra: 'EMBALAGEM_COMERCIAL',
    preco_unitario: 1
  }), true);
});

test('tipo_origem_compra UNIDADE_COMERCIAL ativa modo', () => {
  assert.strictEqual(itemUsaEmbalagemComercial({
    tipo_origem_compra: 'UNIDADE_COMERCIAL',
    preco_unitario: 1
  }), true);
});

test('embalagem_id válido ativa modo; temp-/uc- não', () => {
  assert.strictEqual(itemUsaEmbalagemComercial({ embalagem_id: 42 }), true);
  assert.strictEqual(itemUsaEmbalagemComercial({ embalagem_id: 'temp-1' }), false);
  assert.strictEqual(itemUsaEmbalagemComercial({ embalagem_id: 'uc-nova' }), false);
});

test('Fracionado usa modo preço embalagem (unitário comercial), sem subtotal como fallback', () => {
  const item = {
    produto_fracionado: 1,
    preco_unitario: 2.665,
    quantidade: 6,
    quantidade_convertida: 6,
    quantidade_embalagens: 1,
    quantidade_por_embalagem: 6,
    valor_total_embalagem: 15.99,
    subtotal: 15.99
  };
  assert.strictEqual(itemUsaEmbalagemComercial(item), false);
  assert.strictEqual(itemUsaModoPrecoEmbalagemCompra(item), true);
  assert.strictEqual(obterPrecoCampoFormularioEdicaoItem(item).valor, 15.99);
});

test('editarItemCompra usa itemUsaEmbalagemComercial e obterPrecoCampoFormularioEdicaoItem', () => {
  const fn = comprasJs.match(/function editarItemCompra\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /itemUsaEmbalagemComercial\(draft/);
  assert.match(fn[0], /obterPrecoCampoFormularioEdicaoItem/);
  assert.doesNotMatch(fn[0], /quantidade_embalagens \|\| 0\) > 0/);
  assert.doesNotMatch(fn[0], /valor_total_embalagem \|\| draft\.subtotal/);
});

test('saveCompra não atribui valor_total_embalagem = subtotal em item comum', () => {
  assert.match(comprasJs, /itemUsaModoPrecoEmbalagemCompra\(sincronizado\)/);
  assert.doesNotMatch(comprasJs, /valor_total_embalagem: Number\(sincronizado\.valor_total_embalagem \|\| sincronizado\.subtotal/);
});

test('Rótulo Preço da {tipo} / Preço compra \(unidade\)', () => {
  assert.match(comprasJs, /Preço da \$\{tipo\}/);
  assert.match(comprasJs, /Preço compra \(unidade\)/);
});

test('adicionarItemCompraAsync usa itemUsaEmbalagemComercial', () => {
  const fn = comprasJs.match(/async function adicionarItemCompraAsync\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /itemUsaEmbalagemComercial\(/);
});

test('Nunca usar quantidade_embalagens como critério em itemUsaEmbalagemComercial', () => {
  const fn = comprasJs.match(/function itemUsaEmbalagemComercial\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.doesNotMatch(fn[0], /quantidade_embalagens/);
  assert.doesNotMatch(fn[0], /compra_em/);
});

console.log(`\n--- Resultado: ${ok} OK, ${falhas} falha(s) ---\n`);
process.exit(falhas > 0 ? 1 : 0);
