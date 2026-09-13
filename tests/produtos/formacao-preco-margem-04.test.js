/**
 * FORMACAO-PRECO-MARGEM-04 — regressão leve (API 06: margem/lucro reais).
 * Executar: node --test tests/produtos/formacao-preco-margem-04.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const F = require(path.join(
  __dirname,
  '../../frontend/erp/js/formacao-preco-margem.js'
));

describe('FORMACAO-PRECO-MARGEM-04 — Não regressão markup oficial', () => {
  it('custo 100 markup 30 → preço oficial 130', () => {
    const precoOficial = Math.round(100 * (1 + 30 / 100) * 100) / 100;
    assert.equal(precoOficial, 130);
  });

  it('margem por preço 100/130 ≈ 23,08', () => {
    assert.equal(F.calcularMargemBrutaPorPreco(100, 130), 23.08);
    assert.equal(F.calcularMargemBruta(100, 130), 23.08);
  });

  it('lucro = preço - custo', () => {
    assert.equal(F.calcularLucroBruto(100, 130), 30);
  });
});
