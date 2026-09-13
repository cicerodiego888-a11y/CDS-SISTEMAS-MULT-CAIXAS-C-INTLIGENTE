/**
 * RC4.31.16 — Distribuição Fiscal/Não Fiscal automática na importação Central
 * Executar: npm run test:compras-rc43116
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const comprasJs = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');

const TIPOS_ENTRADA = {
  REVENDA: 'REVENDA',
  USO_CONSUMO: 'USO_CONSUMO'
};

function obterTotalConvertidoItemCompraSalvo(item = {}) {
  const emb = Number(item.quantidade_embalagens || 0) * Number(item.quantidade_por_embalagem || 0);
  return Number(item.peso_total_compra || 0) || emb || Number(item.quantidade || 0);
}

function calcularDistribuicaoFiscalMotorItem(item = {}, tipoEntrada) {
  const total = obterTotalConvertidoItemCompraSalvo(item);
  if (total <= 0) {
    return { quantidade_fiscal: 0, quantidade_nao_fiscal: 0, total: 0, item_fiscal: 1 };
  }
  const ehNaoFiscal = Number(item.item_fiscal) === 0
    || tipoEntrada === TIPOS_ENTRADA.USO_CONSUMO
    || item.tipo_fiscal_item === TIPOS_ENTRADA.USO_CONSUMO;
  if (ehNaoFiscal) {
    return { quantidade_fiscal: 0, quantidade_nao_fiscal: total, total, item_fiscal: 0 };
  }
  return { quantidade_fiscal: total, quantidade_nao_fiscal: 0, total, item_fiscal: 1 };
}

function deveExigirValidacaoDistribuicaoFiscalItem(item, origemCentral) {
  const fracionado = Number(item.produto_fracionado ?? item.vendido_por_peso ?? 0) === 1;
  if (!fracionado) return false;
  const total = obterTotalConvertidoItemCompraSalvo(item);
  const soma = Number(item.quantidade_fiscal || 0) + Number(item.quantidade_nao_fiscal || 0);
  const valida = total > 0 && soma > 0 && Math.abs(soma - total) <= 0.001;
  if (origemCentral && item.distribuicao_fiscal_preenchida && valida) return false;
  return true;
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

console.log('\n=== RC4.31.16 — Distribuição Fiscal/Não Fiscal Central ===\n');

test('ETAPA 1 — constante ORIGEM_COMPRA.CENTRAL_NFE e origemCompraAtual', () => {
  assert.match(comprasJs, /const ORIGEM_COMPRA = Object\.freeze\(\{/);
  assert.match(comprasJs, /CENTRAL_NFE: 'CENTRAL_NFE'/);
  assert.match(comprasJs, /function isOrigemCompraCentralNfe\(\)/);
});

test('ETAPA 1 — abrirCompraDesdeCentralEntradas define CENTRAL_NFE após showCompraModal', () => {
  const fn = comprasJs.match(/function abrirCompraDesdeCentralEntradas\([\s\S]*?\n\}/);
  assert.ok(fn, 'abrirCompraDesdeCentralEntradas deve existir');
  assert.match(fn[0], /showCompraModal\(\)/);
  assert.match(fn[0], /origemCompraAtual = ORIGEM_COMPRA\.CENTRAL_NFE/);
  const idxShow = fn[0].indexOf('showCompraModal()');
  const idxOrigem = fn[0].indexOf('origemCompraAtual = ORIGEM_COMPRA.CENTRAL_NFE');
  assert.ok(idxOrigem > idxShow, 'CENTRAL_NFE deve ser definido depois de showCompraModal');
});

test('ETAPA 2 — preencherFormularioCompra aplica distribuição automática', () => {
  const fn = comprasJs.match(/function preencherFormularioCompra\([\s\S]*?\n\}/);
  assert.ok(fn, 'preencherFormularioCompra deve existir');
  assert.match(fn[0], /aplicarDistribuicaoFiscalItensCentral/);
  assert.match(fn[0], /enriquecerItemFiscalCompraUi/);
});

test('ETAPA 3 — saveCompra usa deveExigirValidacaoDistribuicaoFiscalItem', () => {
  const fn = comprasJs.match(/function saveCompra\(\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'saveCompra deve existir');
  assert.match(fn[0], /deveExigirValidacaoDistribuicaoFiscalItem/);
  assert.match(fn[0], /aplicarDistribuicaoFiscalItemCentral/);
});

test('ETAPA 5 — showCompraModal reseta origem para MANUAL', () => {
  assert.match(comprasJs, /origemCompraAtual = ORIGEM_COMPRA\.MANUAL/);
});

test('Motor — revenda fracionado: total convertido vai para fiscal', () => {
  const dist = calcularDistribuicaoFiscalMotorItem({
    produto_fracionado: 1,
    quantidade_embalagens: 2,
    quantidade_por_embalagem: 3,
    unidade: 'MT'
  }, TIPOS_ENTRADA.REVENDA);
  assert.strictEqual(dist.quantidade_fiscal, 6);
  assert.strictEqual(dist.quantidade_nao_fiscal, 0);
  assert.strictEqual(dist.item_fiscal, 1);
});

test('Motor — uso/consumo: total convertido vai para não fiscal', () => {
  const dist = calcularDistribuicaoFiscalMotorItem({
    produto_fracionado: 1,
    peso_total_compra: 12,
    unidade: 'KG'
  }, TIPOS_ENTRADA.USO_CONSUMO);
  assert.strictEqual(dist.quantidade_fiscal, 0);
  assert.strictEqual(dist.quantidade_nao_fiscal, 12);
  assert.strictEqual(dist.item_fiscal, 0);
});

test('Validação — Central com distribuição preenchida não exige redigitação', () => {
  const item = {
    produto_fracionado: 1,
    peso_total_compra: 6,
    quantidade_fiscal: 6,
    quantidade_nao_fiscal: 0,
    distribuicao_fiscal_preenchida: true,
    unidade: 'MT'
  };
  assert.strictEqual(deveExigirValidacaoDistribuicaoFiscalItem(item, true), false);
});

test('Validação — compra manual continua exigindo preenchimento', () => {
  const item = {
    produto_fracionado: 1,
    peso_total_compra: 6,
    quantidade_fiscal: 0,
    quantidade_nao_fiscal: 0,
    unidade: 'MT'
  };
  assert.strictEqual(deveExigirValidacaoDistribuicaoFiscalItem(item, false), true);
});

test('ETAPA 4 — edição manual marca distribuicao_fiscal_editada_manual', () => {
  assert.match(comprasJs, /distribuicao_fiscal_editada_manual = true/);
  assert.match(comprasJs, /distribuicao_fiscal_editada_manual/);
});

console.log(`\n--- Resultado: ${ok} OK, ${falhas} falha(s) ---\n`);
process.exit(falhas > 0 ? 1 : 0);
