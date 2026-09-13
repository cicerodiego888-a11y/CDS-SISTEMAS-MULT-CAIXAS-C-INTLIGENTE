/**
 * RC4.31.22 — Utilização da Margem Cadastrada do Produto
 * Executar: npm run test:compras-rc43122
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const comprasJs = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');

const MARGEM_PADRAO_FALLBACK_COMPRA = 35;

function extrairMargemCadastradaProduto(produto) {
  if (!produto || typeof produto !== 'object') {
    return { margem: MARGEM_PADRAO_FALLBACK_COMPRA, fallback: true, origem: 'padrao' };
  }
  const candidatos = [
    produto.lucro_percentual,
    produto.margem_lucro,
    produto.margem_padrao,
    produto.percentual_lucro
  ];
  for (const raw of candidatos) {
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return { margem: n, fallback: false, origem: 'cadastro' };
    }
  }
  return { margem: MARGEM_PADRAO_FALLBACK_COMPRA, fallback: true, origem: 'padrao' };
}

function itemCompraTemMargemGravada(item) {
  if (!item) return false;
  const raw = item.margem_lucro;
  if (raw === undefined || raw === null || raw === '') return false;
  return Number.isFinite(Number(raw));
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

console.log('\n=== RC4.31.22 — Margem Cadastrada do Produto ===\n');

test('Helper extrairMargemCadastradaProduto existe no frontend', () => {
  assert.match(comprasJs, /function extrairMargemCadastradaProduto/);
  assert.match(comprasJs, /MARGEM_PADRAO_FALLBACK_COMPRA = 35/);
  assert.match(comprasJs, /function aplicarDadosComerciaisProdutoFormularioCompra|function aplicarMargemProdutoFormularioCompra/);
});

test('Produto com margem 15%', () => {
  const r = extrairMargemCadastradaProduto({ lucro_percentual: 15 });
  assert.strictEqual(r.margem, 15);
  assert.strictEqual(r.fallback, false);
});

test('Produto com margem 28%', () => {
  const r = extrairMargemCadastradaProduto({ lucro_percentual: 28 });
  assert.strictEqual(r.margem, 28);
  assert.strictEqual(r.fallback, false);
});

test('Produto com margem 45%', () => {
  const r = extrairMargemCadastradaProduto({ margem_lucro: 45 });
  assert.strictEqual(r.margem, 45);
  assert.strictEqual(r.fallback, false);
});

test('Produto com margem 52,5%', () => {
  const r = extrairMargemCadastradaProduto({ percentual_lucro: 52.5 });
  assert.strictEqual(r.margem, 52.5);
  assert.strictEqual(r.fallback, false);
});

test('Produto com margem 0% (válida — não cai no fallback)', () => {
  const r = extrairMargemCadastradaProduto({ lucro_percentual: 0 });
  assert.strictEqual(r.margem, 0);
  assert.strictEqual(r.fallback, false);
});

test('Produto sem margem → fallback 35%', () => {
  const r = extrairMargemCadastradaProduto({ nome: 'Sem margem' });
  assert.strictEqual(r.margem, 35);
  assert.strictEqual(r.fallback, true);
});

test('Editar item — margem gravada é preservada', () => {
  assert.strictEqual(itemCompraTemMargemGravada({ margem_lucro: 18 }), true);
  assert.strictEqual(itemCompraTemMargemGravada({ margem_lucro: 0 }), true);
  assert.strictEqual(itemCompraTemMargemGravada({}), false);
  assert.match(comprasJs, /preservarSeEdicao/);
  assert.match(comprasJs, /ORIGEM_BASE_COMERCIAL_COMPRA\.ITEM|preserva/);
});

test('Não há atribuição fixa lucro_percentual || 30', () => {
  assert.doesNotMatch(comprasJs, /lucro_percentual\s*\|\|\s*30/);
  assert.doesNotMatch(comprasJs, /margem_lucro:\s*30/);
  assert.doesNotMatch(comprasJs, /#margem_padrao_item'\)\.val\('30'\)/);
});

test('Campo Margem % inicia vazio (sem value=30)', () => {
  assert.match(comprasJs, /id="margem_padrao_item"[^>]*value=""/);
  assert.match(comprasJs, /hintMargemPadraoCompra/);
});

test('alterarProdutoItemCompra aplica margem do cadastro', () => {
  const fn = comprasJs.match(/function alterarProdutoItemCompra\([\s\S]*?\n\}/);
  assert.ok(fn, 'alterarProdutoItemCompra deve existir');
  assert.match(fn[0], /extrairMargemCadastradaProduto\(produto\)/);
});

test('adicionarItemCompraAsync usa form → cadastro → fallback', () => {
  assert.match(comprasJs, /resolverDadosComerciaisProdutoCompra\(produto,\s*ultima\)\.margem_lucro/);
  assert.match(comprasJs, /RC4\.31\.26 — form \(manual\/cadastro\/35%\) → resolver → fallback 35%/);
});

test('onProdutoSelecionado / onProdutoInput / onProdutoKeyDown sem || 30', () => {
  const onSel = comprasJs.match(/function onProdutoSelecionado\(\) \{[\s\S]*?\n\}/);
  assert.ok(onSel);
  assert.match(onSel[0], /aplicarDadosComerciaisProdutoFormularioCompra|aplicarMargemProdutoFormularioCompra/);
  assert.doesNotMatch(onSel[0], /\|\|\s*30/);
});

console.log(`\n--- Resultado: ${ok} OK, ${falhas} falha(s) ---\n`);
process.exit(falhas > 0 ? 1 : 0);
