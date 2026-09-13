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

/**
 * Saldos virtuais para o motor F×NF quando o produto não controla estoque.
 * Ambos = quantidade permite 100% fiscal ou 100% não fiscal conforme prioridade da venda.
 */
function saldosParaDistribuicaoVenda(produto, quantidade, disponivelFiscal, disponivelNaoFiscal) {
  if (!produtoControlaEstoque(produto)) {
    const q = Math.max(Number(quantidade) || 0, 0);
    return { saldoFiscal: q, saldoNaoFiscal: q };
  }
  return {
    saldoFiscal: Number(disponivelFiscal || 0),
    saldoNaoFiscal: Number(disponivelNaoFiscal || 0)
  };
}

function normalizarFlagControlaEstoque(valor) {
  if (valor === undefined || valor === null || valor === '') return 1;
  return Number(valor) === 0 ? 0 : 1;
}

/** Quantidade virtual “infinita” para consultas de disponibilidade sem controle. */
const SALDO_VIRTUAL_SEM_CONTROLE = 1e12;

module.exports = {
  produtoControlaEstoque,
  saldosParaDistribuicaoVenda,
  normalizarFlagControlaEstoque,
  SALDO_VIRTUAL_SEM_CONTROLE
};
