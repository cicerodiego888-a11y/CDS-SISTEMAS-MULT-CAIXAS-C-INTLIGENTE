/**
 * ProdutoMapper — Converte produto do ERP em ProdutoDTO.
 *
 * Recebe um objeto genérico (vindo de qualquer camada superior) e produz um DTO
 * neutro, sem qualquer dependência de SQLite. Preparado para múltiplos fabricantes.
 *
 * @class ProdutoMapper
 */

const ProdutoDTO = require('../dto/ProdutoDTO');

function ehPesavel(produto) {
  return Number(produto.produto_fracionado ?? produto.vendido_por_peso ?? 0) === 1
    || String(produto.unidade || '').toLowerCase() === 'kg';
}

class ProdutoMapper {
  /**
   * @param {Object} produto - Objeto de produto do ERP (já lido pela camada superior)
   * @returns {ProdutoDTO}
   */
  static toDTO(produto = {}) {
    return new ProdutoDTO({
      plu: produto.plu ?? produto.codigo ?? produto.id,
      codigoInterno: produto.codigo ?? produto.id ?? null,
      codigoBarras: produto.codigo_barras ?? produto.codigoBarras ?? null,
      descricao: produto.nome ?? produto.descricao ?? '',
      descricaoReduzida: (produto.nome ?? '').slice(0, 22),
      preco: produto.preco_venda ?? produto.preco ?? 0,
      unidade: produto.unidade ?? 'kg',
      pesavel: ehPesavel(produto),
      validadeDias: produto.dias_alerta_validade ?? null,
      departamento: produto.categoria_id ?? null,
      extras: {}
    });
  }

  /**
   * @param {Object[]} produtos
   * @returns {ProdutoDTO[]}
   */
  static toDTOList(produtos = []) {
    return (produtos || []).map((p) => ProdutoMapper.toDTO(p));
  }
}

module.exports = ProdutoMapper;
