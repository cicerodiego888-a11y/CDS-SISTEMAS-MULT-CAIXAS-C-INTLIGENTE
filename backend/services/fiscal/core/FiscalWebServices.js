/**
 * Porta oficial da Plataforma Fiscal — Web Services SEFAZ.
 *
 * Sprint F10 / RC1.1 — consumidores: Status + DF-e + Manifestação + Consulta
 * + Cancelamento + Autorização NFC-e.
 *
 * @module services/fiscal/core/FiscalWebServices
 */

const { WebServiceRegistry } = require('./WebServiceRegistry');
const { UrlResolver } = require('./UrlResolver');
const { SoapTransport } = require('./SoapTransport');
const { RegistryBuilder } = require('./RegistryBuilder');
const { OperationType } = require('./OperationType');
const { ModelType } = require('./ModelType');
const { EnvironmentType } = require('./EnvironmentType');
const { ENABLED_OPERATIONS } = require('./TransportEnablement');

class FiscalWebServices {
  /**
   * @param {object} [options]
   * @param {WebServiceRegistry} [options.registry]
   * @param {UrlResolver} [options.urlResolver]
   * @param {SoapTransport} [options.soapTransport]
   * @param {boolean} [options.loadOfficialCatalog=true]
   */
  constructor(options = {}) {
    const loadOfficialCatalog = options.loadOfficialCatalog !== false;

    this.registry = options.registry
      || (loadOfficialCatalog
        ? RegistryBuilder.buildOfficial()
        : new WebServiceRegistry());

    this.urlResolver = options.urlResolver || new UrlResolver(this.registry);
    this.soapTransport = options.soapTransport || new SoapTransport(options.transportOptions || {});

    if (!this.urlResolver.getRegistry()) {
      this.urlResolver.setRegistry(this.registry);
    }
  }

  /**
   * @returns {string}
   */
  getVersion() {
    return 'F10-autorizacao';
  }

  /**
   * Plataforma ativa (Status, DF-e, Manifestação, Consulta, Cancelamento, Autorização).
   * @returns {boolean}
   */
  isActive() {
    return true;
  }

  /**
   * @param {string} operacao
   * @returns {boolean}
   */
  isActiveFor(operacao) {
    return ENABLED_OPERATIONS.includes(operacao);
  }

  /**
   * @returns {string[]}
   */
  getActiveOperations() {
    return [...ENABLED_OPERATIONS];
  }

  getTypes() {
    return {
      OperationType,
      ModelType,
      EnvironmentType
    };
  }

  getRegistry() {
    return this.registry;
  }

  getUrlResolver() {
    return this.urlResolver;
  }

  getSoapTransport() {
    return this.soapTransport;
  }

  resolve(input) {
    return this.urlResolver.resolve(input);
  }

  getStatus() {
    const resolverMetrics = this.urlResolver.getMetrics
      ? this.urlResolver.getMetrics().snapshot()
      : null;
    const transportMetrics = this.soapTransport.getMetrics
      ? this.soapTransport.getMetrics().snapshot()
      : null;

    return {
      version: this.getVersion(),
      active: this.isActive(),
      activeOperations: this.getActiveOperations(),
      registrySize: this.registry.size(),
      registryEmpty: this.registry.isEmpty(),
      officialCount: RegistryBuilder.getOfficialCount(),
      resolverReady: this.urlResolver.isReady(),
      transportEnabled: ENABLED_OPERATIONS.some((op) => this.soapTransport.isEnabled(op)),
      transportEnabledFor: [...ENABLED_OPERATIONS],
      resolverMetrics,
      transportMetrics
    };
  }
}

module.exports = {
  FiscalWebServices
};
