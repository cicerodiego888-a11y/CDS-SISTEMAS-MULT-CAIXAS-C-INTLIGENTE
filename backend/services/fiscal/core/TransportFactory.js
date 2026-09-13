/**
 * Factory para construir TransportContext a partir de contratos / resolução.
 * Sprint F4 / RC1.1 — integrada aos runtimes via SoapTransport.
 *
 * @module services/fiscal/core/TransportFactory
 */

const { TransportContext } = require('./TransportContext');
const { TransportRequest } = require('./TransportRequest');
const { TimeoutPolicy } = require('./TimeoutPolicy');
const { TlsPolicy } = require('./TlsPolicy');
const { TransportException } = require('./TransportException');

class TransportFactory {
  /**
   * @param {object} [options]
   * @param {TimeoutPolicy} [options.timeoutPolicy]
   * @param {TlsPolicy} [options.tlsPolicy]
   */
  constructor(options = {}) {
    this.timeoutPolicy = options.timeoutPolicy || new TimeoutPolicy();
    this.tlsPolicy = options.tlsPolicy || new TlsPolicy();
  }

  /**
   * Monta TransportContext a partir de WebServiceDefinition + certificado.
   *
   * @param {object} params
   * @param {object} params.definition WebServiceDefinition / ResolutionResult.definition
   * @param {string} [params.certificado]
   * @param {string} [params.senha]
   * @param {object} [params.metadata]
   * @param {number} [params.timeoutOverride]
   * @returns {TransportContext}
   */
  createContext(params = {}) {
    const definition = params.definition;
    if (!definition || typeof definition !== 'object') {
      throw TransportException.invalidContext(
        'TransportFactory.createContext: definition é obrigatória.'
      );
    }
    if (!definition.endpoint) {
      throw TransportException.invalidContext(
        'TransportFactory.createContext: definition.endpoint é obrigatório.'
      );
    }

    const operacao = definition.operacao || params.operacao;
    const timeout = this.timeoutPolicy.resolve(operacao, params.timeoutOverride || definition.timeout);
    const tlsFromDef = definition.tls && typeof definition.tls === 'object' ? definition.tls : {};
    const tls = {
      ...this.tlsPolicy.toJSON(),
      ...tlsFromDef
    };

    const headers = {
      ...(definition.headers && typeof definition.headers === 'object' ? definition.headers : {})
    };
    if (definition.soapAction && !headers['Content-Type']) {
      headers['Content-Type'] =
        `application/soap+xml; charset=utf-8; action="${definition.soapAction}"`;
    }

    return TransportContext.create({
      endpoint: definition.endpoint,
      soapAction: definition.soapAction || '',
      namespace: definition.namespace || '',
      timeout,
      tls,
      headers,
      certificado: params.certificado || null,
      senha: params.senha || null,
      metadata: {
        modelo: definition.modelo || null,
        operacao: operacao || null,
        ambiente: definition.ambiente || null,
        uf: definition.uf || null,
        ...(params.metadata || {})
      }
    });
  }

  /**
   * Monta TransportRequest completo.
   *
   * @param {object} params
   * @param {object} [params.definition]
   * @param {import('./TransportContext').TransportContext} [params.context]
   * @param {string} params.envelope
   * @param {string} [params.certificado]
   * @param {string} [params.senha]
   * @param {object} [params.metadata]
   * @returns {TransportRequest}
   */
  createRequest(params = {}) {
    const context = params.context
      || this.createContext({
        definition: params.definition,
        certificado: params.certificado,
        senha: params.senha,
        metadata: params.metadata,
        timeoutOverride: params.timeoutOverride
      });

    return TransportRequest.create({
      context,
      envelope: params.envelope,
      operacao: params.operacao || params.definition?.operacao || context.metadata.operacao,
      modelo: params.modelo || params.definition?.modelo || context.metadata.modelo,
      metadata: params.metadata || {}
    });
  }
}

module.exports = {
  TransportFactory
};
