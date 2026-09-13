/**
 * SemanticMetadata — Metadados auxiliares de entidades semânticas.
 *
 * Sprint 7.2 — contrato de domínio.
 *
 * @class SemanticMetadata
 */

const VERSAO_PADRAO = '1.0.0';

class SemanticMetadata {
  /**
   * @param {Object} [dados]
   * @param {string} [dados.versao]
   * @param {string|null} [dados.origem]
   * @param {string|null} [dados.timestamp]
   * @param {string|null} [dados.engine]
   * @param {string|null} [dados.observacoes]
   */
  constructor(dados = {}) {
    this.versao = dados.versao ?? VERSAO_PADRAO;
    this.origem = dados.origem ?? null;
    this.timestamp = dados.timestamp ?? null;
    this.engine = dados.engine ?? null;
    this.observacoes = dados.observacoes ?? null;
  }

  /**
   * @param {Object} [dados]
   * @returns {SemanticMetadata}
   */
  static create(dados = {}) {
    return new SemanticMetadata(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      versao: this.versao,
      origem: this.origem,
      timestamp: this.timestamp,
      engine: this.engine,
      observacoes: this.observacoes
    };
  }
}

SemanticMetadata.VERSAO_PADRAO = VERSAO_PADRAO;

module.exports = SemanticMetadata;
