/**
 * Exceções oficiais da camada de transporte SOAP.
 *
 * @module services/fiscal/core/TransportException
 */

const TransportErrorCode = Object.freeze({
  INVALID_CONTEXT: 'INVALID_CONTEXT',
  INVALID_REQUEST: 'INVALID_REQUEST',
  DISABLED: 'DISABLED',
  TIMEOUT: 'TIMEOUT',
  TLS_ERROR: 'TLS_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  RETRY_EXHAUSTED: 'RETRY_EXHAUSTED'
});

class TransportException extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TransportException';
    this.code = code;
    this.details = Object.freeze({ ...details });
    Error.captureStackTrace?.(this, TransportException);
  }

  static invalidContext(message, details) {
    return new TransportException(TransportErrorCode.INVALID_CONTEXT, message, details);
  }

  static invalidRequest(message, details) {
    return new TransportException(TransportErrorCode.INVALID_REQUEST, message, details);
  }

  static disabled(message, details) {
    return new TransportException(
      TransportErrorCode.DISABLED,
      message || 'SoapTransport está desabilitado (isEnabled === false).',
      details
    );
  }

  static timeout(message, details) {
    return new TransportException(TransportErrorCode.TIMEOUT, message, details);
  }

  static tlsError(message, details) {
    return new TransportException(TransportErrorCode.TLS_ERROR, message, details);
  }

  static retryExhausted(message, details) {
    return new TransportException(TransportErrorCode.RETRY_EXHAUSTED, message, details);
  }

  static isTransportException(error) {
    return error instanceof TransportException;
  }
}

module.exports = {
  TransportException,
  TransportErrorCode
};
