/**
 * ItemIdentificavelDTO — Contrato de entrada para identificação de produto.
 *
 * @class ItemIdentificavelDTO
 */

class ItemIdentificavelDTO {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.produtoNome = dados.produtoNome ?? dados.produto_nome ?? '';
    this.codigoBarras = dados.codigoBarras ?? dados.codigo_barras ?? null;
    this.codigoFornecedor = dados.codigoFornecedor ?? dados.codigo_fornecedor ?? null;
    this.ncm = dados.ncm ?? null;
    this.cest = dados.cest ?? null;
    this.unidade = dados.unidade ?? null;
    this.marca = dados.marca ?? dados.marcaNome ?? dados.marca_nome ?? null;
    this.marcaNome = this.marca;
    this.embalagem = dados.embalagem ?? dados.unidadeEmbalagem ?? null;
    this.plu = dados.plu ?? null;
    this.codigoInterno = dados.codigoInterno ?? dados.codigo_interno ?? dados.codigo ?? null;
    this.codigo = dados.codigo ?? this.codigoInterno;
    this.fornecedorCnpj = dados.fornecedorCnpj ?? dados.fornecedor_cnpj ?? null;
    this.fornecedorNome = dados.fornecedorNome ?? dados.fornecedor_nome ?? null;
    this.precoUnitario = dados.precoUnitario ?? dados.preco_unitario ?? null;
    this.produtoIdHint = dados.produtoIdHint ?? dados.produto_id_hint ?? null;
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {ItemIdentificavelDTO}
   */
  static create(plain) {
    return new ItemIdentificavelDTO(plain || {});
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      produtoNome: this.produtoNome,
      codigoBarras: this.codigoBarras,
      codigoFornecedor: this.codigoFornecedor,
      ncm: this.ncm,
      cest: this.cest,
      unidade: this.unidade,
      marca: this.marca,
      marcaNome: this.marcaNome,
      embalagem: this.embalagem,
      plu: this.plu,
      codigoInterno: this.codigoInterno,
      codigo: this.codigo,
      fornecedorCnpj: this.fornecedorCnpj,
      fornecedorNome: this.fornecedorNome,
      precoUnitario: this.precoUnitario,
      produtoIdHint: this.produtoIdHint
    };
  }
}

module.exports = ItemIdentificavelDTO;
