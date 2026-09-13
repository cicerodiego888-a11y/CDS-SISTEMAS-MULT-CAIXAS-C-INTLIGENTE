/**
 * DecisionStatistics — Métricas da decisão MIIP.
 *
 * Sprint 11 — Fase 2 Inteligência.
 *
 * @class DecisionStatistics
 */

class DecisionStatistics {
  /**
   * @param {Object} [dados]
   * @param {number} [dados.quantidadeRegrasAvaliadas]
   * @param {number} [dados.tempo]
   * @param {string|null} [dados.regraVencedora]
   */
  constructor(dados = {}) {
    this.quantidadeRegrasAvaliadas = dados.quantidadeRegrasAvaliadas ?? 0;
    this.tempo = dados.tempo ?? 0;
    this.regraVencedora = dados.regraVencedora ?? null;
  }

  /**
   * @param {Object} [dados]
   * @returns {DecisionStatistics}
   */
  static create(dados = {}) {
    return new DecisionStatistics(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      quantidadeRegrasAvaliadas: this.quantidadeRegrasAvaliadas,
      tempo: this.tempo,
      regraVencedora: this.regraVencedora
    };
  }
}

module.exports = DecisionStatistics;
