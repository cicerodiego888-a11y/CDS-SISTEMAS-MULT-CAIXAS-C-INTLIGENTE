/**
 * DocumentoFiscalStatus — Máquina de estados RC3.7.1 (ciclo de vida NF-e).
 *
 * Estados canônicos + aliases legados (mesmo valor string) para compatibilidade
 * com serviços/testes que ainda usam nomes pré-RC3.7.1.
 *
 * @module motores/central-entradas/core/DocumentoFiscalStatus
 */

'use strict';

const DocumentoFiscalStatus = Object.freeze({
  // —— Canônicos RC3.7.1 ——
  NOVA: 'NOVA',
  RESUMO_RECEBIDO: 'RESUMO_RECEBIDO',
  XML_INDISPONIVEL: 'XML_INDISPONIVEL',
  XML_COMPLETO: 'XML_COMPLETO',
  EM_REVISAO: 'EM_REVISAO',
  PRONTA_IMPORTACAO: 'PRONTA_IMPORTACAO',
  EM_IMPORTACAO: 'EM_IMPORTACAO',
  IMPORTADA: 'IMPORTADA',
  FINALIZADA: 'FINALIZADA',
  CANCELADA: 'CANCELADA',
  DENEGADA: 'DENEGADA',
  INUTILIZADA: 'INUTILIZADA',
  ERRO: 'ERRO',

  // —— Aliases legados (mesmo valor canônico) ——
  RECEBIDA: 'NOVA',
  SINCRONIZADA: 'XML_COMPLETO',
  EM_PROCESSAMENTO: 'XML_COMPLETO',
  AGUARDANDO_REVISAO: 'EM_REVISAO',
  AGUARDANDO_XML_COMPLETO: 'RESUMO_RECEBIDO',
  XML_IMPORTADO_MANUALMENTE: 'XML_COMPLETO',
  REVISADA: 'PRONTA_IMPORTACAO',
  PRONTA_PARA_COMPRA: 'PRONTA_IMPORTACAO',
  EM_COMPRA: 'EM_IMPORTACAO',
  GRAVADA: 'IMPORTADA',
  DESCARTADA: 'FINALIZADA',
  DUPLICADA: 'IMPORTADA'
});

/** Valores únicos persistidos no banco. */
const TODOS = Object.freeze([
  DocumentoFiscalStatus.NOVA,
  DocumentoFiscalStatus.RESUMO_RECEBIDO,
  DocumentoFiscalStatus.XML_INDISPONIVEL,
  DocumentoFiscalStatus.XML_COMPLETO,
  DocumentoFiscalStatus.EM_REVISAO,
  DocumentoFiscalStatus.PRONTA_IMPORTACAO,
  DocumentoFiscalStatus.EM_IMPORTACAO,
  DocumentoFiscalStatus.IMPORTADA,
  DocumentoFiscalStatus.FINALIZADA,
  DocumentoFiscalStatus.CANCELADA,
  DocumentoFiscalStatus.DENEGADA,
  DocumentoFiscalStatus.INUTILIZADA,
  DocumentoFiscalStatus.ERRO
]);

const ESTADOS_TERMINAIS = Object.freeze([
  DocumentoFiscalStatus.FINALIZADA,
  DocumentoFiscalStatus.CANCELADA,
  DocumentoFiscalStatus.DENEGADA,
  DocumentoFiscalStatus.INUTILIZADA,
  DocumentoFiscalStatus.XML_INDISPONIVEL
]);

const LABELS_UI = Object.freeze({
  [DocumentoFiscalStatus.NOVA]: 'Nova',
  [DocumentoFiscalStatus.RESUMO_RECEBIDO]: 'Resumo recebido',
  [DocumentoFiscalStatus.XML_INDISPONIVEL]: 'XML Indisponível',
  [DocumentoFiscalStatus.XML_COMPLETO]: 'XML completo',
  [DocumentoFiscalStatus.EM_REVISAO]: 'Em revisão',
  [DocumentoFiscalStatus.PRONTA_IMPORTACAO]: 'Pronta para importação',
  [DocumentoFiscalStatus.EM_IMPORTACAO]: 'Em importação',
  [DocumentoFiscalStatus.IMPORTADA]: 'Importada',
  [DocumentoFiscalStatus.FINALIZADA]: 'Finalizada',
  [DocumentoFiscalStatus.CANCELADA]: 'Cancelada',
  [DocumentoFiscalStatus.DENEGADA]: 'Denegada',
  [DocumentoFiscalStatus.INUTILIZADA]: 'Inutilizada',
  [DocumentoFiscalStatus.ERRO]: 'Erro'
});

/** Legado literal no banco → canônico. */
const MAPA_MIGRACAO_STATUS = Object.freeze({
  RECEBIDA: DocumentoFiscalStatus.NOVA,
  SINCRONIZADA: DocumentoFiscalStatus.XML_COMPLETO,
  EM_PROCESSAMENTO: DocumentoFiscalStatus.XML_COMPLETO,
  AGUARDANDO_REVISAO: DocumentoFiscalStatus.EM_REVISAO,
  AGUARDANDO_XML_COMPLETO: DocumentoFiscalStatus.RESUMO_RECEBIDO,
  XML_IMPORTADO_MANUALMENTE: DocumentoFiscalStatus.XML_COMPLETO,
  REVISADA: DocumentoFiscalStatus.PRONTA_IMPORTACAO,
  PRONTA_PARA_COMPRA: DocumentoFiscalStatus.PRONTA_IMPORTACAO,
  EM_COMPRA: DocumentoFiscalStatus.EM_IMPORTACAO,
  GRAVADA: DocumentoFiscalStatus.IMPORTADA,
  DESCARTADA: DocumentoFiscalStatus.FINALIZADA,
  DUPLICADA: DocumentoFiscalStatus.IMPORTADA,
  XML_INDISPONIVEL: DocumentoFiscalStatus.XML_INDISPONIVEL,
  ERRO: DocumentoFiscalStatus.ERRO
});

/**
 * @param {string} status
 * @returns {string}
 */
function normalizarStatus(status) {
  const raw = String(status || '').trim();
  if (!raw) return raw;
  if (TODOS.includes(raw)) return raw;
  if (MAPA_MIGRACAO_STATUS[raw]) return MAPA_MIGRACAO_STATUS[raw];
  if (DocumentoFiscalStatus[raw]) return DocumentoFiscalStatus[raw];
  return raw;
}

/**
 * @param {string} status
 * @returns {boolean}
 */
function isValido(status) {
  return TODOS.includes(normalizarStatus(status));
}

/**
 * @param {string} status
 * @returns {boolean}
 */
function isTerminal(status) {
  return ESTADOS_TERMINAIS.includes(normalizarStatus(status));
}

/**
 * @param {string} status
 * @returns {string}
 */
function obterLabel(status) {
  const n = normalizarStatus(status);
  return LABELS_UI[n] || n || status;
}

module.exports = {
  DocumentoFiscalStatus,
  TODOS,
  ESTADOS_TERMINAIS,
  LABELS_UI,
  MAPA_MIGRACAO_STATUS,
  normalizarStatus,
  isValido,
  isTerminal,
  obterLabel
};
