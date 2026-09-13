/**
 * CanonicalStatistics — Métricas do processamento canônico.
 *
 * Sprint 7.1
 *
 * @class CanonicalStatistics
 */

class CanonicalStatistics {
  /**
   * @param {Object} [dados]
   * @param {number} [dados.quantidadeTokens]
   * @param {number} [dados.quantidadePalavras]
   * @param {number} [dados.quantidadeMedidas]
   * @param {number} [dados.quantidadeMarcas]
   * @param {number} [dados.tempoProcessamento]
   */
  constructor(dados = {}) {
    this.quantidadeTokens = dados.quantidadeTokens ?? 0;
    this.quantidadePalavras = dados.quantidadePalavras ?? 0;
    this.quantidadeMedidas = dados.quantidadeMedidas ?? 0;
    this.quantidadeMarcas = dados.quantidadeMarcas ?? 0;
    this.tempoProcessamento = dados.tempoProcessamento ?? 0;
  }

  /**
   * @param {Object} dados
   * @returns {CanonicalStatistics}
   */
  static create(dados = {}) {
    return new CanonicalStatistics(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      quantidadeTokens: this.quantidadeTokens,
      quantidadePalavras: this.quantidadePalavras,
      quantidadeMedidas: this.quantidadeMedidas,
      quantidadeMarcas: this.quantidadeMarcas,
      tempoProcessamento: this.tempoProcessamento
    };
  }
}

module.exports = CanonicalStatistics;
