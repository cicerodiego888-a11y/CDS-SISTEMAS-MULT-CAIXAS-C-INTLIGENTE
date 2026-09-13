/**
 * DocumentoFiscalDetalheDTO — Contrato de detalhe do documento fiscal.
 *
 * @class DocumentoFiscalDetalheDTO
 */

class DocumentoFiscalDetalheDTO {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.documento = dados.documento ?? null;
    this.historico = dados.historico ?? [];
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {DocumentoFiscalDetalheDTO}
   */
  static create(plain) {
    return new DocumentoFiscalDetalheDTO(plain || {});
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      documento: this.documento,
      historico: this.historico
    };
  }
}

module.exports = DocumentoFiscalDetalheDTO;
