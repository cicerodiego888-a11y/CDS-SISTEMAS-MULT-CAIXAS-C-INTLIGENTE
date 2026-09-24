'use strict';

/**
 * Contrato de provider de consulta CNPJ.
 * Implementações devem retornar EmpresaCnpjDTO (nunca o JSON bruto da fonte).
 *
 * @module services/cadastro/providers/ICnpjProvider
 */

/**
 * @interface ICnpjProvider
 */
class ICnpjProvider {
  /**
   * @param {string} cnpjNormalizado — 14 dígitos
   * @returns {Promise<import('../contracts/EmpresaCnpjDTO')>}
   */
  async consultar(_cnpjNormalizado) {
    throw new Error('ICnpjProvider.consultar não implementado');
  }
}

module.exports = ICnpjProvider;
