/**
 * RC4.31.27 — Retorno ao Lançamento de Compra após cadastro de produto
 * Executar: npm run test:compras-rc43127
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const comprasJs = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
const produtosJs = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');

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

console.log('\n=== RC4.31.27 — Retorno Cadastro Produto → Compra ===\n');

test('Origem COMPRA registrada explicitamente', () => {
  assert.match(comprasJs, /ORIGEM_CADASTRO_PRODUTO\s*=\s*Object\.freeze\(\s*\{\s*COMPRA:\s*['"]COMPRA['"]/);
  assert.match(comprasJs, /origemCadastroProduto\s*=\s*ORIGEM_CADASTRO_PRODUTO\.COMPRA/);
  assert.match(comprasJs, /contextoCadastroProdutoCompra/);
});

test('abrirCadastroProdutoDesdeCompra existe e não chama showCompraModal', () => {
  assert.match(comprasJs, /function abrirCadastroProdutoDesdeCompra/);
  const fn = comprasJs.match(/function abrirCadastroProdutoDesdeCompra\([\s\S]*?\nfunction /);
  assert.ok(fn);
  assert.doesNotMatch(fn[0], /showCompraModal\s*\(/);
  assert.match(fn[0], /showProdutoModal\(null,\s*\{\s*origem:\s*ORIGEM_CADASTRO_PRODUTO\.COMPRA/);
});

test('showProdutoModal preserva modal-container quando origem=COMPRA', () => {
  assert.match(produtosJs, /preservarOutrosModais/);
  assert.match(produtosJs, /origemCadastro\s*===\s*['"]COMPRA['"]/);
  assert.match(produtosJs, /\$\(['"]body['"]\)\.append\(modalHtml\)/);
  assert.match(produtosJs, /origemCadastroProduto/);
});

test('Cancelar/Salvar retornam via retornarAoLancamentoCompraAposCadastroProduto', () => {
  assert.match(comprasJs, /function retornarAoLancamentoCompraAposCadastroProduto/);
  assert.match(comprasJs, /function restaurarModalCompraAposCadastroProduto/);
  assert.match(comprasJs, /hidden\.bs\.modal[\s\S]*retornarAoLancamentoCompraAposCadastroProduto/);
});

test('Cancelar não adiciona produto (só restaura)', () => {
  const fn = comprasJs.match(/function retornarAoLancamentoCompraAposCadastroProduto\([\s\S]*?\nfunction /);
  assert.ok(fn);
  assert.match(fn[0], /!salvouOk\s*\|\|\s*!salvo\?\.id/);
  assert.match(fn[0], /return;/);
  assert.match(fn[0], /restaurarModalCompraAposCadastroProduto/);
});

test('Salvar atualiza caches e seleciona produto', () => {
  assert.match(comprasJs, /function upsertProdutoNasListasCompra/);
  assert.match(comprasJs, /function atualizarOpcoesSeletorProdutoCompra/);
  assert.match(comprasJs, /function selecionarProdutoRecemCadastradoNoLancamento/);
  assert.match(comprasJs, /window\.produtosCache/);
  assert.match(comprasJs, /window\.produtosList/);
  assert.match(comprasJs, /\$\(['"]#produto_id_item['"]\)\.val\(String\(produto\.id\)\)/);
});

test('Botão Novo Produto no lançamento aponta para abrirCadastroProdutoDesdeCompra', () => {
  assert.match(comprasJs, /btnNovoProdutoDesdeCompra/);
  assert.match(comprasJs, /onclick="abrirCadastroProdutoDesdeCompra\(\{\s*tipo:\s*['"]form['"]\s*\}\)"/);
});

test('MIIP Novo Produto usa fluxo de retorno COMPRA', () => {
  const fn = comprasJs.match(/function miipNovoProdutoItemCompra\([\s\S]*?\nfunction /);
  assert.ok(fn);
  assert.match(fn[0], /abrirCadastroProdutoDesdeCompra/);
  assert.match(fn[0], /tipo:\s*['"]miip_item['"]/);
  assert.doesNotMatch(fn[0], /showProdutoModal\(null\);/);
});

test('Não recria compra no retorno (sem showCompraModal / limpar itens)', () => {
  const retorno = comprasJs.match(/function retornarAoLancamentoCompraAposCadastroProduto\([\s\S]*?\nfunction /);
  assert.ok(retorno);
  assert.doesNotMatch(retorno[0], /showCompraModal\s*\(/);
  assert.doesNotMatch(retorno[0], /itensCompraAtual\s*=\s*\[\]/);
  assert.doesNotMatch(retorno[0], /loadPage\(\s*['"]produtos['"]/);
});

test('Restauração não chama loadPage produtos', () => {
  const rest = comprasJs.match(/function restaurarModalCompraAposCadastroProduto\([\s\S]*?\nfunction /);
  assert.ok(rest);
  assert.doesNotMatch(rest[0], /loadPage\s*\(/);
  assert.doesNotMatch(rest[0], /showCompraModal\s*\(/);
});

test('Cadastro fora de Compras permanece no modal-container', () => {
  assert.match(produtosJs, /\$\(['"]#modal-container['"]\)\.html\(modalHtml\)/);
  assert.match(produtosJs, /if\s*\(preservarOutrosModais\)/);
});

console.log(`\n--- Resultado: ${ok} OK, ${falhas} falha(s) ---\n`);
process.exit(falhas > 0 ? 1 : 0);
