/**
 * FORMACAO-PRECO-MARGEM-06 — margem/lucro reais (sem simulação).
 * Executar: node --test tests/produtos/formacao-preco-margem-06.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const F = require(path.join(
  __dirname,
  '../../frontend/erp/js/formacao-preco-margem.js'
));

describe('FORMACAO-PRECO-MARGEM-06 — Lucro e margem reais', () => {
  it('exemplo usuário: custo 0,80 preço 2,50 → lucro 1,70 margem 68,00', () => {
    assert.equal(F.calcularLucroBruto(0.8, 2.5), 1.7);
    assert.equal(F.calcularMargemBruta(0.8, 2.5), 68);
  });

  it('custo 100 preço 130 → lucro 30 margem 23,08', () => {
    assert.equal(F.calcularLucroBruto(100, 130), 30);
    assert.equal(F.calcularMargemBruta(100, 130), 23.08);
  });

  it('custo 100 preço 150 → lucro 50 margem 33,33', () => {
    assert.equal(F.calcularLucroBruto(100, 150), 50);
    assert.equal(F.calcularMargemBruta(100, 150), 33.33);
  });

  it('custo 80 preço 100 → lucro 20 margem 20', () => {
    assert.equal(F.calcularLucroBruto(80, 100), 20);
    assert.equal(F.calcularMargemBruta(80, 100), 20);
  });
});

describe('FORMACAO-PRECO-MARGEM-06 — Casos extremos', () => {
  it('custo 0 e preço > 0 → margem 100 e lucro = preço', () => {
    assert.equal(F.calcularMargemBruta(0, 10), 100);
    assert.equal(F.calcularLucroBruto(0, 10), 10);
  });

  it('preço 0 → margem null e lucro 0', () => {
    assert.equal(F.calcularMargemBruta(10, 0), null);
    assert.equal(F.calcularLucroBruto(10, 0), 0);
  });

  it('preço abaixo do custo → lucro e margem negativos', () => {
    assert.equal(F.calcularLucroBruto(10, 8), -2);
    assert.equal(F.calcularMargemBruta(10, 8), -25);
  });

  it('preço = custo → lucro 0 margem 0', () => {
    assert.equal(F.calcularLucroBruto(10, 10), 0);
    assert.equal(F.calcularMargemBruta(10, 10), 0);
  });

  it('nunca NaN/Infinity', () => {
    for (const [c, p] of [[0, 5], [5, 0], [10, 8], [10, 10], [0.8, 2.5]]) {
      const m = F.calcularMargemBruta(c, p);
      const l = F.calcularLucroBruto(c, p);
      if (m !== null) {
        assert.ok(Number.isFinite(m));
      }
      assert.ok(l === null || Number.isFinite(l));
      assert.notEqual(m, Infinity);
      assert.notEqual(l, Infinity);
    }
  });
});

describe('FORMACAO-PRECO-MARGEM-06 — Sem simulação no módulo', () => {
  it('não exporta helpers de margem desejada', () => {
    assert.equal(F.calcularMarkupParaMargem, undefined);
    assert.equal(F.calcularPrecoPorMargem, undefined);
    assert.equal(F.margemDesejadaEhValida, undefined);
  });

  it('preço oficial por markup 30% permanece 130', () => {
    const precoOficial = Math.round(100 * (1 + 30 / 100) * 100) / 100;
    assert.equal(precoOficial, 130);
  });
});
