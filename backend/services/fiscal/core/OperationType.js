/**
 * Tipos oficiais de operação dos Web Services fiscais SEFAZ.
 *
 * Sprint F2 / RC1.1 — enums usados pelos runtimes da Plataforma Fiscal.
 *
 * @module services/fiscal/core/OperationType
 */

const OperationType = Object.freeze({
  AUTORIZACAO: 'AUTORIZACAO',
  RETORNO: 'RETORNO',
  RETORNO_AUTORIZACAO: 'RETORNO_AUTORIZACAO',
  STATUS: 'STATUS',
  STATUS_SERVICO: 'STATUS_SERVICO',
  CANCELAMENTO: 'CANCELAMENTO',
  DISTRIBUICAO_DFE: 'DISTRIBUICAO_DFE',
  MANIFESTACAO: 'MANIFESTACAO',
  MANIFESTACAO_CIENCIA: 'MANIFESTACAO_CIENCIA',
  MANIFESTACAO_CONFIRMACAO: 'MANIFESTACAO_CONFIRMACAO',
  MANIFESTACAO_DESCONHECIMENTO: 'MANIFESTACAO_DESCONHECIMENTO',
  MANIFESTACAO_NAO_REALIZADA: 'MANIFESTACAO_NAO_REALIZADA',
  CONSULTA_PROTOCOLO: 'CONSULTA_PROTOCOLO',
  INUTILIZACAO: 'INUTILIZACAO'
});

/**
 * Códigos de evento SEFAZ para manifestações (quando aplicável).
 * @type {Readonly<Record<string, string>>}
 */
const ManifestacaoEventoCode = Object.freeze({
  [OperationType.MANIFESTACAO_CIENCIA]: '210210',
  [OperationType.MANIFESTACAO_CONFIRMACAO]: '210200',
  [OperationType.MANIFESTACAO_DESCONHECIMENTO]: '210220',
  [OperationType.MANIFESTACAO_NAO_REALIZADA]: '210240'
});

/**
 * @param {string} value
 * @returns {boolean}
 */
function isOperationType(value) {
  return Object.prototype.hasOwnProperty.call(OperationType, value);
}

/**
 * @returns {string[]}
 */
function listOperationTypes() {
  return Object.values(OperationType);
}

/**
 * @param {string} operationType
 * @returns {string|null}
 */
function getManifestacaoEventoCode(operationType) {
  return ManifestacaoEventoCode[operationType] || null;
}

/**
 * Manifestação do Destinatário (guarda-chuva ou subtipos).
 * @param {string} operationType
 * @returns {boolean}
 */
function isManifestacaoOperation(operationType) {
  if (!operationType) return false;
  if (operationType === OperationType.MANIFESTACAO) return true;
  return Object.prototype.hasOwnProperty.call(ManifestacaoEventoCode, operationType);
}

module.exports = {
  OperationType,
  ManifestacaoEventoCode,
  isOperationType,
  listOperationTypes,
  getManifestacaoEventoCode,
  isManifestacaoOperation
};
