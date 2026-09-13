/**
 * RCM-ATACADO-02 — Precisão decimal no desconto/atacado (sem arredondar antes do total).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Motor = require('../../backend/services/vendas/MotorPrecoAtacado');

function totalErradoArredondandoUnitario(preco, qtd, pct) {
  const precoArred = Math.round(preco * (1 - pct / 100) * 100) / 100;
  return Math.round(precoArred * qtd * 100) / 100;
}

function assertCoerenciaLinha(linha) {
  assert.ok(Math.abs(linha.subtotalBruto - linha.precoOriginal * linha.quantidade) < 0.000001);
  assert.ok(Math.abs(linha.totalInterno - (linha.subtotalBruto - linha.valorDesconto)) < 0.000001);
  assert.ok(Math.abs(linha.total - Motor.arredondarMoeda(linha.totalInterno)) < 0.000001);
  assert.ok(Math.abs(linha.precoUnitarioExibicao - Motor.formatarPrecoExibicao(linha.precoUnitarioInterno)) < 0.000001);
  assert.ok(Math.abs(linha.total - linha.totalInterno) <= 0.01);
}

describe('RCM-ATACADO-02 — casos oficiais', () => {
  it('caso 01 — 0,45 × 100 com 10% → total 40,50', () => {
    const linha = Motor.calcularLinhaDescontoPercentual({
      precoOriginal: 0.45,
      quantidade: 100,
      percentualDesconto: 10
    });
    assert.equal(linha.totalInterno, 40.5);
    assert.equal(linha.total, 40.5);
    assert.equal(linha.precoUnitarioInterno, 0.405);
    assert.equal(linha.precoUnitarioExibicao, 0.41);
    assert.notEqual(totalErradoArredondandoUnitario(0.45, 100, 10), 40.5);
    assertCoerenciaLinha(linha);
  });

  it('caso 02 — 0,45 × 200 com 10% → total 81,00', () => {
    const linha = Motor.calcularLinhaDescontoPercentual({
      precoOriginal: 0.45,
      quantidade: 200,
      percentualDesconto: 10
    });
    assert.equal(linha.totalInterno, 81);
    assert.equal(linha.total, 81);
    assertCoerenciaLinha(linha);
  });

  it('caso 03 — 0,99 × 100 com 15% → total 84,15', () => {
    const linha = Motor.calcularLinhaDescontoPercentual({
      precoOriginal: 0.99,
      quantidade: 100,
      percentualDesconto: 15
    });
    assert.equal(linha.totalInterno, 84.15);
    assert.equal(linha.total, 84.15);
    assertCoerenciaLinha(linha);
  });

  it('caso 04 — 3,79 × 150 com 8% → total 523,02', () => {
    const linha = Motor.calcularLinhaDescontoPercentual({
      precoOriginal: 3.79,
      quantidade: 150,
      percentualDesconto: 8
    });
    assert.equal(linha.totalInterno, 523.02);
    assert.equal(linha.total, 523.02);
    assertCoerenciaLinha(linha);
  });

  it('caso 05 — 0,3333 × 3 sem desconto → motor 0,9999 / exibição 1,00', () => {
    const linha = Motor.calcularSubtotalItem({
      precoUnitarioInterno: 0.3333,
      quantidade: 3
    });
    assert.equal(linha.totalInterno, 0.9999);
    assert.equal(linha.total, 1);
    const unitExib = Motor.formatarPrecoExibicao(0.3333);
    assert.equal(unitExib, 0.33);
  });
});

describe('RCM-ATACADO-02 — auditoria de precisão', () => {
  it('nunca usa preço unitário arredondado antes de multiplicar', () => {
    const linha = Motor.calcularLinhaDescontoPercentual({
      precoOriginal: 0.45,
      quantidade: 100,
      percentualDesconto: 10
    });
    const totalViaUnitArredondado = Motor.arredondarMoeda(linha.precoUnitarioExibicao * linha.quantidade);
    assert.notEqual(totalViaUnitArredondado, linha.totalInterno);
    assert.equal(linha.totalInterno, 40.5);
  });

  it('ordem oficial: subtotal bruto → desconto → total', () => {
    const linha = Motor.calcularLinhaDescontoPercentual({
      precoOriginal: 0.45,
      quantidade: 100,
      percentualDesconto: 10
    });
    assert.equal(linha.subtotalBruto, 45);
    assert.equal(linha.valorDesconto, 4.5);
    assert.equal(linha.totalInterno, 40.5);
  });

  it('desconto em R$ equivale ao percentual correspondente', () => {
    const porPct = Motor.calcularLinhaDescontoPercentual({
      precoOriginal: 10,
      quantidade: 2,
      percentualDesconto: 10
    });
    const porValor = Motor.calcularLinhaDescontoValor({
      precoOriginal: 10,
      quantidade: 2,
      valorDesconto: 2
    });
    assert.equal(porValor.valorDesconto, 2);
    assert.equal(porValor.totalInterno, porPct.totalInterno);
    assert.equal(porValor.total, 18);
  });

  it('faixa atacado usa preço interno sem perda por arredondamento', () => {
    const linha = Motor.calcularLinhaAtacadoFaixa({
      precoVenda: 0.45,
      precoAtacado: 0.405,
      quantidade: 100
    });
    assert.equal(linha.totalInterno, 40.5);
    assert.equal(linha.isAtacado, true);
  });

  it('espelho browser expõe a mesma API', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../frontend/shared/js/motor-preco-atacado.js'),
      'utf8'
    );
    assert.match(src, /calcularLinhaDescontoPercentual/);
    assert.match(src, /calcularLinhaDescontoValor/);
    assert.match(src, /CASAS_INTERNAS\s*=\s*6/);
    assert.match(src, /formatarPrecoExibicao/);
  });

  it('PDV carrega motor antes de pdv.js', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '../../frontend/pdv/index.html'), 'utf8');
    const idxMotor = html.indexOf('motor-preco-atacado.js');
    const idxPdv = html.indexOf('pdv.js');
    assert.ok(idxMotor >= 0);
    assert.ok(idxPdv >= 0);
    assert.ok(idxMotor < idxPdv);
  });
});
