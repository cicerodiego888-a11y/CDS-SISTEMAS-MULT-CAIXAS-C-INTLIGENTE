/**
 * IdentidadeStrategyBase — contrato Strategy (Sprint 02).
 * @module motores/produto-identidade/strategies/IdentidadeStrategyBase
 */

class IdentidadeStrategyBase {
  /**
   * Nome estável da strategy (registry key).
   * @returns {string}
   */
  get nome() {
    throw new Error('Strategy deve implementar getter nome');
  }

  /**
   * Método de resolução reportado no DTO.
   * @returns {string}
   */
  get metodo() {
    return this.nome;
  }

  /**
   * @param {string} codigo
   * @param {Object} contexto
   * @param {{ candidatos?: string[] }} deteccao
   * @returns {boolean}
   */
  canHandle(codigo, contexto, deteccao) {
    void codigo;
    void contexto;
    void deteccao;
    return false;
  }

  /**
   * @param {string} codigo
   * @param {Object} contexto
   * @param {{ candidatos?: string[], digitos?: string, bruto?: string }} deteccao
   * @returns {Promise<import('../contracts/IdentidadeResultadoDTO')|null>}
   */
  async resolve(codigo, contexto, deteccao) {
    void codigo;
    void contexto;
    void deteccao;
    return null;
  }
}

module.exports = IdentidadeStrategyBase;
