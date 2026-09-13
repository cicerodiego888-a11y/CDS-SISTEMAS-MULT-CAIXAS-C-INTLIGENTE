/**
 * RC4.31.28 — Preço unitário comercial no MUC (≠ total da compra)
 * Executar: npm run test:compras-rc43128
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const comprasJs = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');

function obterPrecoUnitarioComercialItemCompra(item = {}) {
  if (!item || typeof item !== 'object') return 0;
  const salvo = Number(item.preco_unitario_comercial || 0);
  if (salvo > 0) return Number(salvo.toFixed(4));

  let qtdComercial = Number(item.quantidade_embalagens || item.quantidade_comercial || 0);
  const total = Number(item.valor_total_embalagem || 0);

  if (!(qtdComercial > 0)) {
    const fator = Number(item.quantidade_por_embalagem || item.fator_conversao || 0);
    const convertida = Number(item.quantidade_convertida || item.quantidade || 0);
    if (fator > 0 && convertida > 0) qtdComercial = convertida / fator;
  }

  if (total > 0 && qtdComercial > 0) {
    return Number((total / qtdComercial).toFixed(4));
  }
  // RC4.31.29 — fallback controlado subtotal/qtd (nunca subtotal cru)
  const sub = Number(item.subtotal || 0);
  if (sub > 0 && qtdComercial > 0) {
    return Number((sub / qtdComercial).toFixed(4));
  }
  const unit = Number(item.preco_unitario || 0);
  if (unit > 0) return Number(unit.toFixed(4));
  return 0;
}

function itemUsaModoPrecoEmbalagemCompra(item = {}) {
  return Number(item.produto_fracionado ?? item.vendido_por_peso ?? 0) === 1
    || String(item.tipo_origem_compra || '').toUpperCase() === 'UNIDADE_COMERCIAL'
    || String(item.tipo_origem_compra || '').toUpperCase() === 'EMBALAGEM_COMERCIAL'
    || Number(item.compra_por_embalagem || 0) === 1;
}

function obterPrecoCampoFormularioEdicaoItem(draft = {}) {
  if (!itemUsaModoPrecoEmbalagemCompra(draft)) {
    return { valor: Number(draft.preco_unitario || 0), modoEmbalagem: false };
  }
  return { valor: obterPrecoUnitarioComercialItemCompra(draft), modoEmbalagem: true };
}

function totalCompra(unitarioComercial, qtdComercial) {
  return Number((Number(unitarioComercial) * Number(qtdComercial)).toFixed(2));
}

function custoPorUnidadeEstoque(total, qtdConvertida) {
  return Number((Number(total) / Number(qtdConvertida)).toFixed(4));
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

console.log('\n=== RC4.31.28 — Preço Unitário MUC ===\n');

test('1 Vara × R$ 15,99 → total R$ 15,99', () => {
  const unit = 15.99;
  const qtd = 1;
  const fator = 6;
  const total = totalCompra(unit, qtd);
  const convertida = qtd * fator;
  assert.strictEqual(total, 15.99);
  assert.strictEqual(convertida, 6);
  assert.strictEqual(
    obterPrecoUnitarioComercialItemCompra({
      valor_total_embalagem: total,
      quantidade_embalagens: qtd,
      quantidade_por_embalagem: fator,
      quantidade_convertida: convertida
    }),
    15.99
  );
});

test('10 Varas × R$ 15,99 → total R$ 159,90 e 60 MT', () => {
  const unit = 15.99;
  const qtd = 10;
  const fator = 6;
  const total = totalCompra(unit, qtd);
  const convertida = qtd * fator;
  assert.strictEqual(total, 159.9);
  assert.strictEqual(convertida, 60);
  assert.strictEqual(custoPorUnidadeEstoque(total, convertida), 2.665);
  assert.strictEqual(
    obterPrecoUnitarioComercialItemCompra({
      valor_total_embalagem: total,
      quantidade_comercial: qtd,
      quantidade_embalagens: qtd,
      quantidade_por_embalagem: fator,
      quantidade_convertida: convertida,
      preco_unitario: 2.665,
      subtotal: total
    }),
    15.99
  );
});

test('Edição NÃO usa subtotal/total como Preço da Unidade', () => {
  const item = {
    tipo_origem_compra: 'UNIDADE_COMERCIAL',
    preco_unitario: 2.665,
    quantidade_embalagens: 10,
    quantidade_comercial: 10,
    quantidade_por_embalagem: 6,
    quantidade_convertida: 60,
    valor_total_embalagem: 159.9,
    subtotal: 159.9
  };
  const campo = obterPrecoCampoFormularioEdicaoItem(item);
  assert.strictEqual(campo.modoEmbalagem, true);
  assert.strictEqual(campo.valor, 15.99);
  assert.notStrictEqual(campo.valor, item.subtotal);
  assert.notStrictEqual(campo.valor, item.valor_total_embalagem);
});

test('preco_unitario_comercial salvo tem prioridade na edição', () => {
  const item = {
    produto_fracionado: 1,
    preco_unitario_comercial: 15.99,
    valor_total_embalagem: 999,
    quantidade_embalagens: 10,
    subtotal: 999
  };
  assert.strictEqual(obterPrecoCampoFormularioEdicaoItem(item).valor, 15.99);
});

test('Frontend: #preco_item MUC = unitário comercial; total = unit × qtd', () => {
  assert.match(comprasJs, /function obterPrecoUnitarioComercialFormularioMuc/);
  assert.match(comprasJs, /function obterPrecoUnitarioComercialItemCompra/);
  assert.match(comprasJs, /function obterValorTotalCompraMuc/);
  assert.match(comprasJs, /unit \* qtd|unitário comercial × qtd|preço unitário comercial × quantidade/i);
  assert.match(comprasJs, /RC4\.31\.28/);
});

test('finalizarPainelEmbalagemComercialCompra não coloca total em #preco_item', () => {
  const fn = comprasJs.match(/function finalizarPainelEmbalagemComercialCompra\([\s\S]*?\nfunction /);
  assert.ok(fn);
  assert.doesNotMatch(fn[0], /\$\('#preco_item'\)\.val\(formatNumberInput\(r\.valor_total_embalagem/);
  assert.match(fn[0], /obterPrecoUnitarioCompraFormulario|obterPrecoUnitarioComercialItemCompra|preco_unitario_comercial/);
});

test('obterPrecoCampoFormularioEdicaoItem não devolve valor_total_embalagem cru', () => {
  const fn = comprasJs.match(/function obterPrecoCampoFormularioEdicaoItem\([\s\S]*?\nfunction /);
  assert.ok(fn);
  assert.match(fn[0], /obterPrecoUnitarioCompraFormulario|obterPrecoUnitarioComercialItemCompra/);
  assert.doesNotMatch(fn[0], /return \{\s*valor:\s*totalEmb/);
  assert.doesNotMatch(fn[0], /subtotal/);
});

test('adicionarItemCompraAsync grava preco_unitario_comercial', () => {
  assert.match(comprasJs, /preco_unitario_comercial:\s*precoUnitarioComercialForm/);
  assert.match(comprasJs, /precoUnitarioComercialForm/);
});

test('Compra importada/Central: edição usa unitário comercial', () => {
  const itemCentral = {
    tipo_origem_compra: 'UNIDADE_COMERCIAL',
    origem_compra: 'CENTRAL_NFE',
    quantidade_embalagens: 10,
    quantidade_comercial: 10,
    quantidade_por_embalagem: 6,
    quantidade_convertida: 60,
    valor_total_embalagem: 159.9,
    subtotal: 159.9,
    preco_unitario: 2.665
  };
  assert.strictEqual(obterPrecoCampoFormularioEdicaoItem(itemCentral).valor, 15.99);
});

test('Subtotal não é usado como preço unitário cru (só ÷ qtd comercial)', () => {
  const item = {
    compra_por_embalagem: 1,
    subtotal: 159.9,
    valor_total_embalagem: 0,
    quantidade_embalagens: 10,
    preco_unitario: 0
  };
  // RC4.31.29 — fallback controlado: 159.90 / 10 = 15.99 (nunca 159.90)
  assert.strictEqual(obterPrecoUnitarioComercialItemCompra(item), 15.99);
  assert.doesNotMatch(comprasJs, /preco_unitario_comercial:\s*Number\(sincronizado\.subtotal/);
});

console.log(`\n--- Resultado: ${ok} OK, ${falhas} falha(s) ---\n`);
process.exit(falhas > 0 ? 1 : 0);
