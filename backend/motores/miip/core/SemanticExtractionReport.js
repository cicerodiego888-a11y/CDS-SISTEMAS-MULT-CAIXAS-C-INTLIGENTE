/**
 * SemanticExtractionReport — Relatório de extração de atributos semânticos.
 *
 * Sprint 8 — Attribute Engine.
 *
 * @class SemanticExtractionReport
 */

const VERSAO_PADRAO = '1.0.0';

class SemanticExtractionReport {
  /**
   * @param {Object} [dados]
   * @param {string[]} [dados.atributosEncontrados]
   * @param {string[]} [dados.atributosNaoEncontrados]
   * @param {number} [dados.tempoProcessamento]
   * @param {number|null} [dados.confiancaMedia]
   */
  constructor(dados = {}) {
    this.atributosEncontrados = Array.isArray(dados.atributosEncontrados)
      ? [...dados.atributosEncontrados]
      : [];
    this.atributosNaoEncontrados = Array.isArray(dados.atributosNaoEncontrados)
      ? [...dados.atributosNaoEncontrados]
      : [];
    this.tempoProcessamento = dados.tempoProcessamento ?? 0;
    this.confiancaMedia = dados.confiancaMedia ?? null;
  }

  /**
   * @param {Object} [dados]
   * @returns {SemanticExtractionReport}
   */
  static create(dados = {}) {
    return new SemanticExtractionReport(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      versao: VERSAO_PADRAO,
      atributosEncontrados: this.atributosEncontrados,
      atributosNaoEncontrados: this.atributosNaoEncontrados,
      tempoProcessamento: this.tempoProcessamento,
      confiancaMedia: this.confiancaMedia
    };
  }
}

SemanticExtractionReport.VERSAO_PADRAO = VERSAO_PADRAO;

module.exports = SemanticExtractionReport;
