/**
 * VendaContext — Contexto operacional da criação de venda.
 *
 * Sprint 2.2: estrutura oficial multi-origem.
 * Nesta Sprint apenas `origem` é consumida pela política de porta.
 * Demais campos espelham o preenchimento atual (middleware / JWT).
 *
 * @module services/vendas/VendaContext
 */

'use strict';

const { resolverVendaOrigin, VendaOrigin } = require('./VendaOrigin');

/**
 * @typedef {Object} VendaContext
 * @property {string} origem
 * @property {*|null} empresa
 * @property {*|null} filial
 * @property {number|null} operador
 * @property {number|null} terminal
 * @property {number|null} caixa
 * @property {number|null} sessao
 */

/**
 * Monta VendaContext a partir da requisição HTTP.
 * Origem padrão: PDV.
 *
 * @param {import('express').Request} [req]
 * @param {Object} [overrides]
 * @returns {VendaContext}
 */
function criarVendaContext(req = {}, overrides = {}) {
  const body = req.body || {};
  const origem = resolverVendaOrigin(
    overrides.origem != null ? overrides.origem : body.origem
  );

  return {
    origem,
    empresa: overrides.empresa != null ? overrides.empresa : (body.empresa_id ?? body.empresa ?? null),
    filial: overrides.filial != null ? overrides.filial : (body.filial_id ?? body.filial ?? null),
    operador: overrides.operador != null
      ? overrides.operador
      : (req.operadorId != null ? Number(req.operadorId) : (req.user?.id != null ? Number(req.user.id) : null)),
    terminal: overrides.terminal != null
      ? overrides.terminal
      : (req.terminalId != null ? Number(req.terminalId) : null),
    caixa: overrides.caixa != null
      ? overrides.caixa
      : (req.caixaId != null ? Number(req.caixaId) : null),
    sessao: overrides.sessao != null
      ? overrides.sessao
      : (req.caixaSessaoId != null ? Number(req.caixaSessaoId) : null)
  };
}

/**
 * Contexto mínimo para testes / chamadas internas.
 * @param {string} [origem]
 * @returns {VendaContext}
 */
function criarVendaContextOrigem(origem = VendaOrigin.PDV) {
  return criarVendaContext({}, { origem });
}

module.exports = {
  criarVendaContext,
  criarVendaContextOrigem,
  VendaOrigin
};
