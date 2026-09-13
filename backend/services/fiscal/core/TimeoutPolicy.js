/**
 * Política de timeout por operação / padrão.
 * Sprint F4 / RC1.1 — usada pelo TransportFactory / SoapTransport.
 *
 * @module services/fiscal/core/TimeoutPolicy
 */

const DEFAULT_TIMEOUT_MS = 90000;

/** Timeouts sugeridos por operação (ms). */
const OPERATION_TIMEOUTS = Object.freeze({
  AUTORIZACAO: 90000,
  RETORNO_AUTORIZACAO: 90000,
  STATUS_SERVICO: 30000,
  CANCELAMENTO: 30000,
  DISTRIBUICAO_DFE: 90000,
  MANIFESTACAO: 30000,
  MANIFESTACAO_CIENCIA: 30000,
  MANIFESTACAO_CONFIRMACAO: 30000,
  MANIFESTACAO_DESCONHECIMENTO: 30000,
  MANIFESTACAO_NAO_REALIZADA: 30000,
  CONSULTA_PROTOCOLO: 30000,
  INUTILIZACAO: 30000
});

class TimeoutPolicy {
  /**
   * @param {object} [options]
   * @param {number} [options.defaultTimeoutMs]
   * @param {Record<string, number>} [options.byOperation]
   */
  constructor(options = {}) {
    this.defaultTimeoutMs = Number(options.defaultTimeoutMs) > 0
      ? Number(options.defaultTimeoutMs)
      : DEFAULT_TIMEOUT_MS;
    this.byOperation = Object.freeze({
      ...OPERATION_TIMEOUTS,
      ...(options.byOperation && typeof options.byOperation === 'object'
        ? options.byOperation
        : {})
    });
    Object.freeze(this);
  }

  /**
   * Resolve timeout para uma operação.
   * @param {string} [operacao]
   * @param {number} [overrideMs]
   * @returns {number}
   */
  resolve(operacao, overrideMs) {
    if (Number(overrideMs) > 0) {
      return Number(overrideMs);
    }
    if (operacao && this.byOperation[operacao] > 0) {
      return this.byOperation[operacao];
    }
    return this.defaultTimeoutMs;
  }

  /**
   * @returns {Readonly<object>}
   */
  toJSON() {
    return Object.freeze({
      defaultTimeoutMs: this.defaultTimeoutMs,
      byOperation: this.byOperation
    });
  }
}

module.exports = {
  TimeoutPolicy,
  OPERATION_TIMEOUTS,
  DEFAULT_TIMEOUT_MS
};
