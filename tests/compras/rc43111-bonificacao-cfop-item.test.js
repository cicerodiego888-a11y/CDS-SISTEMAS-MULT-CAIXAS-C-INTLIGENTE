/**
 * RC4.31.11 — Bonificação e CFOP por item
 * Executar: node tests/compras/rc43111-bonificacao-cfop-item.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

const { TIPO_ENTRADA, isBonificacao, resolverPolitica } = require('../../backend/services/compras/PoliticaEntradaCompra');
const { classificarPorCfopItem } = require('../../backend/services/compras/ClassificadorEntradaCompra');
const {
  enriquecerItemFiscalCompra,
  resolverTratamentoFiscalItem,
  isCfopBonificacao,
  classificarTratamentoFiscalItem
} = require('../../backend/services/compras/TratamentoFiscalItemCompra');

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

console.log('\n=== RC4.31.11 — Bonificação e CFOP por item ===\n');

test('PoliticaEntradaCompra — tipo BONIFICACAO existe', () => {
  assert.strictEqual(TIPO_ENTRADA.BONIFICACAO, 'BONIFICACAO');
  assert.strictEqual(isBonificacao('BONIFICACAO'), true);
  const pol = resolverPolitica('BONIFICACAO');
  assert.strictEqual(pol.executarCustoMedio, false);
  assert.strictEqual(pol.executarItensOperacionais, true);
});

test('CFOP 5910 classifica bonificação', () => {
  const r = classificarPorCfopItem('5910');
  assert.strictEqual(r.tipo, TIPO_ENTRADA.BONIFICACAO);
});

test('CFOP 1102 classifica revenda (nota só revenda)', () => {
  const r = classificarPorCfopItem('1102');
  assert.strictEqual(r.tipo, TIPO_ENTRADA.REVENDA);
});

test('CFOP 1556 classifica uso e consumo', () => {
  const r = classificarPorCfopItem('1556');
  assert.strictEqual(r.tipo, TIPO_ENTRADA.USO_CONSUMO);
});

test('isCfopBonificacao — sufixos 910 e 949', () => {
  assert.strictEqual(isCfopBonificacao('5910'), true);
  assert.strictEqual(isCfopBonificacao('1949'), true);
  assert.strictEqual(isCfopBonificacao('1102'), false);
});

test('NF-e mista — cada item mantém tratamento pelo CFOP', () => {
  const itens = [
    { cfop: '1102' },
    { cfop: '5910' },
    { cfop: '1556' }
  ].map((i) => enriquecerItemFiscalCompra(i, { tipoEntradaCompra: TIPO_ENTRADA.REVENDA }));

  assert.strictEqual(itens[0].tipo_fiscal_item, TIPO_ENTRADA.REVENDA);
  assert.strictEqual(itens[0].bonificacao, 0);
  assert.strictEqual(itens[1].tipo_fiscal_item, TIPO_ENTRADA.BONIFICACAO);
  assert.strictEqual(itens[1].bonificacao, 1);
  assert.strictEqual(itens[2].tipo_fiscal_item, TIPO_ENTRADA.USO_CONSUMO);
  assert.strictEqual(itens[2].bonificacao, 0);
});

test('Tipo da compra bonificação não sobrescreve CFOP de revenda', () => {
  const item = enriquecerItemFiscalCompra(
    { cfop: '1102' },
    { tipoEntradaCompra: TIPO_ENTRADA.BONIFICACAO }
  );
  assert.strictEqual(item.tipo_fiscal_item, TIPO_ENTRADA.REVENDA);
  assert.strictEqual(item.bonificacao, 0);
});

test('Alteração manual do tratamento fiscal do item', () => {
  const item = classificarTratamentoFiscalItem({
    cfop: '1102',
    tipo_fiscal_item: TIPO_ENTRADA.BONIFICACAO
  });
  assert.strictEqual(item.tipoFiscal, TIPO_ENTRADA.BONIFICACAO);
  assert.strictEqual(item.bonificacao, true);
  assert.strictEqual(item.origem, 'manual');
});

test('Bonificação — estoque e custo conforme config', () => {
  const cfg = {
    entrada_bonificacao_gerar_estoque: true,
    entrada_bonificacao_atualizar_custo: false
  };
  const trat = resolverTratamentoFiscalItem({ cfop: '5910' }, cfg);
  assert.strictEqual(trat.gerarEstoque, true);
  assert.strictEqual(trat.atualizarCusto, false);
  assert.strictEqual(trat.bonificacao, true);

  const cfgSemEstoque = { entrada_bonificacao_gerar_estoque: false };
  const trat2 = resolverTratamentoFiscalItem({ cfop: '5910' }, cfgSemEstoque);
  assert.strictEqual(trat2.gerarEstoque, false);
});

test('Uso/consumo por item — sem estoque', () => {
  const trat = resolverTratamentoFiscalItem({ cfop: '1556' });
  assert.strictEqual(trat.gerarEstoque, false);
  assert.strictEqual(trat.atualizarCusto, false);
});

test('database — colunas cfop, tipo_fiscal_item, bonificacao em compras_itens', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
  assert.match(src, /compras_itens ADD COLUMN cfop TEXT/);
  assert.match(src, /compras_itens ADD COLUMN tipo_fiscal_item TEXT/);
  assert.match(src, /compras_itens ADD COLUMN bonificacao INTEGER/);
});

test('UI compras — tipo Bonificação e coluna CFOP', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
  assert.match(src, /BONIFICACAO/);
  assert.match(src, /Compra por Bonificação/);
  assert.match(src, /renderCfopColunaItemCompra/);
  assert.match(src, /BONIFICAÇÃO/);
  assert.match(src, /alterarCfopItemCompra/);
  assert.match(src, /alterarTipoFiscalItemCompra/);
});

test('UI config — parametrização bonificação', () => {
  const cfg = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/cds-centro-configuracoes.js'), 'utf8');
  assert.match(cfg, /Entrada por Bonificação/);
  assert.match(cfg, /bonifCfopPadrao/);
  assert.match(cfg, /bonifGerarEstoque/);
});

test('Frontend espelho TratamentoFiscalItemCompra carregado antes de compras', () => {
  const app = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/app.js'), 'utf8');
  const idxTrat = app.indexOf('tratamento-fiscal-item-compra.js');
  const idxCompras = app.indexOf("'/erp/js/compras.js'");
  assert.ok(idxTrat >= 0 && idxCompras > idxTrat, 'tratamento-fiscal-item-compra antes de compras.js');
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
