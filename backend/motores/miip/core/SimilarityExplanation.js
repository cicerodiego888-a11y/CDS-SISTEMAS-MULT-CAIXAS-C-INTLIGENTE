/**
 * SimilarityExplanation — Explicação amigável da similaridade.
 *
 * Sprint 10 — Hybrid Similarity Engine v1.
 *
 * @class SimilarityExplanation
 */

class SimilarityExplanation {
  /**
   * @param {Object} [dados]
   * @param {string[]} [dados.linhas]
   * @param {string|null} [dados.texto]
   */
  constructor(dados = {}) {
    this.linhas = Array.isArray(dados.linhas) ? [...dados.linhas] : [];
    this.texto = dados.texto ?? (this.linhas.length > 0 ? this.linhas.join('\n') : '');
  }

  /**
   * @param {Object} [dados]
   * @returns {SimilarityExplanation}
   */
  static create(dados = {}) {
    return new SimilarityExplanation(dados);
  }

  /**
   * @param {string[]} linhas
   * @returns {SimilarityExplanation}
   */
  static fromLinhas(linhas = []) {
    return new SimilarityExplanation({ linhas });
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      linhas: this.linhas,
      texto: this.texto
    };
  }
}

module.exports = SimilarityExplanation;
