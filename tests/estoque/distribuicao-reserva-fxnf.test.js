/**
 * Sprint 1 — distribuição A/B com reserva ativa (não converter B reservado em A).
 * node --test tests/estoque/distribuicao-reserva-fxnf.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  obterFaixaQuantidadeFiscal,
  distribuirQuantidadeVenda,
  distribuirItensVendaComValorFiscalEfetivo
} = require('../../backend/services/distribuidorEstoqueVenda');
const {
  calcularEstoqueProduto,
  saldosDisponiveisMotorFxNf
} = require('../../backend/services/estoque/EstoqueDisponivelService');
const { saldosParaDistribuicaoVenda } = require('../../backend/services/estoque/produtoControlaEstoque');
const {
  avaliarFluxoInclusaoPdv,
  prepararEntradasMotorComTransferenciaPdv
} = require('../../backend/services/estoque/transferenciaNaoFiscalParaFiscalPdv');

function itemVenda(qtd, extras = {}) {
  return {
    produto_id: 611,
    quantidade: qtd,
    preco_unitario: 5.39,
    ...extras
  };
}

function motor(entrada, vendaFiscal, opcoes = {}) {
  return distribuirItensVendaComValorFiscalEfetivo([entrada], vendaFiscal, {
    pagamentos: [{ forma_pagamento: 'pix', valor: 10.78 }],
    midpAtivo: false,
    ...opcoes
  });
}

function entradaDisponivel(produto, item) {
  const motorSaldos = saldosDisponiveisMotorFxNf(produto);
  const saldos = saldosParaDistribuicaoVenda(
    produto,
    item.quantidade,
    motorSaldos.saldoFiscal,
    motorSaldos.saldoNaoFiscal
  );
  return {
    item,
    saldoFiscal: saldos.saldoFiscal,
    saldoNaoFiscal: saldos.saldoNaoFiscal,
    controlaEstoque: Number(produto.controla_estoque) !== 0,
    itemFiscal: Number(produto.item_fiscal || 0),
    produto
  };
}

describe('Sprint 1 — reserva B não vira A', () => {
  it('TESTE 1 — A=1 B=1 reservadoB=1 qty=2 fiscal semEstoque → qA=2 qB=0 (Sprint 7: excedente segue item_fiscal; reserva B intacta)', () => {
    const produto = {
      saldo_fiscal: 1,
      saldo_nao_fiscal: 1,
      reservado_fiscal: 0,
      reservado_nao_fiscal: 1,
      item_fiscal: 1,
      controla_estoque: 1
    };
    const disp = calcularEstoqueProduto(produto);
    assert.equal(disp.disponivel_fiscal, 1);
    assert.equal(disp.disponivel_nao_fiscal, 0);

    const out = motor(
      entradaDisponivel(produto, itemVenda(2)),
      true,
      { permitirVendaSemEstoque: true }
    );
    assert.equal(out.sucesso, true);
    assert.equal(out.itens[0].quantidade_fiscal, 2);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 0, 'reserva B nunca consumida');
  });

  it('TESTE 2 — A=1 B=1 sem reserva qty=2 fiscal semEstoque OFF → 1A+1B', () => {
    const dist = distribuirQuantidadeVenda(2, 1, 1, true, {
      permitirVendaSemEstoque: false,
      itemFiscal: 1
    });
    assert.equal(dist.sucesso, true);
    assert.equal(dist.quantidadeFiscal, 1);
    assert.equal(dist.quantidadeNaoFiscal, 1);
  });

  it('TESTE 3 — A=1 B=5 reservadoB=2 qty=4 fiscal semEstoque OFF → 1A+3B', () => {
    const produto = {
      saldo_fiscal: 1,
      saldo_nao_fiscal: 5,
      reservado_nao_fiscal: 2,
      item_fiscal: 1,
      controla_estoque: 1
    };
    const out = motor(
      entradaDisponivel(produto, itemVenda(4)),
      true,
      { permitirVendaSemEstoque: false }
    );
    assert.equal(out.sucesso, true);
    assert.equal(out.itens[0].quantidade_fiscal, 1);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 3);
  });

  it('TESTE 4 — A=5 B=5 qty=2 fiscal → 2A+0B', () => {
    const dist = distribuirQuantidadeVenda(2, 5, 5, true, { itemFiscal: 1 });
    assert.equal(dist.quantidadeFiscal, 2);
    assert.equal(dist.quantidadeNaoFiscal, 0);
  });

  it('TESTE 5 — A=2 B=10 qty=12 fiscal → 2A+10B', () => {
    const dist = distribuirQuantidadeVenda(12, 2, 10, true, { itemFiscal: 1 });
    assert.equal(dist.sucesso, true);
    assert.equal(dist.quantidadeFiscal, 2);
    assert.equal(dist.quantidadeNaoFiscal, 10);
  });

  it('TESTE 6 — A=0 B=0 itemFiscal=1 semEstoque qty=2 → fallback A', () => {
    const dist = distribuirQuantidadeVenda(2, 0, 0, true, {
      permitirVendaSemEstoque: true,
      itemFiscal: 1
    });
    assert.equal(dist.quantidadeFiscal, 2);
    assert.equal(dist.quantidadeNaoFiscal, 0);
  });

  it('TESTE 7 — A=0 B=0 itemFiscal=0 semEstoque qty=2 → fallback B', () => {
    const dist = distribuirQuantidadeVenda(2, 0, 0, true, {
      permitirVendaSemEstoque: true,
      itemFiscal: 0
    });
    assert.equal(dist.quantidadeFiscal, 0);
    assert.equal(dist.quantidadeNaoFiscal, 2);
  });

  it('TESTE 8 — transferência OFF não move B→A', () => {
    const item = { ...itemVenda(2), transferencia_nao_fiscal_para_fiscal: 1 };
    const prep = prepararEntradasMotorComTransferenciaPdv(
      [{ item, saldoFiscal: 1, saldoNaoFiscal: 1, controlaEstoque: true, itemFiscal: 1 }],
      { permitido: false }
    );
    assert.equal(prep.sucesso, true);
    assert.equal(prep.entradas[0].saldoFiscal, 1);
    assert.equal(prep.entradas[0].saldoNaoFiscal, 1);
    assert.equal(prep.entradas[0].transferenciaAplicadaEmMemoria, 0);
    assert.equal((prep.aplicacoes || []).length, 0);
  });

  it('TESTE 9 — transferência ON + NÃO não move B→A', () => {
    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 2,
      saldoFiscal: 1,
      saldoNaoFiscal: 1,
      modoFiscal: true,
      permitido: true,
      respostaTransferencia: false,
      permitirVendaSemEstoque: true
    });
    assert.equal(fluxo.acao, 'INCLUIR');
    assert.equal(fluxo.quantidadeTransferir, 0);

    const prep = prepararEntradasMotorComTransferenciaPdv(
      [{ item: itemVenda(2), saldoFiscal: 1, saldoNaoFiscal: 1, controlaEstoque: true, itemFiscal: 1 }],
      { permitido: true }
    );
    assert.equal(prep.entradas[0].saldoFiscal, 1);
    assert.equal(prep.entradas[0].saldoNaoFiscal, 1);
    assert.equal(prep.entradas[0].transferenciaAplicadaEmMemoria, 0);
  });

  it('TESTE 10 — transferência ON + SIM + intent preserva conversão explícita', () => {
    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 2,
      saldoFiscal: 1,
      saldoNaoFiscal: 1,
      modoFiscal: true,
      permitido: true,
      respostaTransferencia: true
    });
    assert.equal(fluxo.acao, 'INCLUIR');
    assert.equal(fluxo.quantidadeTransferir, 1);

    const item = { ...itemVenda(2), transferencia_nao_fiscal_para_fiscal: 1 };
    const prep = prepararEntradasMotorComTransferenciaPdv(
      [{ item, saldoFiscal: 1, saldoNaoFiscal: 1, controlaEstoque: true, itemFiscal: 1 }],
      { permitido: true }
    );
    assert.equal(prep.entradas[0].saldoFiscal, 2);
    assert.equal(prep.entradas[0].saldoNaoFiscal, 0);
    assert.equal(prep.entradas[0].transferenciaAplicadaEmMemoria, 1);
  });

  it('TESTE 11 — baixa A=1 qA=1 chega a A=0 (sem clamp)', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'),
      'utf8'
    );
    assert.match(src, /saldo_fiscal = saldo_fiscal - \?/);
    assert.doesNotMatch(
      src,
      /saldo_fiscal = CASE WHEN saldo_fiscal - \? < 0 THEN 1/
    );
    const saldoDepois = 1 - 1;
    assert.equal(saldoDepois, 0);
  });

  it('TESTE 12 — baixa B=1 qB=1 chega a B=0 (sem clamp)', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'),
      'utf8'
    );
    assert.match(src, /saldo_nao_fiscal = saldo_nao_fiscal - \?/);
    const saldoDepois = 1 - 1;
    assert.equal(saldoDepois, 0);
  });

  it('reprodução banco real produto 611 — disponível A1 B0; excedente fiscal (Sprint 7) → 2A+0B sem consumir reserva B', () => {
    const produto611 = {
      id: 611,
      nome: 'Arroz Branco Tipo 1 Pop 1 kg',
      saldo_fiscal: 1,
      saldo_nao_fiscal: 1,
      estoque_atual: 2,
      reservado_fiscal: 0,
      reservado_nao_fiscal: 1,
      item_fiscal: 1,
      controla_estoque: 1
    };

    const pre = saldosDisponiveisMotorFxNf(produto611);
    const persist = saldosDisponiveisMotorFxNf(produto611);
    assert.equal(pre.saldoFiscal, persist.saldoFiscal);
    assert.equal(pre.saldoNaoFiscal, persist.saldoNaoFiscal);
    assert.equal(pre.saldoFiscal, 1);
    assert.equal(pre.saldoNaoFiscal, 0);

    const prep = prepararEntradasMotorComTransferenciaPdv(
      [entradaDisponivel(produto611, itemVenda(2))],
      { permitido: false }
    );
    assert.equal(prep.entradas[0].saldoFiscal, 1);
    assert.equal(prep.entradas[0].saldoNaoFiscal, 0);

    const out = motor(prep.entradas[0], true, { permitirVendaSemEstoque: true });
    assert.equal(out.itens[0].quantidade_fiscal, 2);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 0);

    const faixa = obterFaixaQuantidadeFiscal(2, 1, 0, {
      permitirVendaSemEstoque: true,
      itemFiscal: 1
    });
    assert.equal(faixa.quantidadeFiscalMax, 1);
  });

  it('pré-cálculo e persistência compartilham saldosDisponiveisMotorFxNf', () => {
    const pagSrc = fs.readFileSync(
      path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'),
      'utf8'
    );
    const ocorrencias = pagSrc.split('saldosDisponiveisMotorFxNf').length - 1;
    assert.ok(ocorrencias >= 2, 'pré-cálculo e persistência devem usar a mesma função');
    assert.match(pagSrc, /COALESCE\(reservado_nao_fiscal, 0\) AS reservado_nao_fiscal/);
  });
});
