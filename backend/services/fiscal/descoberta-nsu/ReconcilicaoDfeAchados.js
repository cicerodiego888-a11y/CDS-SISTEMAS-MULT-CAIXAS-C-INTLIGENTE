/**
 * Códigos de achados da reconciliação (Sprint 4) — somente diagnóstico.
 * @module services/fiscal/descoberta-nsu/ReconcilicaoDfeAchados
 */
'use strict';

const { ReconcilicaoStatus } = require('./ReconcilicaoDfeStatus');

const AchadoCodigo = Object.freeze({
  POSSIVEL_LACUNA_NSU: 'POSSIVEL_LACUNA_NSU',
  DUPLICIDADE_NSU: 'DUPLICIDADE_NSU',
  DUPLICIDADE_CHAVE: 'DUPLICIDADE_CHAVE',
  XML_PENDENTE: 'XML_PENDENTE',
  XML_OK: 'XML_OK',
  XML_ERRO: 'XML_ERRO',
  DOCUMENTOS_POSTERIORES_DISPONIVEIS: 'DOCUMENTOS_POSTERIORES_DISPONIVEIS',
  SEM_DIFERENCA_DE_CURSOR: 'SEM_DIFERENCA_DE_CURSOR',
  CURSOR_REGRESSAO_DETECTADA: 'CURSOR_REGRESSAO_DETECTADA',
  SALTO_NSU_OBSERVADO: 'SALTO_NSU_OBSERVADO',
  LOTE_SEM_DOCUMENTOS: 'LOTE_SEM_DOCUMENTOS',
  BLOQUEIO_SEFAZ_REGISTRADO: 'BLOQUEIO_SEFAZ_REGISTRADO',
  DOCUMENTO_NSU_SEM_PERSISTENCIA: 'DOCUMENTO_NSU_SEM_PERSISTENCIA',
  DOCUMENTO_SEM_CHAVE: 'DOCUMENTO_SEM_CHAVE',
  XML_SEM_DOCUMENTO: 'XML_SEM_DOCUMENTO',
  INCONSISTENCIA_CHAVE_XML: 'INCONSISTENCIA_CHAVE_XML',
  INCONSISTENCIA_CNPJ_XML: 'INCONSISTENCIA_CNPJ_XML'
});

/** Severidade sugerida por achado (não altera dados). */
const ACHADO_SEVERIDADE = Object.freeze({
  [AchadoCodigo.POSSIVEL_LACUNA_NSU]: ReconcilicaoStatus.ATENCAO,
  [AchadoCodigo.DUPLICIDADE_NSU]: ReconcilicaoStatus.ATENCAO,
  [AchadoCodigo.DUPLICIDADE_CHAVE]: ReconcilicaoStatus.ATENCAO,
  [AchadoCodigo.XML_PENDENTE]: ReconcilicaoStatus.ATENCAO,
  [AchadoCodigo.XML_OK]: ReconcilicaoStatus.CONSISTENTE,
  [AchadoCodigo.XML_ERRO]: ReconcilicaoStatus.ATENCAO,
  [AchadoCodigo.DOCUMENTOS_POSTERIORES_DISPONIVEIS]: ReconcilicaoStatus.ATENCAO,
  [AchadoCodigo.SEM_DIFERENCA_DE_CURSOR]: ReconcilicaoStatus.CONSISTENTE,
  [AchadoCodigo.CURSOR_REGRESSAO_DETECTADA]: ReconcilicaoStatus.INCONSISTENTE,
  [AchadoCodigo.SALTO_NSU_OBSERVADO]: ReconcilicaoStatus.ATENCAO,
  [AchadoCodigo.LOTE_SEM_DOCUMENTOS]: ReconcilicaoStatus.CONSISTENTE,
  [AchadoCodigo.BLOQUEIO_SEFAZ_REGISTRADO]: ReconcilicaoStatus.ATENCAO,
  [AchadoCodigo.DOCUMENTO_NSU_SEM_PERSISTENCIA]: ReconcilicaoStatus.INCONSISTENTE,
  [AchadoCodigo.DOCUMENTO_SEM_CHAVE]: ReconcilicaoStatus.INCONSISTENTE,
  [AchadoCodigo.XML_SEM_DOCUMENTO]: ReconcilicaoStatus.INCONSISTENTE,
  [AchadoCodigo.INCONSISTENCIA_CHAVE_XML]: ReconcilicaoStatus.INCONSISTENTE,
  [AchadoCodigo.INCONSISTENCIA_CNPJ_XML]: ReconcilicaoStatus.INCONSISTENTE
});

function criarAchado(codigo, detalhe = {}) {
  const c = String(codigo || '').toUpperCase();
  return {
    codigo: c,
    severidade: ACHADO_SEVERIDADE[c] || ReconcilicaoStatus.ATENCAO,
    ...detalhe
  };
}

module.exports = {
  AchadoCodigo,
  ACHADO_SEVERIDADE,
  criarAchado
};
