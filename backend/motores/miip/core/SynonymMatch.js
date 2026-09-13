/**
 * SynonymMatch — Correspondência de sinônimo encontrada em SemanticProduct.
 *
 * Sprint 9 — Synonym Engine.
 *
 * @class SynonymMatch
 */

class SynonymMatch {
  /**
   * @param {Object} [dados]
   * @param {string|null} [dados.original]
   * @param {string|null} [dados.sinonimo]
   * @param {string|null} [dados.categoria]
   * @param {number|null} [dados.confianca]
   * @param {string|null} [dados.origem]
   */
  constructor(dados = {}) {
    this.original = dados.original ?? null;
    this.sinonimo = dados.sinonimo ?? null;
    this.categoria = dados.categoria ?? null;
    this.confianca = dados.confianca ?? null;
    this.origem = dados.origem ?? null;
  }

  /**
   * @param {Object} [dados]
   * @returns {SynonymMatch}
   */
  static create(dados = {}) {
    return new SynonymMatch(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      original: this.original,
      sinonimo: this.sinonimo,
      categoria: this.categoria,
      confianca: this.confianca,
      origem: this.origem
    };
  }
}

module.exports = SynonymMatch;
