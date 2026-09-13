/**
 * VendaContract — Contrato de entrada da porta de aplicação.
 *
 * Sprint 2.2: encapsula o payload HTTP já usado pelo PDV.
 * Não altera campos, validações nem regras do núcleo.
 *
 * @module services/vendas/VendaContract
 */

'use strict';

/**
 * @typedef {Object} VendaContract
 * @property {Object} payload — body original da requisição
 * @property {Array} itens
 * @property {number|null} total
 * @property {string|null} forma_pagamento
 * @property {*} pagamentos
 * @property {*} emitir_fiscal
 * @property {*} [venda_fiscal] RC3.15.11 — prioridade Motor F×NF (≠ NFC-e)
 * @property {string|null} tipo_venda
 * @property {string|null} origem — espelho informativo (fonte da verdade = VendaContext)
 */

/**
 * Monta o contrato a partir do body HTTP (sem transformação de regras).
 * @param {import('express').Request|Object} reqOrBody
 * @returns {VendaContract}
 */
function criarVendaContract(reqOrBody = {}) {
  const payload = reqOrBody.body && typeof reqOrBody.body === 'object'
    ? reqOrBody.body
    : (reqOrBody && typeof reqOrBody === 'object' ? reqOrBody : {});

  return {
    payload,
    itens: Array.isArray(payload.itens) ? payload.itens : [],
    total: payload.total != null ? Number(payload.total) : null,
    forma_pagamento: payload.forma_pagamento != null ? String(payload.forma_pagamento) : null,
    pagamentos: payload.pagamentos != null ? payload.pagamentos : null,
    emitir_fiscal: payload.emitir_fiscal,
    venda_fiscal: payload.venda_fiscal,
    tipo_venda: payload.tipo_venda != null ? String(payload.tipo_venda) : null,
    origem: payload.origem != null ? String(payload.origem) : null
  };
}

module.exports = {
  criarVendaContract
};
