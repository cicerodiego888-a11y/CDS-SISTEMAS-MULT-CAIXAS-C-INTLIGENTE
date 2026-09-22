/**
 * Modos e classificação de ações da Central (Sprint 5).
 * @module services/fiscal/central/CentralOperationModes
 */
'use strict';

const ModoOperacao = Object.freeze({
  ASSISTIDO: 'ASSISTIDO',
  AUTOMATICO: 'AUTOMATICO'
});

const ClassificacaoAcao = Object.freeze({
  SAFE: 'SAFE',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  NEVER_AUTOMATIC: 'NEVER_AUTOMATIC'
});

const OrigemAcao = Object.freeze({
  AUTOMATIC: 'AUTOMATIC',
  MANUAL: 'MANUAL'
});

const StatusDecisao = Object.freeze({
  EXECUTAR: 'EXECUTAR',
  AGUARDAR_CONFIRMACAO: 'AGUARDAR_CONFIRMACAO',
  ACAO_REQUER_CONFIRMACAO: 'ACAO_REQUER_CONFIRMACAO',
  BLOQUEADO: 'BLOQUEADO',
  AGUARDANDO_PROXIMA_JANELA: 'AGUARDANDO_PROXIMA_JANELA'
});

const MODO_PADRAO = ModoOperacao.ASSISTIDO;

function normalizarModo(valor) {
  const v = String(valor || '').toUpperCase();
  if (v === ModoOperacao.AUTOMATICO) return ModoOperacao.AUTOMATICO;
  return ModoOperacao.ASSISTIDO;
}

module.exports = {
  ModoOperacao,
  ClassificacaoAcao,
  OrigemAcao,
  StatusDecisao,
  MODO_PADRAO,
  normalizarModo
};
