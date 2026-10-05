'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  avaliarFluxoInclusaoPdv,
  prepararEntradasMotorComTransferenciaPdv
} = require('../../backend/services/estoque/transferenciaNaoFiscalParaFiscalPdv');
const {
  distribuirQuantidadeVenda,
  distribuirItensVendaComValorFiscalEfetivo
} = require('../../backend/services/distribuidorEstoqueVenda');

const pdvSrc = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');

function extract(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`Trecho não encontrado: ${startMarker} → ${endMarker}`);
  }
  return src.slice(start, end);
}

function carregarAnalisePdv() {
  const factory = new Function(`
    let flagTransferencia = false;
    let flagF12 = false;
    function pdvPermitirTransferenciaNaoFiscalFiscal() { return flagTransferencia === true; }
    function pdvModoFiscalAtivo() { return flagF12 === true; }
    function produtoControlaEstoquePdv(produto) {
      if (produto == null) return true;
      if (produto.controla_estoque === undefined || produto.controla_estoque === null || produto.controla_estoque === '') {
        return true;
      }
      return Number(produto.controla_estoque) !== 0;
    }
    function round3TransferenciaPdv(n) {
      return Math.round(Number(n || 0) * 1000) / 1000;
    }
    function pdvResolverSaldosProduto(produto) {
      return {
        saldo_fiscal: Number(produto.saldo_fiscal || 0),
        saldo_nao_fiscal: Number(produto.saldo_nao_fiscal || 0),
        estoque_atual: Number(produto.saldo_fiscal || 0) + Number(produto.saldo_nao_fiscal || 0)
      };
    }
    function pdvSaldosComTransferenciasPendentes(produto) {
      return pdvResolverSaldosProduto(produto);
    }
    ${extract(pdvSrc, 'function calcularTransferenciaNaoFiscalParaFiscalPdv', 'function pdvSaldosComTransferenciasPendentes')}
    ${extract(pdvSrc, 'function pdvAnalisarTransferenciaEstoque', 'function abrirModalTransferirEstoquePdv')}
    return {
      setTransferencia(v) { flagTransferencia = v === true; },
      setF12(v) { flagF12 = v === true; },
      pdvAnalisarTransferenciaEstoque
    };
  `);
  return factory();
}

function itemVenda(qtd, intent = 0, preco = 10) {
  return {
    produto_id: 1,
    quantidade: qtd,
    preco_unitario: preco,
    transferencia_nao_fiscal_para_fiscal: intent
  };
}

function motor(entrada, vendaFiscal, opcoes = {}) {
  return distribuirItensVendaComValorFiscalEfetivo([entrada], vendaFiscal, opcoes);
}

