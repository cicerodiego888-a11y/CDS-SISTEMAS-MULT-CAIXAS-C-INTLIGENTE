/**
 * SynonymReport — Relatório de enriquecimento por sinônimos.
 *
 * Sprint 9 — Synonym Engine.
 *
 * @class SynonymReport
 */

class SynonymReport {
  /**
   * @param {Object} [dados]
   * @param {number} [dados.quantidadeSinonimosEncontrados]
   * @param {number} [dados.tempo]
   * @param {string[]} [dados.categoriasUtilizadas]
   */
  constructor(dados = {}) {
    this.quantidadeSinonimosEncontrados = dados.quantidadeSinonimosEncontrados ?? 0;
    this.tempo = dados.tempo ?? 0;
    this.categoriasUtilizadas = Array.isArray(dados.categoriasUtilizadas)
      ? [...dados.categoriasUtilizadas]
      : [];
  }

  /**
   * @param {Object} [dados]
   * @returns {SynonymReport}
   */
  static create(dados = {}) {
    return new SynonymReport(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      quantidadeSinonimosEncontrados: this.quantidadeSinonimosEncontrados,
      tempo: this.tempo,
      categoriasUtilizadas: this.categoriasUtilizadas
    };
  }
}

module.exports = SynonymReport;
