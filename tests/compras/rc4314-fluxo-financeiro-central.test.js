/**
 * RC4.31.14 — Correção definitiva fluxo financeiro Central Inteligente
 * Executar: node tests/compras/rc4314-fluxo-financeiro-central.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const comprasJs = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
const bridgeJs = fs.readFileSync(
  path.join(ROOT, 'backend/motores/central-entradas/services/CentralComprasBridgeService.js'),
  'utf8'
);
const bridgeHelper = fs.readFileSync(
  path.join(ROOT, 'backend/motores/central-entradas/services/centralComprasFinanceiroBridge.js'),
  'utf8'
);
const rotasCompras = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
const { financeiroPayloadCompleto } = require(
  path.join(ROOT, 'backend/motores/central-entradas/services/centralComprasFinanceiroBridge')
);

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

console.log('\n=== RC4.31.14 — Fluxo financeiro Central Inteligente ===\n');

test('ETAPA 1 — renderItensCompraTabelaCore não chama calcularParcelasCompra', () => {
  const fnBody = comprasJs.match(/function renderItensCompraTabelaCore\(\) \{[\s\S]*?\n\}/);
  assert.ok(fnBody, 'renderItensCompraTabelaCore deve existir');
  assert.doesNotMatch(fnBody[0], /calcularParcelasCompra\(\)/);
});

test('ETAPA 2 — flag parcelasImportadasXml independente', () => {
  assert.match(comprasJs, /let parcelasImportadasXml = false/);
  assert.match(comprasJs, /parcelasImportadasXml = true/);
  assert.match(comprasJs, /if \(parcelasImportadasXml\)/);
});

test('ETAPA 2 — gerarGradeParcelasCompraAutomatica bloqueada com XML', () => {
  assert.match(comprasJs, /function gerarGradeParcelasCompraAutomatica\(\) \{[\s\S]*?if \(parcelasImportadasXml\)/);
});

test('ETAPA 3 — bridge só retorna cedo com financeiro completo', () => {
  assert.match(bridgeJs, /financeiroPayloadCompleto\(payload\)/);
  assert.match(bridgeHelper, /function financeiroPayloadCompleto/);
  assert.doesNotMatch(bridgeJs, /gradeComVencimento\) return payload/);
});

test('ETAPA 3 — financeiroPayloadCompleto exige forma e condição', () => {
  assert.strictEqual(financeiroPayloadCompleto({
    forma_pagamento: 'boleto',
    condicao_pagamento: 'avista',
    pagamentos: [{ tPag: '15' }]
  }), true);
  assert.strictEqual(financeiroPayloadCompleto({
    condicao_pagamento: 'prazo',
    parcelas_detalhe: [{ vencimento: '2026-01-10', valor: 100 }]
  }), false);
  assert.strictEqual(financeiroPayloadCompleto({
    forma_pagamento: 'boleto',
    condicao_pagamento: 'prazo',
    pagamentos: [{ tPag: '15' }],
    parcelas_detalhe: [
      { vencimento: '2026-01-10', valor: 100 },
      { vencimento: '2026-02-10', valor: 100 }
    ]
  }), true);
});

test('ETAPA 4 — preencherFormularioCompra carrega financeiro antes dos itens', () => {
  assert.match(comprasJs, /function aplicarFinanceiroImportadoCompra/);
  const fn = comprasJs.match(/function preencherFormularioCompra[\s\S]*?\n\}/);
  assert.ok(fn);
  const idxFin = fn[0].indexOf('aplicarFinanceiroImportadoCompra');
  const idxItens = fn[0].indexOf('renderItensCompraTabela');
  assert.ok(idxFin >= 0 && idxItens >= 0 && idxFin < idxItens);
});

test('ETAPA 5 — saveCompra envia parcelas_detalhe quando grade tem itens', () => {
  assert.match(comprasJs, /parcelas_detalhe: parcelasCompraGrade\.length > 0/);
  assert.match(comprasJs, /parcelas_importadas_xml: parcelasImportadasXml/);
});

test('ETAPA 6 — criarFinanceiroCompra prioriza grade e respeita flag XML', () => {
  assert.match(rotasCompras, /if \(gradeCliente\.length > 0\) \{/);
  assert.match(rotasCompras, /parcelasImportadasXml/);
  assert.match(rotasCompras, /Grade de parcelas importada do XML ausente/);
});

test('ETAPA 7 — MIIP/MUC não disparam calcularParcelas no render core', () => {
  assert.match(comprasJs, /function aplicarMiipImportacaoXml[\s\S]*renderItensCompraTabela\(\)/);
  const core = comprasJs.match(/function renderItensCompraTabelaCore\(\) \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(core, /calcularParcelasCompra/);
});

test('preservação após remover item — sem calcularParcelasCompra', () => {
  const fn = comprasJs.match(/function removerItemCompra[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(fn, /calcularParcelasCompra/);
});

test('recalcularTotaisCompraNota respeita parcelasImportadasXml', () => {
  assert.match(comprasJs, /parcelasImportadasXml \|\| parcelasCompraEditadasManual/);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
