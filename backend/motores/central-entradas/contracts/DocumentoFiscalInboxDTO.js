/**
 * DocumentoFiscalInboxDTO — Contrato de listagem do inbox fiscal.
 *
 * @class DocumentoFiscalInboxDTO
 */

class DocumentoFiscalInboxDTO {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.id = dados.id ?? null;
    this.chave = dados.chave ?? '';
    this.numero = dados.numero ?? null;
    this.serie = dados.serie ?? null;
    this.fornecedor = dados.fornecedor ?? null;
    this.cnpjFornecedor = dados.cnpjFornecedor ?? dados.cnpj_fornecedor ?? null;
    this.dataEmissao = dados.dataEmissao ?? dados.data_emissao ?? null;
    this.valorTotal = dados.valorTotal ?? dados.valor_total ?? null;
    this.status = dados.status ?? null;
    this.tipoDocumento = dados.tipoDocumento ?? dados.tipo_documento ?? null;
    this.origem = dados.origem ?? null;
    this.compraId = dados.compraId ?? dados.compra_id ?? null;
    this.createdAt = dados.createdAt ?? dados.created_at ?? null;
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {DocumentoFiscalInboxDTO}
   */
  static create(plain) {
    return new DocumentoFiscalInboxDTO(plain || {});
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      chave: this.chave,
      numero: this.numero,
      serie: this.serie,
      fornecedor: this.fornecedor,
      cnpjFornecedor: this.cnpjFornecedor,
      dataEmissao: this.dataEmissao,
      valorTotal: this.valorTotal,
      status: this.status,
      tipoDocumento: this.tipoDocumento,
      origem: this.origem,
      compraId: this.compraId,
      createdAt: this.createdAt
    };
  }
}

module.exports = DocumentoFiscalInboxDTO;
