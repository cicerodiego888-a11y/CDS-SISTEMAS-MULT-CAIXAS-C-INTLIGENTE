/**
 * Fachada pública do Motor Fiscal × Não Fiscal (saldos / distribuição).
 *
 * Princípio CDS: outros motores só consomem este módulo (ou fiscalNaoFiscalService
 * legado de agregação), nunca tabelas de estoque diretamente.
 *
 * @module services/fiscalNaoFiscal
 */
'use strict';

const estoqueSaldosPublico = require('./estoqueSaldosPublico');
const reservasPublico = require('./reservasPublico');
const constants = require('./constants');
const legado = require('../fiscalNaoFiscalService');

module.exports = {
  // Interface pública de saldos (MTS e futuros motores)
  ...estoqueSaldosPublico,
  // Interface pública de reservas (Motor Comercial / Pedido)
  consultarDisponibilidade: reservasPublico.consultarDisponibilidade,
  consultarDisponibilidadeParaPedido: reservasPublico.consultarDisponibilidadeParaPedido,
  criarReservaFiscal: reservasPublico.criarReservaFiscal,
  liberarReservasPedido: reservasPublico.liberarReservasPedido,
  garantirSchemaReservas: reservasPublico.garantirSchemaReservas,
  TipoSaldo: constants.TipoSaldo,
  normalizarTipoSaldo: constants.normalizarTipoSaldo,
  // Legado (agregação de totais pós-distribuição) — mantido
  separarItensFiscalNaoFiscal: legado.separarItensFiscalNaoFiscal,
  separarItensDistribuidos: legado.separarItensDistribuidos,
  normalizarItemFiscal: legado.normalizarItemFiscal
};
