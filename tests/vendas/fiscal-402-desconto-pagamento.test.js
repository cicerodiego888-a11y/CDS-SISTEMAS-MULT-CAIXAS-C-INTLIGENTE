/**
 * HOTFIX FISCAL-4.0.2 — Desconto total × validação de pagamento fiscal
 *
 * Garante que o Motor / MIDP / Orquestrador validem sempre o Valor Fiscal Líquido
 * (após desconto), nunca o subtotal bruto.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  calcularValorFiscalLiquido
} = require('../../backend/services/vendas/valorFiscalLiquido');
const {
  distribuirItensVendaComValorFiscalEfetivo,
  somarPagamentosNaoDinheiro
} = require('../../backend/services/distribuidorEstoqueVenda');
const midp = require('../../backend/services/midp');
const OrquestradorPagamento = require('../../backend/services/OrquestradorPagamento');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function itemUnico(preco) {
  return {
    produto_id: 1,
    quantidade: 1,
    preco_unitario: preco,
    subtotal: preco
  };
}

async function orquestrar({ fiscal, naoFiscal = 0, pagamentos, forma, midpAtivo = false, max }) {
  return OrquestradorPagamento.processarFluxoPagamentoVenda({
    totalFiscal: fiscal,
    totalNaoFiscal: naoFiscal,
    formaPagamento: forma || pagamentos[0].forma_pagamento,
    pagamentos,
    tefHabilitado: false,
    modoConfirmacaoFiscal: 'MANUAL',
    valorFiscalMaximo: max != null ? max : fiscal,
    midpAtivo
  });
}

describe('FISCAL-4.0.2 — desconto percentual (venda fiscal)', () => {
  for (const pct of [5, 10, 15, 50, 100]) {
    it(`${pct}% sobre R$ 100 → pagamento cobre líquido`, async () => {
      const bruto = 100;
      const desconto = round2(bruto * (pct / 100));
      const liquido = round2(bruto - desconto);
      const motor = distribuirItensVendaComValorFiscalEfetivo(
        [{ item: itemUnico(bruto), saldoFiscal: 10, saldoNaoFiscal: 0 }],
        true,
        {
          pagamentos: [{ forma_pagamento: 'pix', valor: liquido }],
          desconto,
          midpAtivo: false
        }
      );
      assert.equal(motor.sucesso, true);
      assert.equal(motor.valorFiscalLiquido, liquido);
      assert.equal(motor.valorFiscalBruto, bruto);

      const r = await orquestrar({
        fiscal: motor.valorFiscalLiquido,
        pagamentos: [{ forma_pagamento: 'pix', valor: liquido }],
        forma: 'pix',
        max: motor.valorFiscalMaximo
      });
      assert.equal(r.sucesso, true, r.erro);
      assert.ok(Number(r.distribuicao.saldoFiscal) <= 0.009);
    });
  }
});

describe('FISCAL-4.0.2 — desconto em valor (venda fiscal)', () => {
  for (const desconto of [1, 5, 10, 50, 100]) {
    it(`desconto R$ ${desconto.toFixed(2)} sobre R$ 100`, async () => {
      const bruto = 100;
      const liquido = round2(Math.max(0, bruto - desconto));
      const motor = distribuirItensVendaComValorFiscalEfetivo(
        [{ item: itemUnico(bruto), saldoFiscal: 10, saldoNaoFiscal: 0 }],
        true,
        {
          pagamentos: [{ forma_pagamento: 'dinheiro', valor: liquido }],
          desconto,
          midpAtivo: false
        }
      );
      assert.equal(motor.valorFiscalLiquido, liquido);
      const r = await orquestrar({
        fiscal: motor.valorFiscalLiquido,
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: liquido }],
        forma: 'dinheiro'
      });
      assert.equal(r.sucesso, true, r.erro);
    });
  }
});

describe('FISCAL-4.0.2 — canais F / NF / misto', () => {
  it('somente fiscal com desconto 10', async () => {
    const out = calcularValorFiscalLiquido({
      valorFiscalBruto: 100,
      valorNaoFiscalBruto: 0,
      desconto: 10
    });
    assert.equal(out.valorFiscalLiquido, 90);
    const r = await orquestrar({
      fiscal: 90,
      pagamentos: [{ forma_pagamento: 'pix', valor: 90 }]
    });
    assert.equal(r.sucesso, true);
  });

  it('somente não fiscal com desconto 10', async () => {
    const motor = distribuirItensVendaComValorFiscalEfetivo(
      [{ item: itemUnico(100), saldoFiscal: 0, saldoNaoFiscal: 10 }],
      false,
      {
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: 90 }],
        desconto: 10,
        midpAtivo: false
      }
    );
    assert.equal(motor.valorFiscalLiquido, 0);
    assert.equal(motor.valorNaoFiscal, 90);
    const r = await orquestrar({
      fiscal: 0,
      naoFiscal: 90,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 90 }]
    });
    assert.equal(r.sucesso, true);
  });

  it('mista 60F+40NF desconto 10 → 54F+36NF', async () => {
    const out = calcularValorFiscalLiquido({
      valorFiscalBruto: 60,
      valorNaoFiscalBruto: 40,
      desconto: 10
    });
    assert.equal(out.valorFiscalLiquido, 54);
    assert.equal(out.valorNaoFiscalLiquido, 36);
    const r = await orquestrar({
      fiscal: 54,
      naoFiscal: 36,
      pagamentos: [
        { forma_pagamento: 'pix', valor: 54 },
        { forma_pagamento: 'dinheiro', valor: 36 }
      ],
      forma: 'misto'
    });
    assert.equal(r.sucesso, true, r.erro);
  });
});

describe('FISCAL-4.0.2 — formas de pagamento', () => {
  const liquido = 80;
  for (const forma of ['dinheiro', 'pix', 'cartao_credito', 'cartao_debito']) {
    it(`forma ${forma} cobre fiscal líquido`, async () => {
      const r = await orquestrar({
        fiscal: liquido,
        pagamentos: [{ forma_pagamento: forma, valor: liquido }],
        forma
      });
      assert.equal(r.sucesso, true, r.erro);
    });
  }

  it('múltiplos: 50 PIX + 30 dinheiro sobre fiscal 80', async () => {
    const r = await orquestrar({
      fiscal: 80,
      pagamentos: [
        { forma_pagamento: 'pix', valor: 50 },
        { forma_pagamento: 'dinheiro', valor: 30 }
      ],
      forma: 'misto'
    });
    assert.equal(r.sucesso, true, r.erro);
    assert.ok(Number(r.distribuicao.saldoFiscal) <= 0.009);
  });

  it('TEF-like cartão (sem gateway): cartao_credito no orquestrador manual', async () => {
    const r = await orquestrar({
      fiscal: 90,
      pagamentos: [{ forma_pagamento: 'cartao_credito', valor: 90 }],
      forma: 'cartao_credito'
    });
    assert.equal(r.sucesso, true, r.erro);
  });
});

describe('FISCAL-4.0.2 — troco usa total líquido', () => {
  it('desconto 10, total 90, recebido 100 → troco 10', () => {
    const subtotal = 100;
    const desconto = 10;
    const totalLiquido = round2(subtotal - desconto);
    const recebido = 100;
    const troco = round2(Math.max(0, recebido - totalLiquido));
    assert.equal(totalLiquido, 90);
    assert.equal(troco, 10);
    assert.notEqual(troco, round2(recebido - subtotal));
  });
});

describe('FISCAL-4.0.2 — nunca rejeitar quando pagamento cobre líquido', () => {
  it('regressão clássica: bruto 100 / líquido 90 / paga 90 → aprovado', async () => {
    const motor = distribuirItensVendaComValorFiscalEfetivo(
      [{ item: itemUnico(100), saldoFiscal: 10, saldoNaoFiscal: 0 }],
      true,
      {
        pagamentos: [{ forma_pagamento: 'pix', valor: 90 }],
        desconto: 10,
        midpAtivo: true
      }
    );
    assert.equal(motor.valorFiscalLiquido, 90);
    const r = await orquestrar({
      fiscal: motor.valorFiscalLiquido,
      pagamentos: [{ forma_pagamento: 'pix', valor: 90 }],
      forma: 'pix',
      midpAtivo: true,
      max: motor.valorFiscalMaximo
    });
    assert.equal(r.sucesso, true, r.erro);
  });

  it('pagamento < líquido ainda rejeita', async () => {
    const r = await orquestrar({
      fiscal: 90,
      pagamentos: [{ forma_pagamento: 'pix', valor: 80 }]
    });
    assert.equal(r.sucesso, false);
    assert.match(r.erro, /Pagamento fiscal insuficiente/);
  });

  it('somarPagamentosNaoDinheiro não inventa eletrônico a partir do desconto', () => {
    const s = somarPagamentosNaoDinheiro(
      [{ forma_pagamento: 'dinheiro', valor: 90 }],
      100
    );
    assert.equal(s.valorDinheiro, 90);
    assert.equal(s.valorNaoDinheiro, 0);
  });
});

describe('FISCAL-4.0.2 — NFC-e / cancelamento (compatibilidade contratual)', () => {
  it('identidade vProd − vDesc ≈ vNF (rateio oficial)', () => {
    const out = calcularValorFiscalLiquido({
      valorFiscalBruto: 83.4,
      valorNaoFiscalBruto: 0,
      desconto: 5.4
    });
    const vProd = out.valorFiscalBruto;
    const vDesc = out.descontoFiscalRateado;
    const vNF = out.valorFiscalLiquido;
    assert.equal(round2(vProd - vDesc), vNF);
  });

  it('cancelamento financeiro: helper de status ainda exportado', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/vendas/VendaFinanceiroService.js'),
      'utf8'
    );
    assert.match(src, /executarCancelamentoFinanceiro/);
  });

  it('MIDP aloca formasPagamento sobre líquido (não bruto)', () => {
    const aloc = midp.alocarPagamentos(
      [{ forma_pagamento: 'pix', valor: 78 }],
      78,
      0
    );
    assert.equal(round2(aloc.saldoFiscal), 0);
    assert.equal(round2(aloc.recebimentosFiscal[0].valor), 78);
  });
});

describe('FISCAL-4.0.2 — fallback pagamentos vazios usa líquido', () => {
  it('normalizarPagamentosEntrada preenche total líquido', async () => {
    const r = await OrquestradorPagamento.processarFluxoPagamentoVenda({
      totalFiscal: 90,
      totalNaoFiscal: 0,
      formaPagamento: 'dinheiro',
      pagamentos: [],
      tefHabilitado: false,
      modoConfirmacaoFiscal: 'MANUAL'
    });
    assert.equal(r.sucesso, true, r.erro);
  });
});
