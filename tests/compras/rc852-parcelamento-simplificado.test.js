/**
 * RC8.5.2 — Simplificação do parcelamento da compra
 * Executar: node tests/compras/rc852-parcelamento-simplificado.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const Motor = require('../../backend/services/compras/MotorParcelamentoCompra');

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

console.log('\n=== RC8.5.2 — Parcelamento Simplificado ===\n');

test('exemplo 3x / 30 dias a partir de 2026-07-28', () => {
  const g = Motor.gerarGradeParcelas({
    valorTotal: 900,
    quantidadeParcelas: 3,
    diasEntreParcelas: 30,
    primeiroVencimento: '2026-07-28'
  });
  assert.strictEqual(g.parcelas.length, 3);
  assert.strictEqual(g.parcelas[0].vencimento, '2026-07-28');
  assert.strictEqual(g.parcelas[1].vencimento, '2026-08-27');
  assert.strictEqual(g.parcelas[2].vencimento, '2026-09-26');
  assert.strictEqual(g.soma, 900);
});

test('exemplo 5x / 15 dias a partir de 2026-08-10', () => {
  const g = Motor.gerarGradeParcelas({
    valorTotal: 500,
    quantidadeParcelas: 5,
    diasEntreParcelas: 15,
    primeiroVencimento: '2026-08-10'
  });
  assert.strictEqual(g.parcelas.length, 5);
  assert.strictEqual(g.parcelas[0].vencimento, '2026-08-10');
  assert.strictEqual(g.parcelas[1].vencimento, '2026-08-25');
  assert.strictEqual(g.parcelas[2].vencimento, '2026-09-09');
  assert.strictEqual(g.parcelas[3].vencimento, '2026-09-24');
  assert.strictEqual(g.parcelas[4].vencimento, '2026-10-09');
});

test('à vista = 1 parcela / prazo 0', () => {
  const g = Motor.gerarGradeParcelas({
    valorTotal: 150.5,
    quantidadeParcelas: 1,
    diasEntreParcelas: 0,
    primeiroVencimento: '2026-07-28'
  });
  assert.strictEqual(g.parcelas.length, 1);
  assert.strictEqual(g.parcelas[0].vencimento, '2026-07-28');
  assert.strictEqual(g.parcelas[0].valor, 150.5);
});

test('UI compras remove condição e mantém tipo simplificado', () => {
  const src = ler('frontend/erp/js/compras.js');
  assert.doesNotMatch(src, /Condição de Pagamento/);
  assert.doesNotMatch(src, /condicao_pagamento_texto/);
  assert.doesNotMatch(src, /aplicarCondicaoDigitadaCompra/);
  assert.match(src, /Prazo entre Parcelas \(dias\)/);
  assert.match(src, /Primeiro Vencimento/);
  assert.match(src, /Deseja recalcular os vencimentos\?/);
  assert.match(src, /Nenhuma parcela pode ter valor zero/);
  assert.match(src, /prop\('disabled',\s*true\)/);
  // Tipo só À vista / À prazo na tela
  assert.match(src, /<option value="avista">À vista<\/option>/);
  assert.match(src, /<option value="prazo">À prazo<\/option>/);
  assert.doesNotMatch(src, /entrada_parcelado">Entrada/);
});

test('integração Contas a Pagar permanece (criarFinanceiroCompra)', () => {
  const src = ler('backend/rotas/compras.js');
  assert.match(src, /function criarFinanceiroCompra/);
  assert.match(src, /parcelas_detalhe/);
  assert.match(src, /status.*pendente|pendente/);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
