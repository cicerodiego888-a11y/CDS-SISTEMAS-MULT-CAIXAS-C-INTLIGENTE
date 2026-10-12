'use strict';

/**
 * Microsprint 2 — pré-cálculo fiscal A/B do Motor (backend/services/distribuidorEstoqueVenda.js).
 * Itens no formato real do payload do PDV (sem unidade; preço interno de 6 casas).
 */

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  distribuirItensVendaComValorFiscalEfetivo,
  calcularValoresFiscaisItem
} = require('../../backend/services/distribuidorEstoqueVenda');

const centavos = (v) => Math.round(Number(v) * 100);

function preCalcular(itens, { desconto = 0, acrescimo = 0, saldoFiscal = 1000, saldoNaoFiscal = 0, total } = {}) {
  const entradas = itens.map((item) => ({
    item, saldoFiscal, saldoNaoFiscal, controlaEstoque: true, itemFiscal: 0
  }));
  return distribuirItensVendaComValorFiscalEfetivo(entradas, true, {
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: total }],
    midpAtivo: false,
    desconto,
    acrescimo
  });
}

function assertCoerente(r, total, rotulo) {
  assert.equal(r.sucesso, true, rotulo);
  assert.equal(centavos(r.valorFiscalEfetivo) + centavos(r.valorNaoFiscal), centavos(total), `${rotulo}: A + B = total`);
  assert.ok(r.valorFiscalEfetivo >= 0 && r.valorNaoFiscal >= 0, `${rotulo}: sem negativos`);
  for (const it of r.itens) {
    assert.ok(it.valor_fiscal >= 0 && it.valor_nao_fiscal >= 0, `${rotulo}: item sem negativos`);
    if (it.quantidade_nao_fiscal <= 1e-9) assert.equal(it.valor_nao_fiscal, 0, `${rotulo}: B sem quantidade`);
    if (it.quantidade_fiscal <= 1e-9) assert.equal(it.valor_fiscal, 0, `${rotulo}: A sem quantidade`);
  }
}

/** Item de etiqueta de valor como o PDV envia: preço/kg impresso + preço interno = valor ÷ quantidade. */
function itemEtiqueta(valor, quantidade, precoKg = 39.9) {
  return {
    produto_id: 9106,
    quantidade,
    preco_unitario: precoKg,
    preco_unitario_interno: Number((valor / quantidade).toFixed(6)),
    subtotal: valor
  };
}

const KG_10567 = { produto_id: 9102, quantidade: 10.567, preco_unitario: 12.99, preco_unitario_interno: 12.99, subtotal: 137.27 };

describe('Microsprint 2 — pré-cálculo fiscal A/B', () => {
  it('1. etiqueta de valor 7,77 (0,195 kg × 39,90): A = 7,77 e B = 0', () => {
    const r = preCalcular([itemEtiqueta(7.77, 0.195)], { total: 7.77 });
    assert.equal(r.valorFiscalEfetivo, 7.77);
    assert.equal(r.valorNaoFiscal, 0);
    assertCoerente(r, 7.77, 'etiqueta 7,77');
  });

  it('1b. etiqueta de valor 1,87 (0,047 kg × 39,90): A = 1,87 e B = 0', () => {
    const r = preCalcular([itemEtiqueta(1.87, 0.047)], { total: 1.87 });
    assert.equal(r.valorFiscalEfetivo, 1.87);
    assert.equal(r.valorNaoFiscal, 0);
    assertCoerente(r, 1.87, 'etiqueta 1,87');
  });

  it('2. desconto global R$ 0,50 sobre 137,27: pré-cálculo devolve 136,77', () => {
    const r = preCalcular([KG_10567], { desconto: 0.5, total: 136.77 });
    assert.equal(r.valorFiscalEfetivo, 136.77);
    assert.equal(r.valorNaoFiscal, 0);
    assert.equal(r.totalVenda, 136.77);
    assertCoerente(r, 136.77, 'desconto 0,50');
  });

  it('2b. desconto global com estoque fiscal parcial (integridade de quantidades ativa)', () => {
    const r = preCalcular([KG_10567], { desconto: 0.5, total: 136.77, saldoFiscal: 4.333, saldoNaoFiscal: 100 });
    assert.equal(r.totalVenda, 136.77);
    assertCoerente(r, 136.77, 'desconto + estoque parcial');
  });

  it('2c. desconto global em itens UN com estoque fiscal parcial', () => {
    const un = { produto_id: 1, quantidade: 5, preco_unitario: 7.99, preco_unitario_interno: 7.99, subtotal: 39.95 };
    const r = preCalcular([un], { desconto: 1.5, total: 38.45, saldoFiscal: 3, saldoNaoFiscal: 10 });
    assert.equal(r.totalVenda, 38.45);
    assertCoerente(r, 38.45, 'UN + desconto');
    for (const it of r.itens) assert.equal(it.quantidade_fiscal, Math.round(it.quantidade_fiscal), 'UN inteiro');
  });

  it('3/4. etiquetas de R$ 1,00 a R$ 100,00 (4 preços/kg): A + B = valor, sem negativos', () => {
    for (const precoKg of [39.9, 12.99, 59.9, 8.49]) {
      for (let c = 100; c <= 10000; c += 7) {
        const valor = c / 100;
        const quantidade = Number((valor / precoKg).toFixed(3));
        if (!(quantidade > 0)) continue;
        const r = preCalcular([itemEtiqueta(valor, quantidade, precoKg)], { total: valor });
        assertCoerente(r, valor, `etiqueta ${valor} @ ${precoKg}`);
      }
    }
  });

  it('3/4. partilha por item com quantidade fiscal parcial: A + B = linha, sem negativos', () => {
    let semente = 4242;
    const aleatorio = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
    for (let n = 0; n < 3000; n += 1) {
      const quantidade = (10 + Math.floor(aleatorio() * 20000)) / 1000;
      const subtotal = Number((quantidade * 12.99).toFixed(2));
      const item = { quantidade, preco_unitario: 12.99, preco_unitario_interno: 12.99, subtotal };
      const qF = Number((Math.floor(aleatorio() * (quantidade * 1000 + 1)) / 1000).toFixed(3));
      const qNf = Number((quantidade - qF).toFixed(3));
      const r = calcularValoresFiscaisItem(item, qF, qNf);
      assert.equal(centavos(r.valorFiscal) + centavos(r.valorNaoFiscal), centavos(subtotal), `q=${quantidade} qF=${qF}`);
      assert.ok(r.valorFiscal >= 0 && r.valorNaoFiscal >= 0);
      if (qNf <= 0) assert.equal(r.valorNaoFiscal, 0);
      if (qF <= 0) assert.equal(r.valorFiscal, 0);
    }
  });

  it('subtotal que não reproduz quantidade × preço interno é ignorado (vale quantidade × preço)', () => {
    const adulterado = { ...itemEtiqueta(7.77, 0.195), subtotal: 7.5 };
    const r = calcularValoresFiscaisItem(adulterado, 0.195, 0);
    assert.equal(r.subtotalVenda, 7.78);
    const semInterno = { quantidade: 0.195, preco_unitario: 39.9, subtotal: 7.77 };
    assert.equal(calcularValoresFiscaisItem(semInterno, 0.195, 0).valorFiscal, 7.78);
  });

  it('venda sem desconto e sem etiqueta: valores inalterados', () => {
    const r = preCalcular([KG_10567], { total: 137.27 });
    assert.equal(r.valorFiscalEfetivo, 137.27);
    assert.equal(r.valorNaoFiscal, 0);
    assert.equal(r.itens[0].quantidade_fiscal, 10.567);
  });
});
