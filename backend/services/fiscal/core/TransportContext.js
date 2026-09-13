/**
 * Contexto imutável de transporte SOAP.
 *
 * @module services/fiscal/core/TransportContext
 */

const { TransportException } = require('./TransportException');

/**
 * @param {object} input
 * @returns {Readonly<object>}
 */
function createTransportContext(input) {
  if (!input || typeof input !== 'object') {
    throw TransportException.invalidContext('TransportContext: input inválido.');
  }

  const endpoint = String(input.endpoint || '').trim();
  if (!endpoint) {
    throw TransportException.invalidContext('TransportContext: endpoint é obrigatório.');
  }

  return Object.freeze({
    endpoint,
    soapAction: String(input.soapAction || ''),
    namespace: String(input.namespace || ''),
    timeout: Number(input.timeout) > 0 ? Number(input.timeout) : 90000,
    tls: Object.freeze({
      minVersion: 'TLSv1.2',
      rejectUnauthorized: false,
      ...(input.tls && typeof input.tls === 'object' ? input.tls : {})
    }),
    headers: Object.freeze({
      ...(input.headers && typeof input.headers === 'object' ? input.headers : {})
    }),
    certificado: input.certificado == null ? null : String(input.certificado),
    senha: input.senha == null ? null : String(input.senha),
    metadata: Object.freeze({
      ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {})
    })
  });
}

class TransportContext {
  /**
   * @param {object} input
   */
  constructor(input) {
    const ctx = createTransportContext(input);
    Object.assign(this, ctx);
    Object.freeze(this);
  }

  /**
   * @param {object} input
   * @returns {TransportContext}
   */
  static create(input) {
    return new TransportContext(input);
  }
}

module.exports = {
  TransportContext,
  createTransportContext
};
