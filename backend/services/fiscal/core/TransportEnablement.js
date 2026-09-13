/**
 * Política de habilitação do SoapTransport por operação.
 * Plataforma Fiscal RC1 (F5–F10) + consolidação RC1.1.
 *
 * @module services/fiscal/core/TransportEnablement
 */

const { OperationType } = require('./OperationType');

/**
 * Operações com transporte enterprise ativo.
 *
 * Reservadas (enablement sem runtime dedicado de negócio):
 * - MANIFESTACAO — guarda-chuva; runtime exige subtipo (CIENCIA/CONFIRMACAO/…)
 * - RETORNO_AUTORIZACAO — contrato no Registry; CDS usa indSinc=1 (sem runtime ainda)
 */
const ENABLED_OPERATIONS = Object.freeze([
  OperationType.STATUS_SERVICO,
  OperationType.DISTRIBUICAO_DFE,
  OperationType.MANIFESTACAO,
  OperationType.MANIFESTACAO_CIENCIA,
  OperationType.MANIFESTACAO_CONFIRMACAO,
  OperationType.MANIFESTACAO_DESCONHECIMENTO,
  OperationType.MANIFESTACAO_NAO_REALIZADA,
  OperationType.CONSULTA_PROTOCOLO,
  OperationType.CANCELAMENTO,
  OperationType.AUTORIZACAO,
  OperationType.RETORNO_AUTORIZACAO
]);

/** Operações habilitadas mas sem runtime de negócio dedicado. */
const RESERVED_OPERATIONS = Object.freeze([
  OperationType.MANIFESTACAO,
  OperationType.RETORNO_AUTORIZACAO
]);

/**
 * @param {string} [operacao]
 * @returns {boolean}
 */
function isTransportEnabledFor(operacao) {
  return Boolean(operacao && ENABLED_OPERATIONS.includes(operacao));
}

/**
 * @param {string} [operacao]
 * @returns {boolean}
 */
function isReservedOperation(operacao) {
  return Boolean(operacao && RESERVED_OPERATIONS.includes(operacao));
}

module.exports = {
  ENABLED_OPERATIONS,
  RESERVED_OPERATIONS,
  isTransportEnabledFor,
  isReservedOperation
};
