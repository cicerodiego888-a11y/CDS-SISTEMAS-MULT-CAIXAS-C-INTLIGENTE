'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  saldosParaDistribuicaoVenda,
  produtoControlaEstoque
} = require('../../backend/services/estoque/produtoControlaEstoque');
const {
  obterFaixaQuantidadeFiscal,
  distribuirQuantidadeVenda,
  distribuirItensVendaComValorFiscalEfetivo
} = require('../../backend/services/distribuidorEstoqueVenda');
const {
  avaliarFluxoInclusaoPdv,
  prepararEntradasMotorComTransferenciaPdv
} = require('../../backend/services/estoque/transferenciaNaoFiscalParaFiscalPdv');

const pdvSrc = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');

function extract(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`Trecho não encontrado: ${startMarker} → ${endMarker}`);
  }
  return src.slice(start, end);
}

function carregarRegrasPdv() {
  const factory = new Function(`
    function pdvResolverSaldosProduto(produto) {
      const saldoFiscal = Number(produto.saldo_fiscal ?? 0);
      const saldoNaoFiscal = Number(produto.saldo_nao_fiscal ?? 0);
      return {
        saldo_fiscal: saldoFiscal,
        saldo_nao_fiscal: saldoNaoFiscal,
        estoque_atual: saldoFiscal + saldoNaoFiscal
      };
    }
    let flagVendaSemEstoque = false;
    function pdvPermitirVendaSemEstoque() { return flagVendaSemEstoque === true; }
    function pdvModoFiscalAtivo() { return false; }
    ${extract(pdvSrc, 'function produtoControlaEstoquePdv', 'function formatarSaldoPdvMensagem')}
    ${extract(pdvSrc, 'function pdvCategoriaElegivelVendaSemEstoque', 'function validarEstoqueVenda')}
    ${extract(pdvSrc, 'function validarEstoqueVenda', 'function pdvNotificarBloqueioInclusaoProduto')}
    return {
      setFlag(v) { flagVendaSemEstoque = v === true; },
      validarEstoqueVenda,
      pdvPodeIniciarInclusaoProduto
    };
  `);
  return factory();
}

function itemVenda(qtd, preco = 10) {
  return { produto_id: 1, quantidade: qtd, preco_unitario: preco };
}

function motor(entrada, vendaFiscal, opcoes = {}) {
  return distribuirItensVendaComValorFiscalEfetivo([entrada], vendaFiscal, opcoes);
}

