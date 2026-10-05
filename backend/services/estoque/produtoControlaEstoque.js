/**
 * RC8.0.Y — Controle opcional de estoque por produto.
 * controla_estoque = 1 (padrão): valida e movimenta saldo.
 * controla_estoque = 0: vende sem validar/baixar estoque.
 */

'use strict';

function produtoControlaEstoque(produto) {
  if (produto == null) return true;
  if (
    produto.controla_estoque === undefined
    || produto.controla_estoque === null
    || produto.controla_estoque === ''
  ) {
    return true;
  }
  return Number(produto.controla_estoque) !== 0;
}

function produtoItemFiscal(produto) {
  return Number(produto && produto.item_fiscal) !== 0;
}

/**
 * Saldos reais para o motor F×NF.
 * controla_estoque=0 NÃO inventa saldo virtual: a natureza da venda vem de item_fiscal.
 */
function saldosParaDistribuicaoVenda(produto, quantidade, disponivelFiscal, disponivelNaoFiscal) {
  return {
    saldoFiscal: Number(disponivelFiscal || 0),
    saldoNaoFiscal: Number(disponivelNaoFiscal || 0)
  };
}

function normalizarFlagControlaEstoque(valor) {
  if (valor === undefined || valor === null || valor === '') return 1;
  return Number(valor) === 0 ? 0 : 1;
}

/** @deprecated não usar para simular estoque; controla_estoque=0 não tem saldo virtual. */
const SALDO_VIRTUAL_SEM_CONTROLE = 0;

module.exports = {
  produtoControlaEstoque,
  produtoItemFiscal,
  saldosParaDistribuicaoVenda,
  normalizarFlagControlaEstoque,
  SALDO_VIRTUAL_SEM_CONTROLE
};
