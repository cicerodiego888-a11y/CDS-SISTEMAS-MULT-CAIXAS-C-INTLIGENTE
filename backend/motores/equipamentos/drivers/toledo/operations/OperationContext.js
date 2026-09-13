/**
 * Sprint 14.6 — OperationContext
 */

'use strict';

class OperationContext {
  /**
   * @param {object} dados
   */
  constructor(dados = {}) {
    this.host = String(dados.host || '');
    this.porta = Number(dados.porta) || 0;
    this.driver = dados.driver || null; // instância ToledoPrixIVDriver
    this.driverCode = dados.driverCode || 'TOLEDO_PRIX4';
    this.session = dados.session || null;
    /** Referência lógica — nunca TcpConnection direta nas operações */
    this.connection = dados.connection || null;
    this.meta = dados.meta || {};
  }

  chave() {
    return `${this.host}:${this.porta}`;
  }
}

module.exports = OperationContext;
module.exports.OperationContext = OperationContext;
