/**
 * SimilarityVote — Voto individual na comparação de similaridade.
 *
 * Sprint 10 — Hybrid Similarity Engine v1.
 *
 * @class SimilarityVote
 */

class SimilarityVote {
  /**
   * @param {Object} [dados]
   * @param {string|null} [dados.atributo]
   * @param {number|null} [dados.peso]
   * @param {number|null} [dados.score]
   * @param {string|null} [dados.motivo]
   */
  constructor(dados = {}) {
    this.atributo = dados.atributo ?? null;
    this.peso = dados.peso ?? null;
    this.score = dados.score ?? null;
    this.motivo = dados.motivo ?? null;
  }

  /**
   * @param {Object} [dados]
   * @returns {SimilarityVote}
   */
  static create(dados = {}) {
    return new SimilarityVote(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      atributo: this.atributo,
      peso: this.peso,
      score: this.score,
      motivo: this.motivo
    };
  }
}

module.exports = SimilarityVote;