describe('Sprint — venda sem estoque + controla_estoque + item_fiscal fallback', () => {
  it('TESTE 1 — controla=1 F=0 NF=0 venda sem estoque OFF bloqueia venda=3', () => {
    const api = carregarRegrasPdv();
    api.setFlag(false);
    const produto = {
      nome: 'Açúcar',
      controla_estoque: 1,
      saldo_fiscal: 0,
      saldo_nao_fiscal: 0
    };
    assert.equal(api.pdvPodeIniciarInclusaoProduto(produto).sucesso, false);
    const validacao = api.validarEstoqueVenda(produto, 3);
    assert.equal(validacao.sucesso, false);
    assert.equal(validacao.semSaldoTotal, true);

    const faixa = obterFaixaQuantidadeFiscal(3, 0, 0, { permitirVendaSemEstoque: false });
    assert.equal(faixa.sucesso, false);
    const dist = distribuirQuantidadeVenda(3, 0, 0, true, { permitirVendaSemEstoque: false });
    assert.equal(dist.sucesso, false);
  });

  it('TESTE 2 — F=0 NF=0 venda sem estoque ON item_fiscal=1: qF=3 e saldoFiscal=-3', () => {
    const api = carregarRegrasPdv();
    api.setFlag(true);
    const produto = {
      categoria: 'Açougue',
      controla_estoque: 1,
      item_fiscal: 1,
      saldo_fiscal: 0,
      saldo_nao_fiscal: 0
    };
    assert.equal(api.pdvPodeIniciarInclusaoProduto(produto).sucesso, true);
    const validacao = api.validarEstoqueVenda(produto, 3);
    assert.equal(validacao.confirmarSemEstoque, true);

    const saldos = saldosParaDistribuicaoVenda(produto, 3, 0, 0);
    assert.equal(saldos.saldoFiscal, 0);
    assert.equal(saldos.saldoNaoFiscal, 0);

    const dist = distribuirQuantidadeVenda(3, 0, 0, true, {
      permitirVendaSemEstoque: true,
      itemFiscal: 1
    });
    assert.equal(dist.sucesso, true);
    assert.equal(dist.quantidadeFiscal, 3);
    assert.equal(dist.quantidadeNaoFiscal, 0);
    assert.equal(saldos.saldoFiscal - dist.quantidadeFiscal, -3);
    assert.ok(saldos.saldoFiscal <= 0);
    assert.ok(saldos.saldoNaoFiscal <= 0);

    const out = motor({
      item: itemVenda(3),
      saldoFiscal: 0,
      saldoNaoFiscal: 0,
      controlaEstoque: true,
      itemFiscal: 1
    }, true, { permitirVendaSemEstoque: true });
    assert.equal(out.sucesso, true);
    assert.equal(out.itens[0].quantidade_fiscal, 3);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 0);
  });

  it('TESTE 3 — F=0 NF=0 venda sem estoque ON item_fiscal=0: qNF=3 e saldoNaoFiscal=-3', () => {
    const dist = distribuirQuantidadeVenda(3, 0, 0, false, {
      permitirVendaSemEstoque: true,
      itemFiscal: 0
    });
    assert.equal(dist.sucesso, true);
    assert.equal(dist.quantidadeFiscal, 0);
    assert.equal(dist.quantidadeNaoFiscal, 3);
    assert.equal(0 - dist.quantidadeNaoFiscal, -3);

    const out = motor({
      item: itemVenda(3),
      saldoFiscal: 0,
      saldoNaoFiscal: 0,
      controlaEstoque: true,
      itemFiscal: 0
    }, false, { permitirVendaSemEstoque: true });
    assert.equal(out.sucesso, true);
    assert.equal(out.itens[0].quantidade_fiscal, 0);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 3);
  });

  it('TESTE 4 — controla_estoque=0 F=0 NF=0 permite venda sem validar/transferir/alterar saldo', () => {
    assert.equal(produtoControlaEstoque({ controla_estoque: 0 }), false);
    const saldos = saldosParaDistribuicaoVenda({ controla_estoque: 0 }, 3, 0, 0);
    assert.equal(saldos.saldoFiscal, 0);
    assert.equal(saldos.saldoNaoFiscal, 0);

    const api = carregarRegrasPdv();
    const produto = { controla_estoque: 0, saldo_fiscal: 0, saldo_nao_fiscal: 0 };
    assert.equal(api.pdvPodeIniciarInclusaoProduto(produto).sucesso, true);
    assert.equal(api.validarEstoqueVenda(produto, 3).sucesso, true);

    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 3,
      saldoFiscal: 0,
      saldoNaoFiscal: 0,
      controlaEstoque: false
    });
    assert.equal(fluxo.devePerguntar, false);
    assert.equal(fluxo.quantidadeTransferir, 0);
    assert.equal(fluxo.acao, 'INCLUIR');

    const dist = distribuirQuantidadeVenda(3, 0, 0, true, {
      semControleEstoque: true,
      itemFiscal: 1
    });
    assert.equal(dist.sucesso, true);
    assert.equal(saldos.saldoFiscal, 0);
    assert.equal(saldos.saldoNaoFiscal, 0);
  });

  it('TESTE 5 — controla=0 item_fiscal=1 registra qF=3 sem movimentar saldo', () => {
    const saldosAntes = { saldoFiscal: 0, saldoNaoFiscal: 0 };
    const out = motor({
      item: itemVenda(3),
      saldoFiscal: 0,
      saldoNaoFiscal: 0,
      controlaEstoque: false,
      itemFiscal: 1
    }, true, { permitirVendaSemEstoque: false });
    assert.equal(out.sucesso, true);
    assert.equal(out.itens[0].quantidade, 3);
    assert.equal(out.itens[0].quantidade_fiscal, 3);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 0);
    assert.equal(saldosAntes.saldoFiscal, 0);
    assert.equal(saldosAntes.saldoNaoFiscal, 0);
  });

  it('TESTE 6 — controla=0 item_fiscal=0 registra qNF=3 sem movimentar saldo', () => {
    const saldosAntes = { saldoFiscal: 0, saldoNaoFiscal: 0 };
    const out = motor({
      item: itemVenda(3),
      saldoFiscal: 0,
      saldoNaoFiscal: 0,
      controlaEstoque: false,
      itemFiscal: 0
    }, false, { permitirVendaSemEstoque: false });
    assert.equal(out.sucesso, true);
    assert.equal(out.itens[0].quantidade_fiscal, 0);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 3);
    assert.equal(saldosAntes.saldoFiscal, 0);
    assert.equal(saldosAntes.saldoNaoFiscal, 0);
  });

  it('TESTE 7 — controla=1 F=5 NF=5 venda=3 preserva motor F×NF existente', () => {
    const fiscalPrimeiro = distribuirQuantidadeVenda(3, 5, 5, true);
    assert.equal(fiscalPrimeiro.sucesso, true);
    assert.equal(fiscalPrimeiro.quantidadeFiscal, 3);
    assert.equal(fiscalPrimeiro.quantidadeNaoFiscal, 0);

    const nfPrimeiro = distribuirQuantidadeVenda(3, 5, 5, false);
    assert.equal(nfPrimeiro.sucesso, true);
    assert.equal(nfPrimeiro.quantidadeFiscal, 0);
    assert.equal(nfPrimeiro.quantidadeNaoFiscal, 3);
  });

  it('TESTE 8 — transferência DESATIVADA F=0 NF=10 venda=3 não pergunta nem transfere', () => {
    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 3,
      saldoFiscal: 0,
      saldoNaoFiscal: 10,
      permitido: false
    });
    assert.equal(fluxo.devePerguntar, false);
    assert.equal(fluxo.quantidadeTransferir, 0);
    assert.equal(fluxo.acao, 'INCLUIR');

    const prep = prepararEntradasMotorComTransferenciaPdv([{
      item: { ...itemVenda(3), transferencia_nao_fiscal_para_fiscal: 3 },
      saldoFiscal: 0,
      saldoNaoFiscal: 10,
      controlaEstoque: true
    }], { permitido: false });
    assert.equal(prep.sucesso, true);
    assert.equal((prep.aplicacoes || []).length, 0);
    assert.equal(prep.entradas[0].saldoFiscal, 0);
    assert.equal(prep.entradas[0].saldoNaoFiscal, 10);
  });

  it('TESTE 9 — transferência DESATIVADA F12 OFF F=0 NF=10 venda=3: qF=0 qNF=3', () => {
    const out = motor({
      item: itemVenda(3),
      saldoFiscal: 0,
      saldoNaoFiscal: 10,
      controlaEstoque: true,
      itemFiscal: 1
    }, false, { permitirVendaSemEstoque: false });
    assert.equal(out.sucesso, true);
    assert.equal(out.itens[0].quantidade_fiscal, 0);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 3);
  });

  it('TESTE 10 — transferência DESATIVADA F12 ON não introduz pergunta nova', () => {
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
      controlaEstoque: true,
      itemFiscal: 1
    }, true, { permitirVendaSemEstoque: false });
    assert.equal(out.sucesso, true);
    assert.equal(out.itens[0].quantidade_fiscal, 0);
    assert.equal(out.itens[0].quantidade_nao_fiscal, 3);
  });

  it('não usa saldo virtual 1e12 / quantidade fictícia', () => {
    const ctrl = fs.readFileSync(
      path.join(ROOT, 'backend/services/estoque/produtoControlaEstoque.js'),
      'utf8'
    );
    assert.doesNotMatch(ctrl, /1e12/);
    assert.match(ctrl, /NÃO inventa saldo virtual/);
    const dist = fs.readFileSync(
      path.join(ROOT, 'backend/services/distribuidorEstoqueVenda.js'),
      'utf8'
    );
    assert.doesNotMatch(dist, /1e12/);
  });
});
