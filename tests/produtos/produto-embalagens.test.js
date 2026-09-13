/**
 * ProdutoEmbalagem — Apresentações comerciais (1 produto → N embalagens)
 * Executar: node tests/produtos/produto-embalagens.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  normalizarTipoApresentacao,
  tipoParaUnidadeComercial,
  unidadeComercialParaTipo,
  TIPOS_APRESENTACAO
} = require('../../backend/services/produto-embalagem/tiposApresentacao');
const {
  validarListaEmbalagens,
  normalizarEmbalagemInput
} = require('../../backend/services/produto-embalagem/ProdutoEmbalagemService');

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

console.log('\n=== ProdutoEmbalagem — Apresentações ===\n');

test('tipos oficiais incluem UN, CX, FD, PCT, KIT, DISPLAY, SACO, ROLO, BOBINA, BALDE, GALAO', () => {
  ['UN', 'CX', 'FD', 'PCT', 'KIT', 'DISPLAY', 'SACO', 'ROLO', 'BOBINA', 'BALDE', 'GALAO'].forEach((t) => {
    assert.ok(TIPOS_APRESENTACAO.includes(t), `falta tipo ${t}`);
  });
});

test('normalizarTipoApresentacao mapeia legado CAIXA → CX', () => {
  assert.strictEqual(normalizarTipoApresentacao('CAIXA'), 'CX');
  assert.strictEqual(normalizarTipoApresentacao('Galão'), 'GALAO');
});

test('tipoParaUnidadeComercial CX → CAIXA', () => {
  assert.strictEqual(tipoParaUnidadeComercial('CX'), 'CAIXA');
  assert.strictEqual(tipoParaUnidadeComercial('PCT'), 'PACOTE');
});

test('unidadeComercialParaTipo exportada — CAIXA → CX (par inverso)', () => {
  assert.strictEqual(typeof unidadeComercialParaTipo, 'function');
  assert.strictEqual(unidadeComercialParaTipo('CAIXA'), 'CX');
  assert.strictEqual(unidadeComercialParaTipo('PACOTE'), 'PCT');
  assert.strictEqual(unidadeComercialParaTipo('FARDO'), 'FD');
  assert.strictEqual(unidadeComercialParaTipo('CX'), 'CX');
});

test('round-trip tipo ↔ unidade comercial (pares bijetivos)', () => {
  ['CX', 'FD', 'PCT', 'SACO'].forEach((tipo) => {
    assert.strictEqual(unidadeComercialParaTipo(tipoParaUnidadeComercial(tipo)), tipo);
  });
  // KIT → PACOTE (unidade comercial) → PCT (tipo) — mapeamento legado intencional
  assert.strictEqual(tipoParaUnidadeComercial('KIT'), 'PACOTE');
  assert.strictEqual(unidadeComercialParaTipo('PACOTE'), 'PCT');
});

test('produtoEmbalagensSchema carrega sem erro (regressão RC4.31.0)', () => {
  const schema = require('../../backend/services/produto-embalagem/produtoEmbalagensSchema');
  assert.strictEqual(typeof schema.garantirSchemaProdutoEmbalagens, 'function');
  assert.strictEqual(typeof schema.migrarEmbalagensLegadoProdutos, 'function');
});

test('validarListaEmbalagens marca primeira como principal se nenhuma', () => {
  const r = validarListaEmbalagens([
    { tipo: 'PCT', quantidade: 12, compra: 1 }
  ]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.lista[0].principal, 1);
});

test('validarListaEmbalagens exige quantidade para tipo ≠ UN', () => {
  const r = validarListaEmbalagens([
    { tipo: 'CX', quantidade: 0 }
  ]);
  assert.strictEqual(r.ok, false);
});

test('normalizarEmbalagemInput preserva flags compra/venda/estoque', () => {
  const emb = normalizarEmbalagemInput({
    tipo: 'CX',
    quantidade: 6,
    gtin: '789123',
    codigo_fornecedor: 'ABC',
    compra: 1,
    venda: 0,
    estoque: 1,
    principal: 1
  }, 'un');
  assert.strictEqual(emb.tipo, 'CX');
  assert.strictEqual(emb.quantidade, 6);
  assert.strictEqual(emb.gtin, '789123');
  assert.strictEqual(emb.venda, 0);
});

test('schema produto_embalagens existe', () => {
  const src = ler('backend/services/produto-embalagem/produtoEmbalagensSchema.js');
  assert.match(src, /produto_embalagens/);
  assert.match(src, /produto_embalagem_historico/);
  assert.match(src, /migrarEmbalagensLegadoProdutos/);
});

test('database.js garante schema produto_embalagens', () => {
  const src = ler('backend/database.js');
  assert.match(src, /garantirSchemaProdutoEmbalagens/);
});

test('API produtos inclui embalagens no GET completo', () => {
  const src = ler('backend/rotas/produtos.js');
  assert.match(src, /embalagens/);
  assert.match(src, /salvarEmbalagensProduto/);
  assert.match(src, /\/:id\/embalagens/);
});

test('UI cadastro usa painel apresentações (sem compra_por_embalagem fixo)', () => {
  const src = ler('frontend/erp/js/produtos.js');
  assert.match(src, /painel_apresentacoes|ProdutoEmbalagensUI/);
  assert.doesNotMatch(src, /id="compra_por_embalagem"/);
});

test('módulo produto-embalagens.js expõe coletarApresentacoesDoFormulario', () => {
  const src = ler('frontend/erp/js/produto-embalagens.js');
  assert.match(src, /coletarApresentacoesDoFormulario/);
  assert.match(src, /obterApresentacaoCompraProduto/);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
