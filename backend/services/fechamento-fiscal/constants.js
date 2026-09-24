/**
 * Sprint 01–04 — Fechamento Fiscal do Dia — constantes e status.
 */

'use strict';

const STATUS = Object.freeze({
  RASCUNHO: 'RASCUNHO',
  PREVIA: 'PREVIA',
  VALIDANDO: 'VALIDANDO',
  PRONTO_EMISSAO: 'PRONTO_EMISSAO',
  EMITINDO: 'EMITINDO',
  AUTORIZADO: 'AUTORIZADO',
  /** Autorizados + rejeitados/erros no mesmo fechamento — NFC-e autorizadas permanecem válidas. */
  AUTORIZACAO_PARCIAL: 'AUTORIZACAO_PARCIAL',
  /** Resultado fiscal ainda indeterminado (timeout / possível processamento). */
  PENDENTE_RECUPERACAO: 'PENDENTE_RECUPERACAO',
  REJEITADO: 'REJEITADO',
  CONFIRMADO: 'CONFIRMADO', // legado Sprint 01
  PROCESSANDO: 'PROCESSANDO', // legado / reserva
  CONCLUIDO: 'CONCLUIDO',
  ERRO: 'ERRO',
  CANCELADO: 'CANCELADO'
});

/** Status que bloqueiam outro fechamento ativo no mesmo dia/CNPJ. */
const STATUS_ATIVOS = Object.freeze([
  STATUS.RASCUNHO,
  STATUS.PREVIA,
  STATUS.VALIDANDO,
  STATUS.PRONTO_EMISSAO,
  STATUS.EMITINDO,
  STATUS.AUTORIZADO,
  STATUS.AUTORIZACAO_PARCIAL,
  STATUS.PENDENTE_RECUPERACAO,
  STATUS.REJEITADO,
  STATUS.CONFIRMADO,
  STATUS.PROCESSANDO,
  STATUS.CONCLUIDO,
  STATUS.ERRO
]);

const STATUS_PODEM_PREPARAR = Object.freeze([
  STATUS.PREVIA,
  STATUS.VALIDANDO,
  STATUS.PRONTO_EMISSAO,
  STATUS.ERRO,
  STATUS.REJEITADO,
  STATUS.AUTORIZACAO_PARCIAL,
  STATUS.PENDENTE_RECUPERACAO
]);

const STATUS_PODEM_TRANSMITIR = Object.freeze([
  STATUS.PRONTO_EMISSAO,
  STATUS.REJEITADO,
  STATUS.ERRO,
  STATUS.EMITINDO, // recuperação / parcial
  STATUS.AUTORIZACAO_PARCIAL,
  STATUS.PENDENTE_RECUPERACAO
]);

const DEFAULTS_DISTRIBUICAO = Object.freeze({
  valorAlvo: 250,
  /** Homologação realista: permite vendas pequenas (R$ 8+). */
  valorMin: 8,
  valorMax: 500,
  distribuicaoAutomatica: true
});

const TP_EMIS = Object.freeze({
  NORMAL: '1',
  CONTINGENCIA: '9' // reservado — não usar nesta sprint
});

const DOC_STATUS = Object.freeze({
  RASCUNHO: 'RASCUNHO',
  VALIDADO: 'VALIDADO',
  XML_GERADO: 'XML_GERADO',
  PRONTO_EMISSAO: 'PRONTO_EMISSAO',
  EMITINDO: 'EMITINDO',
  AUTORIZADO: 'AUTORIZADO',
  REJEITADO: 'REJEITADO',
  ERRO: 'ERRO',
  ERRO_COM_POSSIVEL_PROCESSAMENTO: 'ERRO_COM_POSSIVEL_PROCESSAMENTO',
  /** Sprint 08.3 — NFC-e do fechamento cancelada na SEFAZ (espelha STATUS.CANCELADO do fechamento). */
  CANCELADO: 'CANCELADO'
});

const AMBIENTE = Object.freeze({
  PRODUCAO: 1,
  HOMOLOGACAO: 2
});

module.exports = {
  STATUS,
  STATUS_ATIVOS,
  STATUS_PODEM_PREPARAR,
  STATUS_PODEM_TRANSMITIR,
  DEFAULTS_DISTRIBUICAO,
  TP_EMIS,
  DOC_STATUS,
  AMBIENTE
};
