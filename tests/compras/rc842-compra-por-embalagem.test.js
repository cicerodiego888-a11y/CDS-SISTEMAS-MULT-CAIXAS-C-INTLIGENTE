/**
 * RC8.4.2 — Modo "Produto comprado por embalagem" (opt-in)
 * Executar: node tests/compras/rc842-compra-por-embalagem.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const MotorUM = require('../../backend/services/unidades/MotorUnidadesMedida');

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

console.log('\n=== RC8.4.2 — Compra por Embalagem ===\n');

test('produtoUsaCompraPorEmbalagem false por padrão', () => {
  assert.strictEqual(MotorUM.produtoUsaCompraPorEmbalagem({}), false);
  assert.strictEqual(MotorUM.produtoUsaCompraPorEmbalagem({ compra_por_embalagem: 0 }), false);
});

test('produtoUsaCompraPorEmbalagem true quando flag=1', () => {
  assert.strictEqual(MotorUM.produtoUsaCompraPorEmbalagem({ compra_por_embalagem: 1 }), true);
});

test('Fórmula: R$40 ÷ 12 = R$3,3333 custo unitário', () => {
  const r = MotorUM.calcularFormacaoPrecoCadastro({
    compraPorEmbalagem: true,
    unidadeComercial: 'PACOTE',
    quantidadePorEmbalagem: 12,
    valorEmbalagemCompra: 40,
    margemPercentual: 50,
    origem: 'embalagem'
  });
  assert.strictEqual(r.custoUnitario, 3.3333);
  assert.strictEqual(r.precoVendaUnitario, 5);
  assert.strictEqual(r.valorEmbalagemVenda, 60);
  assert.strictEqual(r.valorEmbalagemCompra, 40);
});

test('Preço unitário = custo + lucro (50%)', () => {
  const r = MotorUM.calcularFormacaoPrecoCadastro({
    compra_por_embalagem: 1,
    quantidade_por_embalagem: 12,
    valor_compra_embalagem: 40,
    lucro_percentual: 50,
    origem: 'margem'
  });
  assert.strictEqual(r.precoVendaUnitario, 5);
});

test('Valor venda embalagem = preço × qtd', () => {
  const r = MotorUM.calcularFormacaoPrecoCadastro({
    compraPorEmbalagem: true,
    quantidadePorEmbalagem: 12,
    valorEmbalagemCompra: 40,
    margemPercentual: 50
  });
  assert.strictEqual(r.valorEmbalagemVenda, 60);
});

test('Compra: 10 pacotes × 12 = 120 UN estoque', () => {
  const r = MotorUM.calcularCompraEmbalagem({
    quantidadeEmbalagens: 10,
    quantidadePorEmbalagem: 12,
    valorTotalEmbalagem: 400,
    margemPercentual: 50
  });
  assert.strictEqual(r.quantidadeEstoque, 120);
  assert.strictEqual(r.custoUnitario, 3.3333);
  assert.strictEqual(r.precoVendaUnitario, 5);
});

test('Sem flag: formação usa custo unitário informado (compat)', () => {
  const r = MotorUM.calcularFormacaoPrecoCadastro({
    compraPorEmbalagem: false,
    custoUnitario: 10,
    margemPercentual: 50,
    origem: 'custo'
  });
  assert.strictEqual(r.custoUnitario, 10);
  assert.strictEqual(r.precoVendaUnitario, 15);
  assert.strictEqual(r.quantidadePorEmbalagem, 1);
});

test('schema produtos tem compra_por_embalagem e valor_compra_embalagem', () => {
  const src = ler('backend/database.js');
  assert.match(src, /compra_por_embalagem/);
  assert.match(src, /valor_compra_embalagem/);
});

test('UI cadastro usa apresentações comerciais (substitui checkbox fixo)', () => {
  const src = ler('frontend/erp/js/produtos.js');
  assert.match(src, /ProdutoEmbalagensUI|painel_apresentacoes/);
  assert.doesNotMatch(src, /id="compra_por_embalagem"/);
  const mod = ler('frontend/erp/js/produto-embalagens.js');
  assert.match(mod, /tabelaApresentacoes/);
  assert.match(mod, /coletarApresentacoesDoFormulario/);
});

test('saveProduto persiste embalagens via API', () => {
  const src = ler('frontend/erp/js/produtos.js');
  assert.match(src, /data\.embalagens/);
  assert.match(src, /coletarApresentacoesDoFormulario/);
});

test('API lista COALESCE compra_por_embalagem', () => {
  const src = ler('backend/rotas/produtos.js');
  assert.match(src, /compra_por_embalagem/);
  assert.match(src, /valor_compra_embalagem/);
});

test('Compras exige embalagem opt-in ou legado', () => {
  const src = ler('frontend/erp/js/compras.js');
  assert.match(src, /compra_por_embalagem/);
  assert.match(src, /produtoUsaEmbalagemComercialCompra/);
});

test('Motor cliente espelha compraPorEmbalagem', () => {
  const src = ler('frontend/erp/js/motor-unidades-medida.js');
  assert.match(src, /compraPorEmbalagem/);
  assert.match(src, /valor_compra_embalagem/);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
