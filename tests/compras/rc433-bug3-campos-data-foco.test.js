/**
 * BUG3 — Campos de data não perdem foco durante a digitação (Compras / Central)
 * Executar: node tests/compras/rc433-bug3-campos-data-foco.test.js
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

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('\n=== BUG3 — Campos de data (foco na edição) ===\n');

test('compras.js: data_vencimento não dispara onchange inline', () => {
  const src = ler('frontend/erp/js/compras.js');
  assert.doesNotMatch(src, /id="data_vencimento"[^>]*onchange=/);
  assert.doesNotMatch(src, /id="data_compra"[^>]*onchange=/);
  assert.doesNotMatch(src, /id="data_emissao"[^>]*onchange=/);
  assert.doesNotMatch(src, /id="data_entrada"[^>]*onchange=/);
});

test('compras.js: parcelas persistem no blur, não re-renderizam a grade inteira', () => {
  const src = ler('frontend/erp/js/compras.js');
  assert.match(src, /vincularEventosDatasCompraModal/);
  assert.match(src, /compraModalDatasEmEdicao/);
  assert.match(src, /agendarRenderItensCompraTabela/);
  assert.match(src, /atualizarResumoValidacaoParcelasCompra/);
  assert.match(src, /\.parcela-vencimento-compra'\)\.off\('blur\.rc850'\)/);
  assert.doesNotMatch(
    src,
    /parcela-vencimento-compra'\)\.off\('change\.rc850'\)\.on\('change\.rc850'[\s\S]*renderizarGradeParcelasCompra\(\)/
  );
});

test('central-entradas.js: filtros de data aplicam no blur, não no change', () => {
  const src = ler('frontend/erp/js/central-entradas.js');
  assert.match(src, /blur\.centralEntradas', '#centralFiltroDataInicio, #centralFiltroDataFim'/);
  assert.doesNotMatch(src, /change\.centralEntradas', '#centralFiltroDataInicio, #centralFiltroDataFim'/);
});

console.log(`\n${ok} ok, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
