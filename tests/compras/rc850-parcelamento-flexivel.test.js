/**
 * RC8.5.0 — Parcelamento flexível na compra
 * Executar: node tests/compras/rc850-parcelamento-flexivel.test.js
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

console.log('\n=== RC8.5.0 — Parcelamento Flexível ===\n');

test('4 parcelas de R$1000 / 30 dias a partir de 2026-07-28', () => {
  const g = Motor.gerarGradeParcelas({
    valorTotal: 1000,
    quantidadeParcelas: 4,
    diasEntreParcelas: 30,
    primeiroVencimento: '2026-07-28'
  });
  assert.strictEqual(g.parcelas.length, 4);
  assert.strictEqual(g.parcelas[0].vencimento, '2026-07-28');
  assert.strictEqual(g.parcelas[1].vencimento, '2026-08-27');
  assert.strictEqual(g.parcelas[2].vencimento, '2026-09-26');
  assert.strictEqual(g.parcelas[3].vencimento, '2026-10-26');
  assert.strictEqual(g.parcelas[0].valor, 250);
  assert.strictEqual(g.parcelas[3].valor, 250);
  assert.strictEqual(g.soma, 1000);
});

test('resto de centavos na última parcela', () => {
  const g = Motor.gerarGradeParcelas({
    valorTotal: 100,
    quantidadeParcelas: 3,
    diasEntreParcelas: 30,
    primeiroVencimento: '2026-01-01'
  });
  assert.strictEqual(g.parcelas[0].valor, 33.33);
  assert.strictEqual(g.parcelas[1].valor, 33.33);
  assert.strictEqual(g.parcelas[2].valor, 33.34);
  assert.strictEqual(g.soma, 100);
});

test('validação falta / excesso', () => {
  const falta = Motor.validarSomaParcelas(
    [{ valor: 100 }, { valor: 100 }],
    250
  );
  assert.strictEqual(falta.ok, false);
  assert.match(falta.mensagem, /Faltam/);

  const excesso = Motor.validarSomaParcelas(
    [{ valor: 200 }, { valor: 100 }],
    250
  );
  assert.strictEqual(excesso.ok, false);
  assert.match(excesso.mensagem, /Excesso/);

  const okSoma = Motor.validarSomaParcelas(
    [{ valor: 125 }, { valor: 125 }],
    250
  );
  assert.strictEqual(okSoma.ok, true);
});

test('entrada + parcelas', () => {
  const g = Motor.gerarGradeParcelas({
    valorTotal: 1000,
    quantidadeParcelas: 3,
    diasEntreParcelas: 30,
    primeiroVencimento: '2026-07-28',
    valorEntrada: 100
  });
  assert.strictEqual(g.parcelas.length, 4);
  assert.strictEqual(g.parcelas[0].tipo, 'entrada');
  assert.strictEqual(g.parcelas[0].valor, 100);
  assert.strictEqual(g.soma, 1000);
});

test('UI compras tem dias entre parcelas e grade editável', () => {
  const src = ler('frontend/erp/js/compras.js');
  assert.match(src, /dias_entre_parcelas/);
  assert.match(src, /parcelasCompraEditadasManual/);
  assert.match(src, /parcelas_detalhe/);
  assert.match(src, /As parcelas foram alteradas manualmente/);
  assert.match(src, /Faltam:/);
  assert.match(src, /Excesso:/);
});

test('backend cria financeiro a partir da grade', () => {
  const src = ler('backend/rotas/compras.js');
  assert.match(src, /parcelas_detalhe/);
  assert.match(src, /MotorParcelamentoCompra/);
  assert.match(src, /dias_entre_parcelas/);
  // bug fix: condicao gravada no INSERT
  assert.match(src, /condicao,\s*\n\s*forma_pagamento/);
});

test('schema dias_entre_parcelas', () => {
  const src = ler('backend/database.js');
  assert.match(src, /dias_entre_parcelas/);
});

test('MotorParcelamentoCompra exporta API', () => {
  assert.strictEqual(typeof Motor.gerarGradeParcelas, 'function');
  assert.strictEqual(typeof Motor.validarSomaParcelas, 'function');
  assert.strictEqual(typeof Motor.adicionarDias, 'function');
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
