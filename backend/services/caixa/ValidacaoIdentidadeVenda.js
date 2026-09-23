/**
 * Identidade financeira oficial da venda — validação na persistência.
 * Não altera Motor Fiscal / Não Fiscal / Comercial; apenas rejeita inconsistência.
 */
'use strict';

const { arred2, quaseIgual, somar, parseMoedaBr, TOLERANCIA } = require('../financeiro/politicaMonetaria');
const { identidadeFiscalVenda, ehFormaPrazo } = require('./ReconciliacaoVendaCaixa');

function n(valor) {
  return parseMoedaBr(valor);
}

function subtotalItem(item) {
  if (!item) return 0;
  if (item.subtotal != null && item.subtotal !== '') return n(item.subtotal);
  const qtd = n(item.quantidade != null ? item.quantidade : 1);
  const preco = n(item.preco_unitario != null ? item.preco_unitario : item.preco);
  return arred2(qtd * preco);
}

function validarIdentidadeFinanceiraVenda({
  total,
  valorFiscal,
  valorNaoFiscal,
  itens = [],
  desconto = 0,
  acrescimo = 0,
  pagamentos = [],
  statusPagamento = null,
  formaPagamento = null
} = {}) {
  const totalOficial = n(total);
  const listaItens = Array.isArray(itens) ? itens : [];

  if (listaItens.length > 0) {
    const somaItens = arred2(listaItens.reduce((acc, item) => acc + subtotalItem(item), 0));
    const calculado = arred2(somaItens - n(desconto) + n(acrescimo));
    if (!quaseIgual(calculado, totalOficial)) {
      return {
        ok: false,
        erro: `Total da venda não confere com os itens. Itens: ${calculado.toFixed(2)} | Total: ${totalOficial.toFixed(2)}.`
      };
    }
  }

  const identidade = identidadeFiscalVenda({
    total: totalOficial,
    valor_fiscal: valorFiscal,
    valor_nao_fiscal: valorNaoFiscal
  });
  if (!identidade.ok) {
    return {
      ok: false,
      erro: 'Total da venda não confere com a distribuição fiscal/não fiscal.'
    };
  }

  const linhas = Array.isArray(pagamentos) ? pagamentos : [];
  const imediato = arred2(linhas.reduce((acc, p) => acc + n(p && p.valor), 0));
  if (imediato > totalOficial + TOLERANCIA) {
    return {
      ok: false,
      erro: `Pagamentos imediatos (${imediato.toFixed(2)}) maiores que o total da venda (${totalOficial.toFixed(2)}).`
    };
  }

  const prazo = ehFormaPrazo(formaPagamento);
  const quitada = String(statusPagamento || '').toLowerCase() === 'quitada';
  if (quitada && !prazo && !quaseIgual(imediato, totalOficial) && linhas.length > 0) {
    return {
      ok: false,
      erro: `Venda quitada, mas os pagamentos (${imediato.toFixed(2)}) não fecham com o total (${totalOficial.toFixed(2)}).`
    };
  }

  return { ok: true, total_oficial: totalOficial, identidade };
}

module.exports = {
  validarIdentidadeFinanceiraVenda,
  subtotalItem
};
