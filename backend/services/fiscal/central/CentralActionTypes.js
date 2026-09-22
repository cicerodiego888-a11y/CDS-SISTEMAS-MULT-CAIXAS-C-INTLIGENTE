/**
 * Catálogo de ações operacionais da Central (Sprint 5).
 * @module services/fiscal/central/CentralActionTypes
 */
'use strict';

const { ClassificacaoAcao } = require('./CentralOperationModes');

const TipoAcao = Object.freeze({
  SINCRONIZAR_DISTNSU: 'SINCRONIZAR_DISTNSU',
  RECUPERAR_XML: 'RECUPERAR_XML',
  RETRY_RECUPERAVEL: 'RETRY_RECUPERAVEL',
  REPROCESSAR_IDEMPOTENTE: 'REPROCESSAR_IDEMPOTENTE',
  EXECUTAR_RECONCILIACAO: 'EXECUTAR_RECONCILIACAO',
  ATUALIZAR_DIAGNOSTICO: 'ATUALIZAR_DIAGNOSTICO',
  PROCESSAR_DOCUMENTO_RECEBIDO: 'PROCESSAR_DOCUMENTO_RECEBIDO',
  ANALISAR_LACUNA: 'ANALISAR_LACUNA',
  REPROCESSAR_ESPECIAL: 'REPROCESSAR_ESPECIAL',
  TRATAR_INCONSISTENCIA_CHAVE: 'TRATAR_INCONSISTENCIA_CHAVE',
  TRATAR_DIVERGENCIA_CNPJ: 'TRATAR_DIVERGENCIA_CNPJ',
  ALTERAR_ULTNSU: 'ALTERAR_ULTNSU',
  RETROCEDER_CURSOR: 'RETROCEDER_CURSOR',
  EXCLUIR_DOCUMENTO: 'EXCLUIR_DOCUMENTO',
  EXCLUIR_XML: 'EXCLUIR_XML',
  ALTERAR_ESTADO_FISCAL: 'ALTERAR_ESTADO_FISCAL',
  CORRIGIR_CHAVE: 'CORRIGIR_CHAVE',
  ALTERAR_CNPJ: 'ALTERAR_CNPJ',
  DESCARTAR_DOCUMENTO: 'DESCARTAR_DOCUMENTO'
});

/** Flag granular que habilita a ação SAFE no modo AUTOMÁTICO. */
const FLAG_POR_ACAO = Object.freeze({
  [TipoAcao.SINCRONIZAR_DISTNSU]: 'sincronizacao',
  [TipoAcao.RECUPERAR_XML]: 'recuperacaoXml',
  [TipoAcao.RETRY_RECUPERAVEL]: 'retry',
  [TipoAcao.REPROCESSAR_IDEMPOTENTE]: 'retry',
  [TipoAcao.EXECUTAR_RECONCILIACAO]: 'reconcilicao',
  [TipoAcao.ATUALIZAR_DIAGNOSTICO]: 'reconcilicao',
  [TipoAcao.PROCESSAR_DOCUMENTO_RECEBIDO]: 'sincronizacao'
});

const CLASSIFICACAO_POR_ACAO = Object.freeze({
  [TipoAcao.SINCRONIZAR_DISTNSU]: ClassificacaoAcao.SAFE,
  [TipoAcao.RECUPERAR_XML]: ClassificacaoAcao.SAFE,
  [TipoAcao.RETRY_RECUPERAVEL]: ClassificacaoAcao.SAFE,
  [TipoAcao.REPROCESSAR_IDEMPOTENTE]: ClassificacaoAcao.SAFE,
  [TipoAcao.EXECUTAR_RECONCILIACAO]: ClassificacaoAcao.SAFE,
  [TipoAcao.ATUALIZAR_DIAGNOSTICO]: ClassificacaoAcao.SAFE,
  [TipoAcao.PROCESSAR_DOCUMENTO_RECEBIDO]: ClassificacaoAcao.SAFE,

  [TipoAcao.ANALISAR_LACUNA]: ClassificacaoAcao.CONFIRMATION_REQUIRED,
  [TipoAcao.REPROCESSAR_ESPECIAL]: ClassificacaoAcao.CONFIRMATION_REQUIRED,
  [TipoAcao.TRATAR_INCONSISTENCIA_CHAVE]: ClassificacaoAcao.CONFIRMATION_REQUIRED,
  [TipoAcao.TRATAR_DIVERGENCIA_CNPJ]: ClassificacaoAcao.CONFIRMATION_REQUIRED,

  [TipoAcao.ALTERAR_ULTNSU]: ClassificacaoAcao.NEVER_AUTOMATIC,
  [TipoAcao.RETROCEDER_CURSOR]: ClassificacaoAcao.NEVER_AUTOMATIC,
  [TipoAcao.EXCLUIR_DOCUMENTO]: ClassificacaoAcao.NEVER_AUTOMATIC,
  [TipoAcao.EXCLUIR_XML]: ClassificacaoAcao.NEVER_AUTOMATIC,
  [TipoAcao.ALTERAR_ESTADO_FISCAL]: ClassificacaoAcao.NEVER_AUTOMATIC,
  [TipoAcao.CORRIGIR_CHAVE]: ClassificacaoAcao.NEVER_AUTOMATIC,
  [TipoAcao.ALTERAR_CNPJ]: ClassificacaoAcao.NEVER_AUTOMATIC,
  [TipoAcao.DESCARTAR_DOCUMENTO]: ClassificacaoAcao.NEVER_AUTOMATIC
});

function classificarAcao(tipo) {
  const t = String(tipo || '').toUpperCase();
  return CLASSIFICACAO_POR_ACAO[t] || ClassificacaoAcao.CONFIRMATION_REQUIRED;
}

function flagGranular(tipo) {
  return FLAG_POR_ACAO[String(tipo || '').toUpperCase()] || null;
}

module.exports = {
  TipoAcao,
  FLAG_POR_ACAO,
  CLASSIFICACAO_POR_ACAO,
  classificarAcao,
  flagGranular
};
