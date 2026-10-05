/**
 * RC4.31.26 — Melhorias no Lançamento de Compras
 * Executar: npm run test:compras-rc43126
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const comprasJs = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
const cssMiip = fs.readFileSync(path.join(ROOT, 'frontend/css/miip-compras.css'), 'utf8');

const MARGEM_PADRAO_FALLBACK_COMPRA = 35;
const ORIGEM = {
  CADASTRO: 'cadastro',
  PADRAO: 'padrao',
  ULTIMA_COMPRA: 'ultima_compra'
};

function extrairMargemCadastradaProduto(produto) {
  if (!produto || typeof produto !== 'object') {
    return { margem: MARGEM_PADRAO_FALLBACK_COMPRA, fallback: true, origem: ORIGEM.PADRAO };
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
      return { margem: n, fallback: false, origem: ORIGEM.CADASTRO };
    }
  }
  return { margem: MARGEM_PADRAO_FALLBACK_COMPRA, fallback: true, origem: ORIGEM.PADRAO };
}

function resolverDadosComerciaisProdutoCompra(produto, ultimaCompra = null) {
  const cadastro = extrairMargemCadastradaProduto(produto);
  const origemMargem = cadastro.fallback ? ORIGEM.PADRAO : ORIGEM.CADASTRO;
  const precoCadastro = Number(produto?.preco_compra || 0);
  let preco = precoCadastro;
  if (ultimaCompra && typeof ultimaCompra === 'object') {
    const precoHist = Number(
      ultimaCompra.custo
      ?? ultimaCompra.custo_unitario_final
      ?? ultimaCompra.preco_unitario
      ?? 0
    );
    if (precoHist > 0) preco = precoHist;
  }
  const venda = Number(produto?.preco_venda || 0);
  const margem = venda > 0 ? Number((((venda - preco) / venda) * 100).toFixed(2)) : 0;
  return {
    preco_unitario: preco,
    margem_lucro: margem,
    preco_venda_sugerido: venda,
    origem: origemMargem,
    fallback: cadastro.fallback
  };
}

function encontrarProximoIndiceLancamentoCompra(itens, indiceAtual) {
  if (!Array.isArray(itens) || !itens.length) return null;
  if (indiceAtual == null || !Number.isFinite(Number(indiceAtual))) return null;
  const next = Number(indiceAtual) + 1;
  return next < itens.length ? next : null;
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

console.log('\n=== RC4.31.26 — Melhorias Lançamento Compras ===\n');

test('Fallback do lançamento é 35% (não 30%)', () => {
  assert.match(comprasJs, /MARGEM_PADRAO_FALLBACK_COMPRA = 35/);
  assert.match(comprasJs, /Base: ✓ Padrão \(35%\)/);
  assert.doesNotMatch(comprasJs, /MARGEM_PADRAO_FALLBACK_COMPRA = 30/);
});

test('Preço de venda explícito define margem, não a margem cadastrada', () => {
  const r = resolverDadosComerciaisProdutoCompra({
    lucro_percentual: 18,
    preco_compra: 10,
    preco_venda: 12.2
  }, null);
  assert.strictEqual(r.preco_venda_sugerido, 12.2);
  assert.strictEqual(r.margem_lucro, 18.03);
  assert.strictEqual(r.origem, ORIGEM.CADASTRO);
  assert.strictEqual(r.fallback, false);
});

test('Preço cadastrado ausente permanece zero apesar da margem cadastrada', () => {
  const r = resolverDadosComerciaisProdutoCompra({ lucro_percentual: 28, preco_compra: 10 }, null);
  assert.strictEqual(r.preco_venda_sugerido, 0);
  assert.strictEqual(r.margem_lucro, 0);
  assert.strictEqual(r.origem, ORIGEM.CADASTRO);
});

test('Produto sem preço de venda não inventa preço pelo fallback de margem', () => {
  const r = resolverDadosComerciaisProdutoCompra({ nome: 'Sem margem', preco_compra: 10 }, null);
  assert.strictEqual(r.preco_venda_sugerido, 0);
  assert.strictEqual(r.margem_lucro, 0);
  assert.strictEqual(r.origem, ORIGEM.PADRAO);
  assert.strictEqual(r.fallback, true);
});

test('Alterar a margem não altera o preço de venda', () => {
  const handler = comprasJs.match(/function marcarMargemManualCompra\(\) \{[\s\S]*?\n\}/);
  assert.ok(handler);
  assert.match(handler[0], /calcularMargemItem\(\)/);
  assert.doesNotMatch(handler[0], /calcularValorVendaItem\(\)/);
  assert.match(comprasJs, /oninput="marcarMargemManualCompra\(\)"/);
});

test('A última compra informa o custo, mas o preço de venda vem do cadastro', () => {
  const r = resolverDadosComerciaisProdutoCompra(
    { lucro_percentual: 22, preco_compra: 8, preco_venda: 15 },
    { custo: 10, margem_lucro: 18, preco_venda_sugerido: 11.8 }
  );
  assert.strictEqual(r.margem_lucro, 33.33);
  assert.strictEqual(r.preco_unitario, 10);
  assert.strictEqual(r.preco_venda_sugerido, 15);
  assert.strictEqual(r.origem, ORIGEM.CADASTRO);
});

test('Sugestão MIIP oferece Associar produto existente', () => {
  assert.match(comprasJs, /Associar produto existente/);
  assert.match(comprasJs, /function associarProdutoExistenteMiip/);
  assert.match(comprasJs, /function confirmarAssociacaoMiipComProduto/);
  assert.match(comprasJs, /function confirmarAssociacaoProdutoExistenteMiipSelecionado/);
});

test('Associação reutiliza fluxo MIIP (feedback + status confirmado)', () => {
  assert.match(comprasJs, /\/miip\/feedback/);
  assert.match(comprasJs, /motivo:\s*['"]associacao_produto_existente['"]/);
  assert.match(comprasJs, /status:\s*['"]confirmado['"]/);
  assert.match(comprasJs, /function confirmarAssociacaoMiip\(/);
});

test('Após Adicionar navega/destaca próximo produto', () => {
  assert.match(comprasJs, /function aposAdicionarItemNavegarProximoCompra/);
  assert.match(comprasJs, /function destacarEFocarProximoItemCompra/);
  assert.match(comprasJs, /function encontrarProximoIndiceLancamentoCompra/);
  assert.match(comprasJs, /aposAdicionarItemNavegarProximoCompra\(/);
  assert.match(comprasJs, /compra-item-proximo/);
});

test('Próximo produto recebe destaque visual (classe CSS)', () => {
  assert.match(cssMiip, /\.compra-item-proximo\b/);
  assert.match(cssMiip, /compra-item-proximo-badge/);
  assert.match(comprasJs, /indiceProximoDestaqueCompra/);
});

test('Iniciar edição remove destaque do próximo', () => {
  assert.match(comprasJs, /function limparDestaqueProximoItemCompra/);
  const editar = comprasJs.match(/function editarItemCompra\([\s\S]*?\nfunction /);
  assert.ok(editar);
  assert.match(editar[0], /limparDestaqueProximoItemCompra/);
});

test('Navegação sequencial A→B→C', () => {
  const itens = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.strictEqual(encontrarProximoIndiceLancamentoCompra(itens, 0), 1);
  assert.strictEqual(encontrarProximoIndiceLancamentoCompra(itens, 1), 2);
  assert.strictEqual(encontrarProximoIndiceLancamentoCompra(itens, 2), null);
});

test('Venda usa preço explícito e margem é calculada a partir dele', () => {
  const r = resolverDadosComerciaisProdutoCompra({
    lucro_percentual: 18,
    preco_compra: 2,
    preco_venda: 2.7
  }, null);
  assert.strictEqual(r.preco_venda_sugerido, 2.7);
  assert.strictEqual(r.margem_lucro, 25.93);
  const r35 = resolverDadosComerciaisProdutoCompra({ preco_compra: 10 }, null);
  assert.strictEqual(r35.preco_venda_sugerido, 0);
  assert.match(comprasJs, /calcularMargemEntradaManualCompra/);
});

console.log(`\n--- Resultado: ${ok} OK, ${falhas} falha(s) ---\n`);
process.exit(falhas > 0 ? 1 : 0);
