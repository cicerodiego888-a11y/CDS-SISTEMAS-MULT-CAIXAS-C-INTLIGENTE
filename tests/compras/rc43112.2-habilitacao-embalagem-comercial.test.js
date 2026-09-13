/**
 * RC4.31.12.2 — Habilitação inteligente compra por embalagem comercial
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

console.log('\n=== RC4.31.12.2 — Habilitação Compra por Embalagem ===\n');

test('cadastro — toggle Compra por Embalagem Comercial', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produto-embalagens.js'), 'utf8');
  assert.match(ui, /id="compra_por_embalagem"/);
  assert.match(ui, /Compra por Embalagem Comercial/);
  assert.match(ui, /btnCadastrarEmbalagensCompra/);
  assert.match(ui, /btnAgoraNaoEmbalagensCompra/);
});

test('cadastro — Utilizar na Compra / na Venda por embalagem', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produto-embalagens.js'), 'utf8');
  assert.match(ui, /Utilizar na Compra/);
  assert.match(ui, /Utilizar na Venda/);
  assert.match(ui, /ap-compra/);
  assert.match(ui, /ap-venda/);
});

test('produtos.js persiste compra_por_embalagem', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');
  assert.match(src, /compra_por_embalagem:/);
  assert.match(src, /produtoCadastroUsaCompraPorEmbalagem/);
});

test('resolver — exige compra_por_embalagem=1 para modo comercial', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produto-apresentacao-resolver.js'), 'utf8');
  assert.match(src, /produtoCompraPorEmbalagemAtiva/);
  assert.match(src, /listarEmbalagensVenda/);
});

test('compras — produto OFF não usa painel MUC', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
  assert.match(src, /compra_por_embalagem \|\| 0\) !== 1/);
});

test('compras — bloqueia embalagem desabilitada para compra', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
  assert.match(src, /não está habilitada para utilização em compras/);
});

test('listarEmbalagensCompra filtra compra=1', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produto-apresentacao-resolver.js'), 'utf8');
  assert.match(src, /Number\(e\.compra \?\? 1\) === 1/);
});

test('listarEmbalagensVenda filtra venda=1', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produto-apresentacao-resolver.js'), 'utf8');
  assert.match(src, /Number\(e\.venda \?\? 1\) === 1/);
});

test('schema produtos — compra_por_embalagem default OFF', () => {
  const db = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
  assert.match(db, /compra_por_embalagem INTEGER DEFAULT 0/);
});

test('ProdutoEmbalagemService — auditoria permissões embalagem', () => {
  const svc = fs.readFileSync(
    path.join(ROOT, 'backend/services/produto-embalagem/ProdutoEmbalagemService.js'),
    'utf8'
  );
  assert.match(svc, /registrarAuditoriaPermissoesEmbalagens/);
  assert.match(svc, /\[AUDIT EMBALAGEM\]/);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