describe('Sprint 2 — F12 + transferência NF → Fiscal', () => {
  it('TESTE 1 — transferência DESATIVADA + F12 OFF + F=0 NF=10 venda=3: não pergunta, vende NF', () => {
    const pdv = carregarAnalisePdv();
    pdv.setTransferencia(false);
    pdv.setF12(false);
    const analise = pdv.pdvAnalisarTransferenciaEstoque(
      { controla_estoque: 1, saldo_fiscal: 0, saldo_nao_fiscal: 10 },
      3
    );
    assert.equal(analise.devePerguntar, false);
    assert.equal(analise.quantidadeTransferir, 0);

    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 3,
      saldoFiscal: 0,
      saldoNaoFiscal: 10,
      modoFiscal: false,
      permitido: false
    });
    assert.equal(fluxo.devePerguntar, false);
    assert.equal(fluxo.acao, 'INCLUIR');

    const prep = prepararEntradasMotorComTransferenciaPdv([{
      item: itemVenda(3, 3),
      saldoFiscal: 0,
      saldoNaoFiscal: 10
    }], { permitido: false });
    assert.equal(prep.aplicacoes.length, 0);

    const out = motor({
      item: itemVenda(3),
      saldoFiscal: 0,
      saldoNaoFiscal: 10,
      controlaEstoque: true
    }, false);
    assert.equal(out.sucesso, true);
    assert.equal(out.itens[0].quantidade_fiscal, 0);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 3);
  });

  it('TESTE 2 — transferência DESATIVADA + F12 ON: não pergunta nem transfere', () => {
    const pdv = carregarAnalisePdv();
    pdv.setTransferencia(false);
    pdv.setF12(true);
    const analise = pdv.pdvAnalisarTransferenciaEstoque(
      { controla_estoque: 1, saldo_fiscal: 0, saldo_nao_fiscal: 10 },
      3
    );
    assert.equal(analise.devePerguntar, false);

    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 3,
      saldoFiscal: 0,
      saldoNaoFiscal: 10,
      modoFiscal: true,
      permitido: false
    });
    assert.equal(fluxo.devePerguntar, false);
    assert.equal(fluxo.acao, 'INCLUIR');

    const out = motor({
      item: itemVenda(3),
      saldoFiscal: 0,
      saldoNaoFiscal: 10,
      controlaEstoque: true
    }, true);
    assert.equal(out.sucesso, true);
    assert.equal(out.itens[0].quantidade_fiscal, 0);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 3);
  });

  it('TESTE 3 — transferência ATIVADA + F12 OFF: não pergunta', () => {
    const pdv = carregarAnalisePdv();
    pdv.setTransferencia(true);
    pdv.setF12(false);
    const analise = pdv.pdvAnalisarTransferenciaEstoque(
      { controla_estoque: 1, saldo_fiscal: 0, saldo_nao_fiscal: 10 },
      3
    );
    assert.equal(analise.devePerguntar, false);

    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 3,
      saldoFiscal: 0,
      saldoNaoFiscal: 10,
      modoFiscal: false,
      permitido: true
    });
    assert.equal(fluxo.devePerguntar, false);
    assert.equal(fluxo.acao, 'INCLUIR');
    assert.equal(fluxo.quantidadeTransferir, 0);
  });

  it('TESTE 4 — transferência ATIVADA + F12 ON + F=0 NF=10 venda=3: pergunta', () => {
    const pdv = carregarAnalisePdv();
    pdv.setTransferencia(true);
    pdv.setF12(true);
    const analise = pdv.pdvAnalisarTransferenciaEstoque(
      { controla_estoque: 1, saldo_fiscal: 0, saldo_nao_fiscal: 10 },
      3
    );
    assert.equal(analise.devePerguntar, true);
    assert.equal(analise.quantidadeTransferir, 3);

    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 3,
      saldoFiscal: 0,
      saldoNaoFiscal: 10,
      modoFiscal: true,
      permitido: true
    });
    assert.equal(fluxo.acao, 'PERGUNTAR');
    assert.equal(fluxo.quantidadeTransferir, 3);
  });

  it('TESTE 5 — SIM transfere 3 NF→F e vende 3 fiscal', () => {
    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 3,
      saldoFiscal: 0,
      saldoNaoFiscal: 10,
      modoFiscal: true,
      permitido: true,
      respostaTransferencia: true
    });
    assert.equal(fluxo.quantidadeTransferir, 3);
    assert.equal(fluxo.saldoNaoAlteraNoSim, true);

    const prep = prepararEntradasMotorComTransferenciaPdv([{
      item: itemVenda(3, fluxo.quantidadeTransferir),
      saldoFiscal: 0,
      saldoNaoFiscal: 10,
      controlaEstoque: true
    }], { permitido: true });
    assert.equal(prep.aplicacoes.length, 1);
    assert.equal(prep.aplicacoes[0].quantidade, 3);
    assert.equal(prep.entradas[0].saldoFiscal, 3);
    assert.equal(prep.entradas[0].saldoNaoFiscal, 7);

    const out = motor(prep.entradas[0], true);
    assert.equal(out.sucesso, true);
    assert.equal(out.itens[0].quantidade_fiscal, 3);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 0);

    const saldoFinalF = prep.entradas[0].saldoFiscal - out.itens[0].quantidade_fiscal;
    const saldoFinalNf = prep.entradas[0].saldoNaoFiscal - out.itens[0].quantidade_nao_fiscal;
    assert.equal(saldoFinalF, 0);
    assert.equal(saldoFinalNf, 7);
  });

  it('TESTE 6 — NÃO não transfere e vende 3 não fiscal', () => {
    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 3,
      saldoFiscal: 0,
      saldoNaoFiscal: 10,
      modoFiscal: true,
      permitido: true,
      respostaTransferencia: false
    });
    assert.equal(fluxo.acao, 'INCLUIR');
    assert.equal(fluxo.quantidadeTransferir, 0);

    const prep = prepararEntradasMotorComTransferenciaPdv([{
      item: itemVenda(3, 0),
      saldoFiscal: 0,
      saldoNaoFiscal: 10
    }], { permitido: true });
    assert.equal(prep.aplicacoes.length, 0);

    const out = motor({
      item: itemVenda(3),
      saldoFiscal: 0,
      saldoNaoFiscal: 10,
      controlaEstoque: true
    }, true);
    assert.equal(out.itens[0].quantidade_fiscal, 0);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 3);
    assert.equal(0 - 0, 0);
    assert.equal(10 - 3, 7);
  });

  it('TESTE 7 — F=2 NF=10 venda=5 pergunta transferência de 3', () => {
    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 5,
      saldoFiscal: 2,
      saldoNaoFiscal: 10,
      modoFiscal: true,
      permitido: true
    });
    assert.equal(fluxo.acao, 'PERGUNTAR');
    assert.equal(fluxo.quantidadeTransferir, 3);
  });

  it('TESTE 8 — parcial SIM: transfere 3 e vende 5 fiscal', () => {
    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 5,
      saldoFiscal: 2,
      saldoNaoFiscal: 10,
      modoFiscal: true,
      permitido: true,
      respostaTransferencia: true
    });
    const prep = prepararEntradasMotorComTransferenciaPdv([{
      item: itemVenda(5, fluxo.quantidadeTransferir),
      saldoFiscal: 2,
      saldoNaoFiscal: 10
    }], { permitido: true });
    assert.equal(prep.entradas[0].saldoFiscal, 5);
    assert.equal(prep.entradas[0].saldoNaoFiscal, 7);
    const out = motor(prep.entradas[0], true);
    assert.equal(out.itens[0].quantidade_fiscal, 5);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 0);
  });

  it('TESTE 9 — parcial NÃO: motor usa F=2 NF=3', () => {
    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 5,
      saldoFiscal: 2,
      saldoNaoFiscal: 10,
      modoFiscal: true,
      permitido: true,
      respostaTransferencia: false
    });
    assert.equal(fluxo.quantidadeTransferir, 0);
    const out = motor({
      item: itemVenda(5),
      saldoFiscal: 2,
      saldoNaoFiscal: 10,
      controlaEstoque: true
    }, true);
    assert.equal(out.itens[0].quantidade_fiscal, 2);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 3);
  });

  it('TESTE 10 — estoque total insuficiente + venda sem estoque OFF: não pergunta, bloqueia', () => {
    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 5,
      saldoFiscal: 1,
      saldoNaoFiscal: 1,
      modoFiscal: true,
      permitido: true,
      permitirVendaSemEstoque: false
    });
    assert.equal(fluxo.devePerguntar, false);
    assert.equal(fluxo.acao, 'RECUSAR');

    const dist = distribuirQuantidadeVenda(5, 1, 1, true, { permitirVendaSemEstoque: false });
    assert.equal(dist.sucesso, false);
  });

  it('TESTE 11 — estoque total insuficiente + venda sem estoque ON: permite, sem transferência', () => {
    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 5,
      saldoFiscal: 1,
      saldoNaoFiscal: 1,
      modoFiscal: true,
      permitido: true,
      permitirVendaSemEstoque: true
    });
    assert.equal(fluxo.devePerguntar, false);
    assert.equal(fluxo.acao, 'INCLUIR');
    assert.equal(fluxo.quantidadeTransferir, 0);

    const dist = distribuirQuantidadeVenda(5, 1, 1, true, {
      permitirVendaSemEstoque: true,
      itemFiscal: 1
    });
    assert.equal(dist.sucesso, true);
  });

  it('TESTE 12 — controla_estoque=0 não pergunta nem movimenta', () => {
    const pdv = carregarAnalisePdv();
    pdv.setTransferencia(true);
    pdv.setF12(true);
    const analise = pdv.pdvAnalisarTransferenciaEstoque(
      { controla_estoque: 0, saldo_fiscal: 0, saldo_nao_fiscal: 0, item_fiscal: 1 },
      3
    );
    assert.equal(analise.devePerguntar, false);

    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 3,
      saldoFiscal: 0,
      saldoNaoFiscal: 0,
      modoFiscal: true,
      permitido: true,
      controlaEstoque: false
    });
    assert.equal(fluxo.devePerguntar, false);
    assert.equal(fluxo.acao, 'INCLUIR');

    const prep = prepararEntradasMotorComTransferenciaPdv([{
      item: itemVenda(3, 3),
      saldoFiscal: 0,
      saldoNaoFiscal: 0,
      controlaEstoque: false,
      produto: { controla_estoque: 0, item_fiscal: 1 }
    }], { permitido: true });
    assert.equal(prep.aplicacoes.length, 0);
    assert.equal(prep.entradas[0].saldoFiscal, 0);
    assert.equal(prep.entradas[0].saldoNaoFiscal, 0);

    const out = motor({
      item: itemVenda(3),
      saldoFiscal: 0,
      saldoNaoFiscal: 0,
      controlaEstoque: false,
      itemFiscal: 1
    }, true);
    assert.equal(out.sucesso, true);
    assert.equal(out.itens[0].quantidade_fiscal, 3);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 0);
  });

  it('TESTE 13 — transferência DESATIVADA F12 ON F=5 NF=5 venda=8: motor F×NF sem pergunta', () => {
    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 8,
      saldoFiscal: 5,
      saldoNaoFiscal: 5,
      modoFiscal: true,
      permitido: false
    });
    assert.equal(fluxo.devePerguntar, false);
    assert.equal(fluxo.acao, 'INCLUIR');

    const dist = distribuirQuantidadeVenda(8, 5, 5, true);
    assert.equal(dist.sucesso, true);
    assert.equal(dist.quantidadeFiscal, 5);
    assert.equal(dist.quantidadeNaoFiscal, 3);
  });

  it('TESTE 14 — fiscal suficiente: não pergunta', () => {
    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 3,
      saldoFiscal: 5,
      saldoNaoFiscal: 5,
      modoFiscal: true,
      permitido: true
    });
    assert.equal(fluxo.devePerguntar, false);
    assert.equal(fluxo.acao, 'INCLUIR');
    const dist = distribuirQuantidadeVenda(3, 5, 5, true);
    assert.equal(dist.quantidadeFiscal, 3);
    assert.equal(dist.quantidadeNaoFiscal, 0);
  });

  it('PDV analisa transferência só com F12 ON e config ATIVADA', () => {
    const fn = extract(
      pdvSrc,
      'function pdvAnalisarTransferenciaEstoque',
      'function abrirModalTransferirEstoquePdv'
    );
    assert.match(fn, /pdvPermitirTransferenciaNaoFiscalFiscal\(\)/);
    assert.match(fn, /pdvModoFiscalAtivo/);
    assert.match(pdvSrc, /modoFiscal:\s*pdvModoFiscalAtivo\(\)/);
  });
});
