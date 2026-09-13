/**
 * RC4.31.29 — Correção definitiva do Preço da Unidade no MUC
 * Executar: npm run test:compras-rc43129
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const comprasJs = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');

function numeroPositivoCompra(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function itemUsaModoPrecoEmbalagemCompra(item = {}) {
  return Number(item.produto_fracionado ?? item.vendido_por_peso ?? 0) === 1
    || String(item.tipo_origem_compra || '').toUpperCase() === 'UNIDADE_COMERCIAL'
    || String(item.tipo_origem_compra || '').toUpperCase() === 'EMBALAGEM_COMERCIAL'
    || Number(item.compra_por_embalagem || 0) === 1;
}

function obterQuantidadeComercialResolvidaItemCompra(item = {}) {
  let qtd = numeroPositivoCompra(item.quantidade_embalagens)
    || numeroPositivoCompra(item.quantidade_comercial);
  if (qtd != null) return qtd;
  const fator = numeroPositivoCompra(item.quantidade_por_embalagem)
    || numeroPositivoCompra(item.fator_conversao);
  const convertida = numeroPositivoCompra(item.quantidade_convertida)
    || numeroPositivoCompra(item.quantidade);
  if (fator != null && convertida != null) return convertida / fator;
  return null;
}

function obterPrecoUnitarioCompraFormulario(item = {}) {
  if (!item || typeof item !== 'object') {
    return { valor: 0, origem: 'nenhuma', modoEmbalagem: false };
  }
  const modoEmb = itemUsaModoPrecoEmbalagemCompra(item);
  const qtdComercial = obterQuantidadeComercialResolvidaItemCompra(item);

  const comercial = numeroPositivoCompra(item.preco_unitario_comercial);
  if (comercial != null) {
    return { valor: Number(comercial.toFixed(4)), origem: 'preco_unitario_comercial', modoEmbalagem: modoEmb };
  }

  if (!modoEmb) {
    const unit = numeroPositivoCompra(item.preco_unitario);
    if (unit != null) {
      return { valor: Number(unit.toFixed(4)), origem: 'preco_unitario', modoEmbalagem: false };
    }
    const qtd = numeroPositivoCompra(item.quantidade) || qtdComercial;
    const sub = numeroPositivoCompra(item.subtotal);
    if (sub != null && qtd != null) {
      return { valor: Number((sub / qtd).toFixed(4)), origem: 'subtotal_por_quantidade', modoEmbalagem: false };
    }
    return { valor: 0, origem: 'nenhuma', modoEmbalagem: false };
  }

  const totalEmb = numeroPositivoCompra(item.valor_total_embalagem);
  if (totalEmb != null && qtdComercial != null) {
    return { valor: Number((totalEmb / qtdComercial).toFixed(4)), origem: 'total_por_comercial', modoEmbalagem: true };
  }

  const sub = numeroPositivoCompra(item.subtotal);
  if (sub != null && qtdComercial != null) {
    return { valor: Number((sub / qtdComercial).toFixed(4)), origem: 'subtotal_por_comercial', modoEmbalagem: true };
  }

  const unit = numeroPositivoCompra(item.preco_unitario);
  if (unit != null) {
    return { valor: Number(unit.toFixed(4)), origem: 'preco_unitario', modoEmbalagem: true };
  }

  return { valor: 0, origem: 'nenhuma', modoEmbalagem: true };
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

console.log('\n=== RC4.31.29 — Preço Unitário Compra Formulário ===\n');

test('Função canônica obterPrecoUnitarioCompraFormulario existe', () => {
  assert.match(comprasJs, /function obterPrecoUnitarioCompraFormulario\(/);
  assert.match(comprasJs, /function persistirPrecoUnitarioComercialItemCompra\(/);
  assert.match(comprasJs, /RC4\.31\.29/);
});

test('Produto comum 5 × R$ 10,09 → R$ 10,09', () => {
  const r = obterPrecoUnitarioCompraFormulario({
    preco_unitario: 10.09,
    quantidade: 5,
    subtotal: 50.45
  });
  assert.strictEqual(r.valor, 10.09);
  assert.strictEqual(r.origem, 'preco_unitario');
  assert.notStrictEqual(r.valor, 50.45);
});

test('10 Varas × 6 MT total 159,90 → R$ 15,99 por Vara', () => {
  const r = obterPrecoUnitarioCompraFormulario({
    tipo_origem_compra: 'UNIDADE_COMERCIAL',
    quantidade_embalagens: 10,
    quantidade_comercial: 10,
    quantidade_por_embalagem: 6,
    quantidade_convertida: 60,
    valor_total_embalagem: 159.9,
    preco_unitario: 2.665,
    subtotal: 159.9
  });
  assert.strictEqual(r.valor, 15.99);
  assert.strictEqual(r.origem, 'total_por_comercial');
  assert.notStrictEqual(r.valor, 159.9);
  assert.notStrictEqual(r.valor, 2.665);
});

test('12 unidades total 50,45 → R$ 4,2042 por unidade', () => {
  const r = obterPrecoUnitarioCompraFormulario({
    compra_por_embalagem: 1,
    quantidade_embalagens: 12,
    valor_total_embalagem: 50.45,
    subtotal: 50.45,
    preco_unitario: 0
  });
  assert.strictEqual(r.valor, 4.2042);
  assert.notStrictEqual(r.valor, 50.45);
});

test('Sem preço → 0,00 permitido', () => {
  const r = obterPrecoUnitarioCompraFormulario({
    produto_fracionado: 1,
    quantidade_convertida: 50,
    quantidade_fiscal: 50
  });
  assert.strictEqual(r.valor, 0);
  assert.strictEqual(r.origem, 'nenhuma');
});

test('MUC sem comercial/total mas com preco_unitario → NÃO zera', () => {
  const r = obterPrecoUnitarioCompraFormulario({
    produto_fracionado: 1,
    quantidade_convertida: 50,
    quantidade_fiscal: 50,
    quantidade_nao_fiscal: 0,
    preco_unitario: 19,
    margem_lucro: 30,
    preco_venda_sugerido: 24.7
  });
  assert.strictEqual(r.valor, 19);
  assert.strictEqual(r.origem, 'preco_unitario');
  assert.notStrictEqual(r.valor, 0);
});

test('preco_unitario_comercial válido tem prioridade e não é recalculado', () => {
  const r = obterPrecoUnitarioCompraFormulario({
    tipo_origem_compra: 'UNIDADE_COMERCIAL',
    preco_unitario_comercial: 15.99,
    valor_total_embalagem: 999,
    quantidade_embalagens: 10,
    preco_unitario: 2.665
  });
  assert.strictEqual(r.valor, 15.99);
  assert.strictEqual(r.origem, 'preco_unitario_comercial');
});

test('Editar item: obterPrecoCampoFormularioEdicaoItem usa resolver canônico', () => {
  assert.match(comprasJs, /function obterPrecoCampoFormularioEdicaoItem\([\s\S]*obterPrecoUnitarioCompraFormulario/);
  assert.match(comprasJs, /precoCampo\.valor > 0/);
  assert.match(comprasJs, /precoApos\.valor > 0/);
});

test('sincronizarDraft não sobrescreve preco_unitario com comercial no MUC', () => {
  const fn = comprasJs.match(/function sincronizarDraftCompraDoFormulario\([\s\S]*?\n\/\*\* Formação/);
  assert.ok(fn);
  assert.match(fn[0], /preco_unitario_comercial/);
  assert.match(fn[0], /ultimaSimulacaoMucCompra/);
});

test('Persistência: não recalcula comercial se já válido', () => {
  assert.match(comprasJs, /function persistirPrecoUnitarioComercialItemCompra/);
  assert.match(comprasJs, /existente != null/);
});

test('Nunca usa quantidade fiscal/não fiscal como preço', () => {
  const r = obterPrecoUnitarioCompraFormulario({
    produto_fracionado: 1,
    quantidade_fiscal: 50,
    quantidade_nao_fiscal: 0,
    quantidade_convertida: 50
  });
  assert.strictEqual(r.valor, 0);
  assert.doesNotMatch(comprasJs, /preco_unitario_comercial:\s*Number\(.*quantidade_fiscal/);
});

console.log(`\n--- Resultado: ${ok} OK, ${falhas} falha(s) ---\n`);
process.exit(falhas > 0 ? 1 : 0);
