/**
 * Requisição SOAP tipada / imutável.
 *
 * @module services/fiscal/core/TransportRequest
 */

const { TransportException } = require('./TransportException');
const { TransportContext } = require('./TransportContext');

/**
 * @param {object} input
 * @returns {Readonly<object>}
 */
function createTransportRequest(input) {
  if (!input || typeof input !== 'object') {
    throw TransportException.invalidRequest('TransportRequest: input inválido.');
  }

  const envelope = String(input.envelope || '');
  if (!envelope.trim()) {
    throw TransportException.invalidRequest('TransportRequest: envelope SOAP é obrigatório.');
  }

  let context = input.context || null;
  if (context && !(context instanceof TransportContext)) {
    context = TransportContext.create(context);
  }
  if (!context) {
    throw TransportException.invalidRequest('TransportRequest: context é obrigatório.');
  }

  return Object.freeze({
    context,
    envelope,
    operacao: input.operacao ? String(input.operacao) : null,
    modelo: input.modelo ? String(input.modelo) : null,
    metadata: Object.freeze({
      ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {})
    })
  });
}

class TransportRequest {
  /**
   * @param {object} input
   */
  constructor(input) {
    const req = createTransportRequest(input);
    Object.assign(this, req);
    Object.freeze(this);
  }

  /**
   * @param {object} input
   * @returns {TransportRequest}
   */
  static create(input) {
    return new TransportRequest(input);
  }

  /**
   * URL efetiva.
   * @returns {string}
   */
  getEndpoint() {
    return this.context.endpoint;
  }

  /**
   * @returns {string}
   */
  getSoapAction() {
    return this.context.soapAction;
  }
}

module.exports = {
  TransportRequest,
  createTransportRequest
};
