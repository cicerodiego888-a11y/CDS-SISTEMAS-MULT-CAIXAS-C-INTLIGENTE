/**
 * Política TLS / mTLS para o SoapTransport.
 * Sprint F4 / RC1.1 — aplicada pelo TransportFactory nas requisições SOAP.
 *
 * @module services/fiscal/core/TlsPolicy
 */

class TlsPolicy {
  /**
   * @param {object} [options]
   * @param {string} [options.minVersion='TLSv1.2']
   * @param {boolean} [options.rejectUnauthorized=false]
   * @param {boolean} [options.keepAlive=false]
   */
  constructor(options = {}) {
    this.minVersion = options.minVersion || 'TLSv1.2';
    this.rejectUnauthorized = options.rejectUnauthorized === true;
    this.keepAlive = options.keepAlive === true;
    Object.freeze(this);
  }

  /**
   * Opções prontas para https.Agent (futuro).
   * @param {object} [certMaterial]
   * @param {string|Buffer} [certMaterial.key]
   * @param {string|Buffer} [certMaterial.cert]
   * @param {string} [certMaterial.servername]
   * @returns {Readonly<object>}
   */
  buildAgentOptions(certMaterial = {}) {
    return Object.freeze({
      minVersion: this.minVersion,
      rejectUnauthorized: this.rejectUnauthorized,
      keepAlive: this.keepAlive,
      key: certMaterial.key || undefined,
      cert: certMaterial.cert || undefined,
      servername: certMaterial.servername || undefined
    });
  }

  /**
   * Valida configuração TLS básica (sem abrir socket).
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate() {
    const errors = [];
    if (!this.minVersion || !/^TLSv1\.[23]$/.test(this.minVersion)) {
      errors.push(`minVersion TLS inválida (${this.minVersion}).`);
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * @returns {Readonly<object>}
   */
  toJSON() {
    return Object.freeze({
      minVersion: this.minVersion,
      rejectUnauthorized: this.rejectUnauthorized,
      keepAlive: this.keepAlive
    });
  }
}

module.exports = {
  TlsPolicy
};
