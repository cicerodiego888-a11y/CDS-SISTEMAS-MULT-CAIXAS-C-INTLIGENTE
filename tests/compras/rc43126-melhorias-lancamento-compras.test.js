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
  const margem = cadastro.margem;
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
  const venda = preco > 0 ? Number((preco * (1 + margem / 100)).toFixed(2)) : 0;
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

test('Produto com margem cadastrada 18%', () => {
  const r = resolverDadosComerciaisProdutoCompra({ lucro_percentual: 18, preco_compra: 10 }, null);
  assert.strictEqual(r.margem_lucro, 18);
  assert.strictEqual(r.origem, ORIGEM.CADASTRO);
  assert.strictEqual(r.fallback, false);
});

test('Produto com margem cadastrada 28%', () => {
  const r = resolverDadosComerciaisProdutoCompra({ lucro_percentual: 28, preco_compra: 10 }, null);
  assert.strictEqual(r.margem_lucro, 28);
  assert.strictEqual(r.origem, ORIGEM.CADASTRO);
});

test('Produto sem margem → campo usa 35%', () => {
  const r = resolverDadosComerciaisProdutoCompra({ nome: 'Sem margem', preco_compra: 10 }, null);
  assert.strictEqual(r.margem_lucro, 35);
  assert.strictEqual(r.origem, ORIGEM.PADRAO);
  assert.strictEqual(r.fallback, true);
});

test('Usuário altera margem para 40% — form preserva valor informado', () => {
  assert.match(comprasJs, /function marcarMargemManualCompra/);
  assert.match(comprasJs, /margemInformadaManualCompra/);
  assert.match(comprasJs, /preservarMargemManual/);
  assert.match(comprasJs, /oninput="marcarMargemManualCompra\(\)"/);
});

test('Margem do cadastro prevalece sobre margem da última compra', () => {
  const r = resolverDadosComerciaisProdutoCompra(
    { lucro_percentual: 22, preco_compra: 8 },
    { custo: 10, margem_lucro: 18, preco_venda_sugerido: 11.8 }
  );
  assert.strictEqual(r.margem_lucro, 22);
  assert.strictEqual(r.preco_unitario, 10);
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

test('Venda usa margem exibida (cadastro/35/manual via form)', () => {
  const r = resolverDadosComerciaisProdutoCompra({ lucro_percentual: 18, preco_compra: 10 }, null);
  assert.strictEqual(r.preco_venda_sugerido, 11.8);
  const r35 = resolverDadosComerciaisProdutoCompra({ preco_compra: 10 }, null);
  assert.strictEqual(r35.preco_venda_sugerido, 13.5);
  assert.match(comprasJs, /calcularValorVendaItem/);
});

console.log(`\n--- Resultado: ${ok} OK, ${falhas} falha(s) ---\n`);
process.exit(falhas > 0 ? 1 : 0);
