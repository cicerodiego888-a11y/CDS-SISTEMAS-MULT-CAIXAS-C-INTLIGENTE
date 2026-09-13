/**
 * mapearItemCompra — Converte item de compra CDS para ItemIdentificavelDTO.
 *
 * @module motores/miip/utils/mapearItemCompra
 */

const ItemIdentificavelDTO = require('../contracts/ItemIdentificavelDTO');

/**
 * @param {Object} item - Item de compra (manual, XML ou persistido)
 * @returns {import('../contracts/ItemIdentificavelDTO')}
 */
function mapearItemCompraParaIdentificavel(item = {}) {
  return ItemIdentificavelDTO.create({
    produtoNome: item.produtoNome ?? item.produto_nome ?? item.descricao_produto ?? '',
    codigoBarras: item.codigoBarras ?? item.codigo_barras ?? null,
    codigoFornecedor: item.codigoFornecedor ?? item.codigo_fornecedor ?? item.codigo_produto_fornecedor ?? null,
    ncm: item.ncm ?? null,
    cest: item.cest ?? null,
    unidade: item.unidade ?? null,
    marca: item.marca ?? item.marca_nome ?? item.marcaNome ?? null,
    embalagem: item.embalagem ?? item.unidade_embalagem ?? null,
    plu: item.plu ?? null,
    codigoInterno: item.codigoInterno ?? item.codigo_interno ?? item.codigo ?? null,
    fornecedorCnpj: item.fornecedorCnpj ?? item.fornecedor_cnpj ?? null,
    fornecedorNome: item.fornecedorNome ?? item.fornecedor_nome ?? item.fornecedor ?? null,
    precoUnitario: item.precoUnitario ?? item.preco_unitario ?? null,
    produtoIdHint: item.produtoIdHint ?? item.produto_id ?? null
  });
}

module.exports = {
  mapearItemCompraParaIdentificavel
};
