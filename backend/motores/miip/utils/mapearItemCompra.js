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
function primeiroTexto(...valores) {
  for (const valor of valores) {
    if (valor == null) continue;
    const t = String(valor).trim();
    if (t) return t;
  }
  return null;
}

function mapearItemCompraParaIdentificavel(item = {}) {
  const codigoFornecedor = primeiroTexto(
    item.codigoFornecedor,
    item.codigo_fornecedor,
    item.cProd,
    item.cprod,
    item.codigo_produto_fornecedor
  );
  const codigoInternoExplicito = primeiroTexto(
    item.codigoInterno,
    item.codigo_interno,
    item.codigo_interno_cds
  );
  const codigoAvulso = primeiroTexto(item.codigo);
  const codigoInterno = codigoInternoExplicito
    || (codigoAvulso && !codigoFornecedor ? codigoAvulso : null);

  return ItemIdentificavelDTO.create({
    produtoNome: item.produtoNome ?? item.produto_nome ?? item.descricao_produto ?? '',
    codigoBarras: item.codigoBarras ?? item.codigo_barras ?? item.gtin ?? item.cEAN ?? item.cean ?? null,
    codigoFornecedor,
    ncm: item.ncm ?? null,
    cest: item.cest ?? null,
    unidade: item.unidade ?? null,
    marca: item.marca ?? item.marca_nome ?? item.marcaNome ?? null,
    embalagem: item.embalagem ?? item.unidade_embalagem ?? null,
    plu: item.plu ?? null,
    codigoInterno,
    fornecedorCnpj: item.fornecedorCnpj ?? item.fornecedor_cnpj ?? null,
    fornecedorNome: item.fornecedorNome ?? item.fornecedor_nome ?? item.fornecedor ?? null,
    precoUnitario: item.precoUnitario ?? item.preco_unitario ?? null,
    produtoIdHint: item.produtoIdHint ?? item.produto_id ?? null
  });
}

module.exports = {
  mapearItemCompraParaIdentificavel
};
