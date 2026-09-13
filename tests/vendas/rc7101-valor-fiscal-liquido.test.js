/**
 * RC7.10.1 — Valor Fiscal Líquido + MIDP com desconto comercial
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  calcularValorFiscalLiquido,
  ratearAjusteComercialFxNF,
  aplicarValorFiscalLiquidoNosItens
} = require('../../backend/services/vendas/valorFiscalLiquido');
const midp = require('../../backend/services/midp');
const OrquestradorPagamento = require('../../backend/services/OrquestradorPagamento');
const {
  distribuirItensVendaComValorFiscalEfetivo
} = require('../../backend/services/distribuidorEstoqueVenda');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

describe('RC7.10.1 — calcularValorFiscalLiquido (fonte oficial)', () => {
  it('venda sem desconto permanece idêntica', () => {
    const out = calcularValorFiscalLiquido({
      valorFiscalBruto: 83.4,
      valorNaoFiscalBruto: 0,
      desconto: 0,
      acrescimo: 0
    });
    assert.equal(out.valorFiscalLiquido, 83.4);
    assert.equal(out.valorNaoFiscalLiquido, 0);
    assert.equal(out.ajustado, false);
    assert.equal(out.fator, 1);
  });

  it('venda 100% fiscal com desconto → líquido 78,00', () => {
    const out = calcularValorFiscalLiquido({
      valorFiscalBruto: 83.4,
      valorNaoFiscalBruto: 0,
      desconto: 5.4
    });
    assert.equal(out.valorFiscalLiquido, 78);
    assert.equal(out.valorNaoFiscalLiquido, 0);
    assert.equal(out.totalLiquido, 78);
    assert.equal(
      round2(out.valorFiscalBruto - out.descontoFiscalRateado + out.acrescimoFiscalRateado),
      out.valorFiscalLiquido
    );
  });

  it('venda mista 60F+40NF com desconto 10 → 54F + 36NF', () => {
    const out = calcularValorFiscalLiquido({
      valorFiscalBruto: 60,
      valorNaoFiscalBruto: 40,
      desconto: 10
    });
    assert.equal(out.valorFiscalLiquido, 54);
    assert.equal(out.valorNaoFiscalLiquido, 36);
    assert.equal(out.totalLiquido, 90);
  });

  it('venda com acréscimo proporcional', () => {
    const out = calcularValorFiscalLiquido({
      valorFiscalBruto: 80,
      valorNaoFiscalBruto: 20,
      acrescimo: 10
    });
    assert.equal(out.totalLiquido, 110);
    assert.equal(out.valorFiscalLiquido, 88);
    assert.equal(out.valorNaoFiscalLiquido, 22);
  });

  it('ratearAjusteComercialFxNF é o mesmo algoritmo do PDV', () => {
    const a = ratearAjusteComercialFxNF({
      valorFiscalBruto: 83.4,
      valorNaoFiscalBruto: 0,
      desconto: 5.4
    });
    const b = calcularValorFiscalLiquido({
      valorFiscalBruto: 83.4,
      valorNaoFiscalBruto: 0,
      desconto: 5.4
    });
    assert.equal(a.valorFiscalLiquido, b.valorFiscalLiquido);
  });
});

describe('RC7.10.1 — MIDP / Orquestrador com líquido', () => {
  it('pagamento 78 cobre fiscal líquido 78 → saldoFiscal 0', () => {
    const liquido = calcularValorFiscalLiquido({
      valorFiscalBruto: 83.4,
      valorNaoFiscalBruto: 0,
      desconto: 5.4
    });
    const aloc = midp.alocarPagamentos(
      [{ forma_pagamento: 'dinheiro', valor: 78 }],
      liquido.valorFiscalLiquido,
      liquido.valorNaoFiscalLiquido
    );
    assert.equal(round2(aloc.saldoFiscal), 0);
    assert.equal(round2(aloc.recebimentosFiscal[0].valor), 78);
  });

  it('Orquestrador aceita pagamento líquido no caso RC7.10', async () => {
    const resultado = await OrquestradorPagamento.processarFluxoPagamentoVenda({
      totalFiscal: 78,
      totalNaoFiscal: 0,
      formaPagamento: 'dinheiro',
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 78 }],
      tefHabilitado: false,
      modoConfirmacaoFiscal: 'MANUAL',
      valorFiscalMaximo: 78
    });
    assert.equal(resultado.sucesso, true);
    assert.equal(round2(resultado.distribuicao.saldoFiscal), 0);
  });

  it('Orquestrador ainda rejeita se pagamento < líquido', async () => {
    const resultado = await OrquestradorPagamento.processarFluxoPagamentoVenda({
      totalFiscal: 78,
      totalNaoFiscal: 0,
      formaPagamento: 'dinheiro',
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 70 }],
      tefHabilitado: false,
      modoConfirmacaoFiscal: 'MANUAL',
      valorFiscalMaximo: 78
    });
    assert.equal(resultado.sucesso, false);
    assert.match(resultado.erro, /Pagamento fiscal insuficiente/);
  });

  it('venda mista: MIDP valida 54F + 36NF', () => {
    const liquido = calcularValorFiscalLiquido({
      valorFiscalBruto: 60,
      valorNaoFiscalBruto: 40,
      desconto: 10
    });
    const aloc = midp.alocarPagamentos(
      [
        { forma_pagamento: 'pix', valor: 54 },
        { forma_pagamento: 'dinheiro', valor: 36 }
      ],
      liquido.valorFiscalLiquido,
      liquido.valorNaoFiscalLiquido
    );
    assert.equal(round2(aloc.saldoFiscal), 0);
    assert.equal(round2(aloc.saldoNaoFiscal), 0);
  });

  it('pagamento múltiplo PIX + Dinheiro (100% fiscal com desconto)', () => {
    const aloc = midp.alocarPagamentos(
      [
        { forma_pagamento: 'pix', valor: 50 },
        { forma_pagamento: 'dinheiro', valor: 28 }
      ],
      78,
      0
    );
    assert.equal(round2(aloc.saldoFiscal), 0);
    assert.equal(round2(aloc.recebimentosFiscal.reduce((s, r) => s + r.valor, 0)), 78);
  });

  it('pagamento múltiplo Cartão + Dinheiro', () => {
    const aloc = midp.alocarPagamentos(
      [
        { forma_pagamento: 'cartao_credito', valor: 40 },
        { forma_pagamento: 'dinheiro', valor: 38 }
      ],
      78,
      0
    );
    assert.equal(round2(aloc.saldoFiscal), 0);
  });

  it('venda parcialmente paga (saldo fiscal > 0)', () => {
    const aloc = midp.alocarPagamentos(
      [{ forma_pagamento: 'pix', valor: 40 }],
      78,
      0
    );
    assert.ok(aloc.saldoFiscal > 0);
    assert.equal(round2(aloc.saldoFiscal), 38);
  });
});

describe('RC7.10.1 — Motor F×NF integra líquido', () => {
  it('distribuirItensVendaComValorFiscalEfetivo aplica desconto', () => {
    const item = {
      produto_id: 1,
      quantidade: 1,
      preco_unitario: 83.4,
      subtotal: 83.4
    };
    const out = distribuirItensVendaComValorFiscalEfetivo(
      [{ item, saldoFiscal: 100, saldoNaoFiscal: 0 }],
      true,
      { pagamentos: [{ forma_pagamento: 'dinheiro', valor: 78 }], desconto: 5.4, midpAtivo: false }
    );
    assert.equal(out.sucesso, true);
    assert.equal(out.valorFiscalEfetivo, 78);
    assert.equal(out.valorFiscalLiquido, 78);
    assert.equal(out.valorFiscalBruto, 83.4);
    assert.equal(out.valorNaoFiscal, 0);
  });

  it('sem desconto: bruto === líquido (sem regressão)', () => {
    const item = {
      produto_id: 1,
      quantidade: 2,
      preco_unitario: 10,
      subtotal: 20
    };
    const out = distribuirItensVendaComValorFiscalEfetivo(
      [{ item, saldoFiscal: 100, saldoNaoFiscal: 0 }],
      true,
      { pagamentos: [{ forma_pagamento: 'dinheiro', valor: 20 }], desconto: 0, midpAtivo: false }
    );
    assert.equal(out.valorFiscalEfetivo, 20);
    assert.equal(out.valorFiscalBruto, 20);
    assert.equal(out.liquidoComercial.ajustado, false);
  });

  it('aplicarValorFiscalLiquidoNosItens preserva soma', () => {
    const rateio = calcularValorFiscalLiquido({
      valorFiscalBruto: 60,
      valorNaoFiscalBruto: 40,
      desconto: 10
    });
    const itens = aplicarValorFiscalLiquidoNosItens(
      [
        { valor_fiscal: 30, valor_nao_fiscal: 20 },
        { valor_fiscal: 30, valor_nao_fiscal: 20 }
      ],
      rateio
    );
    const somaF = round2(itens.reduce((s, i) => s + i.valor_fiscal, 0));
    const somaNF = round2(itens.reduce((s, i) => s + i.valor_nao_fiscal, 0));
    assert.equal(somaF, 54);
    assert.equal(somaNF, 36);
  });
});
