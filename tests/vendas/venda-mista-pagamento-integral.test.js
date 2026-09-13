/**
 * Sprint — venda mista com pagamento integral (anti-regressão #25).
 * Executar: node --test tests/vendas/venda-mista-pagamento-integral.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Orquestrador = require('../../backend/services/OrquestradorPagamento');
const {
  aplicarRegraStatusPagamentoVenda,
  calcularSaldoNaoFiscal,
  linhasPagamentoPersistencia,
  resolverStatusPagamentoVenda
} = require('../../backend/services/vendas/VendaPagamentoService');
const { somarPorGrupo, GRUPO_A, GRUPO_B } = require('../../backend/services/vendas/recebimentoPagamento');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function sumTipo(recebimentos, tipo) {
  return round2(
    (recebimentos || [])
      .filter((r) => String(r.tipo_recebimento).toLowerCase() === tipo)
      .reduce((s, r) => s + Number(r.valor || 0), 0)
  );
}

function sumForma(recebimentos, forma) {
  return round2(
    (recebimentos || [])
      .filter((r) => String(r.forma_pagamento).toLowerCase() === forma)
      .reduce((s, r) => s + Number(r.valor || 0), 0)
  );
}

async function orquestrar({ fiscal, naoFiscal, pagamentos, forma }) {
  return Orquestrador.processarFluxoPagamentoVenda({
    totalFiscal: fiscal,
    totalNaoFiscal: naoFiscal,
    formaPagamento: forma || (pagamentos[0] && pagamentos[0].forma_pagamento) || 'dinheiro',
    pagamentos,
    tefHabilitado: false,
    modoConfirmacaoFiscal: 'MANUAL',
    midpAtivo: false
  });
}

describe('Venda mista — pagamento integral (anti #25)', () => {
  it('TESTE 1 — 100% fiscal quitada', async () => {
    const r = await orquestrar({
      fiscal: 10,
      naoFiscal: 0,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 10 }]
    });
    assert.equal(r.sucesso, true, r.erro);
    assert.equal(r.statusPagamento, 'quitada');
    assert.equal(sumTipo(r.recebimentos, 'fiscal'), 10);
    assert.equal(sumTipo(r.recebimentos, 'nao_fiscal'), 0);
  });

  it('TESTE 2 — 100% não fiscal quitada', async () => {
    const r = await orquestrar({
      fiscal: 0,
      naoFiscal: 10,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 10 }]
    });
    assert.equal(r.sucesso, true, r.erro);
    assert.equal(r.statusPagamento, 'quitada');
    assert.equal(sumTipo(r.recebimentos, 'fiscal'), 0);
    assert.equal(sumTipo(r.recebimentos, 'nao_fiscal'), 10);
  });

  it('TESTE 3 — mista integral (padrão #25) dinheiro 27,44 → quitada', async () => {
    const r = await orquestrar({
      fiscal: 4,
      naoFiscal: 23.44,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 27.44 }]
    });
    assert.equal(r.sucesso, true, r.erro);
    assert.equal(r.statusPagamento, 'quitada');
    assert.notEqual(r.statusPagamento, 'aguardando_nao_fiscal');
    assert.equal(sumTipo(r.recebimentos, 'fiscal'), 4);
    assert.equal(sumTipo(r.recebimentos, 'nao_fiscal'), 23.44);
    assert.equal(round2(sumTipo(r.recebimentos, 'fiscal') + sumTipo(r.recebimentos, 'nao_fiscal')), 27.44);
    assert.equal(r.pagamentoIntegralConfirmado, true);

    const aplicado = aplicarRegraStatusPagamentoVenda({
      valorFiscal: 4,
      valorNaoFiscal: 23.44,
      statusPagamento: r.statusPagamento,
      recebimentos: r.recebimentos
    });
    assert.equal(aplicado.statusPagamento, 'quitada');
    assert.equal(aplicado.recebimentos.filter((x) => x.tipo_recebimento === 'nao_fiscal').length, 1);
  });

  it('TESTE 4 — mista PIX 100 (60+40) quitada', async () => {
    const r = await orquestrar({
      fiscal: 60,
      naoFiscal: 40,
      pagamentos: [{ forma_pagamento: 'pix', valor: 100 }]
    });
    assert.equal(r.sucesso, true, r.erro);
    assert.equal(r.statusPagamento, 'quitada');
    assert.equal(sumTipo(r.recebimentos, 'fiscal'), 60);
    assert.equal(sumTipo(r.recebimentos, 'nao_fiscal'), 40);
  });

  it('TESTE 5 — mista dinheiro 100 (60+40) quitada', async () => {
    const r = await orquestrar({
      fiscal: 60,
      naoFiscal: 40,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100 }]
    });
    assert.equal(r.sucesso, true, r.erro);
    assert.equal(r.statusPagamento, 'quitada');
    assert.equal(sumTipo(r.recebimentos, 'fiscal'), 60);
    assert.equal(sumTipo(r.recebimentos, 'nao_fiscal'), 40);
  });

  it('TESTE 6 — mista PIX 50 + dinheiro 50', async () => {
    const r = await orquestrar({
      fiscal: 60,
      naoFiscal: 40,
      pagamentos: [
        { forma_pagamento: 'pix', valor: 50 },
        { forma_pagamento: 'dinheiro', valor: 50 }
      ],
      forma: 'misto'
    });
    assert.equal(r.sucesso, true, r.erro);
    assert.equal(r.statusPagamento, 'quitada');
    assert.equal(sumTipo(r.recebimentos, 'fiscal'), 60);
    assert.equal(sumTipo(r.recebimentos, 'nao_fiscal'), 40);
    assert.equal(sumForma(r.recebimentos, 'pix'), 50);
    assert.equal(sumForma(r.recebimentos, 'dinheiro'), 50);
  });

  it('TESTE 7 — pagamento incompleto não quita', async () => {
    const r = await orquestrar({
      fiscal: 60,
      naoFiscal: 40,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 80 }]
    });
    assert.equal(r.sucesso, true, r.erro);
    assert.equal(r.statusPagamento, 'aguardando_nao_fiscal');
    assert.equal(sumTipo(r.recebimentos, 'fiscal'), 60);
    assert.equal(sumTipo(r.recebimentos, 'nao_fiscal'), 0);
    assert.equal(r.pagamentoIntegralConfirmado, false);
  });

  it('TESTE 8 — segunda etapa legítima (só fiscal no 1º passo)', async () => {
    const r = await orquestrar({
      fiscal: 60,
      naoFiscal: 40,
      pagamentos: [{ forma_pagamento: 'pix', valor: 60 }]
    });
    assert.equal(r.sucesso, true, r.erro);
    assert.equal(r.statusPagamento, 'aguardando_nao_fiscal');
    assert.equal(sumTipo(r.recebimentos, 'fiscal'), 60);
    assert.equal(sumTipo(r.recebimentos, 'nao_fiscal'), 0);

    // 2ª etapa via regra de status (endpoint)
    const aposNf = resolverStatusPagamentoVenda(
      40,
      [{ valor: 40 }],
      'quitada',
      { valorFiscal: 60 }
    );
    assert.equal(aposNf, 'quitada');
  });

  it('TESTE 9 — idempotência saldo NF já coberto', () => {
    const saldo = calcularSaldoNaoFiscal(
      { valor_nao_fiscal: 23.44 },
      [{ tipo_recebimento: 'nao_fiscal', valor: 23.44 }]
    );
    assert.equal(saldo.saldoPendente, 0);

    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/vendas/VendaPagamentoService.js'),
      'utf8'
    );
    assert.match(src, /idempotente:\s*true/);
  });

  it('TESTE 10 — retry frontend não reabre 2ª etapa se quitada', () => {
    const pdv = fs.readFileSync(
      path.join(__dirname, '../../frontend/pdv/js/pdv.js'),
      'utf8'
    );
    assert.match(pdv, /timeout:\s*120000/);
    assert.match(pdv, /statusPagamento === 'aguardando_nao_fiscal'/);
    assert.match(pdv, /NÃO abre modal de não fiscal/);
    assert.match(pdv, /vendaEmProcessamento = false/);
  });

  it('TESTE 10b — PDV não recorta pagamento misto só para o fiscal', () => {
    const pdv = fs.readFileSync(
      path.join(__dirname, '../../frontend/pdv/js/pdv.js'),
      'utf8'
    );
    assert.match(pdv, /function pdvVendaMistaFiscalNaoFiscal/);
    assert.match(pdv, /function anexarTefAoPrimeiroPagamento/);
    assert.match(pdv, /MIDP separa F\/NF a partir do pagamento comercial integral/);
    assert.match(pdv, /Pagamento único \(PIX\/dinheiro\/cartão\) cobre F\+NF — MIDP separa/);
  });

  it('TESTE 11 — entrega mista integral (padrão #25) via Orquestrador', async () => {
    const r = await orquestrar({
      fiscal: 4,
      naoFiscal: 23.44,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 27.44 }],
      forma: 'dinheiro'
    });
    assert.equal(r.statusPagamento, 'quitada');
    assert.equal(r.proximaAcao, 'emitir_nfce');
    assert.equal(r.recebimentos.length, 2);

    const motorSrc = fs.readFileSync(
      path.join(__dirname, '../../backend/services/entrega/MotorFinalizacaoVenda.js'),
      'utf8'
    );
    assert.match(motorSrc, /PAGAMENTO_INTEGRAL_INCONSISTENTE/);
  });

  it('TESTE 12 — quitada não bloqueia NFC-e por aguardando_nao_fiscal', async () => {
    const r = await orquestrar({
      fiscal: 4,
      naoFiscal: 23.44,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 27.44 }]
    });
    assert.equal(r.statusPagamento, 'quitada');
    assert.notEqual(r.statusPagamento, 'aguardando_nao_fiscal');
    assert.equal(r.proximaAcao, 'emitir_nfce');
  });

  it('TESTE 13 — venda_pagamentos persiste split F/NF (não o PIX comercial único)', async () => {
    const r = await orquestrar({
      fiscal: 2.35,
      naoFiscal: 2.35,
      pagamentos: [{ forma_pagamento: 'pix', valor: 4.7 }]
    });
    assert.equal(r.sucesso, true, r.erro);
    const linhas = linhasPagamentoPersistencia(
      [{ forma_pagamento: 'pix', valor: 4.7 }],
      r.recebimentos,
      'pix',
      4.7,
      null
    );
    assert.equal(linhas.length, 2);
    assert.equal(somarPorGrupo(linhas, GRUPO_A), 2.35);
    assert.equal(somarPorGrupo(linhas, GRUPO_B), 2.35);
    assert.equal(linhas[0].tipo_recebimento, 'A');
    assert.equal(linhas[1].tipo_recebimento, 'B');
  });

  it('isPagamentoIntegralConfirmado — helper', () => {
    assert.equal(Orquestrador.isPagamentoIntegralConfirmado({
      totalPagamentos: 27.44,
      totalLiquidoEsperado: 27.44,
      saldoFiscal: 0,
      saldoNaoFiscal: 0
    }), true);
    assert.equal(Orquestrador.isPagamentoIntegralConfirmado({
      totalPagamentos: 80,
      totalLiquidoEsperado: 100,
      saldoFiscal: 0,
      saldoNaoFiscal: 20
    }), false);
  });
});
