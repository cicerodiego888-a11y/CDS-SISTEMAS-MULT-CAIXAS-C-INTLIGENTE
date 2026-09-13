/**
 * SimilarityStatistics — Métricas da comparação de similaridade.
 *
 * Sprint 10 — Hybrid Similarity Engine v1.
 *
 * @class SimilarityStatistics
 */

class SimilarityStatistics {
  /**
   * @param {Object} [dados]
   * @param {number} [dados.quantidadeAtributosComparados]
   * @param {number} [dados.quantidadeIguais]
   * @param {number} [dados.quantidadeDiferentes]
   * @param {number} [dados.tempo]
   */
  constructor(dados = {}) {
    this.quantidadeAtributosComparados = dados.quantidadeAtributosComparados ?? 0;
    this.quantidadeIguais = dados.quantidadeIguais ?? 0;
    this.quantidadeDiferentes = dados.quantidadeDiferentes ?? 0;
    this.tempo = dados.tempo ?? 0;
  }

  /**
   * @param {Object} [dados]
   * @returns {SimilarityStatistics}
   */
  static create(dados = {}) {
    return new SimilarityStatistics(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      quantidadeAtributosComparados: this.quantidadeAtributosComparados,
      quantidadeIguais: this.quantidadeIguais,
      quantidadeDiferentes: this.quantidadeDiferentes,
      tempo: this.tempo
    };
  }
}

module.exports = SimilarityStatistics;
