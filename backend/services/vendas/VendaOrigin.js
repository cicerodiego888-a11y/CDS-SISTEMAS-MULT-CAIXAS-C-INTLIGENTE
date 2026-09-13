/**
 * VendaOrigin — Origens oficiais do Núcleo Transacional da Venda.
 *
 * Sprint 2.2: reconhecimento multi-origem.
 * Padrão = PDV (compatibilidade total com o comportamento atual).
 *
 * @module services/vendas/VendaOrigin
 */

'use strict';

const VendaOrigin = Object.freeze({
  PDV: 'PDV',
  PEDIDO: 'PEDIDO',
  FATURAMENTO: 'FATURAMENTO',
  ORCAMENTO: 'ORCAMENTO',
  COMPRA_FACIL: 'COMPRA_FACIL',
  MARKETPLACE: 'MARKETPLACE',
  API: 'API',
  /** RC3.16 — porta fiscal: Nova NF-e (sem Pedido / sem Faturamento) */
  NF_AVULSA: 'NF_AVULSA'
});

const VENDA_ORIGENS = Object.freeze(Object.values(VendaOrigin));

/**
 * Resolve a origem da operação. Desconhecida / ausente → PDV.
 * @param {*} valor
 * @returns {string}
 */
function resolverVendaOrigin(valor) {
  const s = String(valor || '').toUpperCase().trim();
  if (VENDA_ORIGENS.includes(s)) return s;
  return VendaOrigin.PDV;
}

/**
 * Origens presenciais que exigem caixa/terminal/sessão (comportamento atual).
 * @param {string} origem
 * @returns {boolean}
 */
function origemExigeCaixa(origem) {
  return resolverVendaOrigin(origem) === VendaOrigin.PDV;
}

/**
 * Origens que concluem venda pelo núcleo (estoque + financeiro).
 * RC3.16: NF_AVULSA (porta fiscal) usa o mesmo núcleo, sem caixa.
 * @param {string} origem
 * @returns {boolean}
 */
function origemPodeConcluirVenda(origem) {
  const o = resolverVendaOrigin(origem);
  return o === VendaOrigin.PDV
    || o === VendaOrigin.FATURAMENTO
    || o === VendaOrigin.NF_AVULSA;
}

module.exports = {
  VendaOrigin,
  VENDA_ORIGENS,
  resolverVendaOrigin,
  origemExigeCaixa,
  origemPodeConcluirVenda
};
