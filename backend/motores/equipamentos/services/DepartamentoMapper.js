/**
 * DepartamentoMapper — Converte categoria/subcategoria do ERP em DepartamentoDTO.
 *
 * Neutro em relação ao banco. Preparado para qualquer fabricante.
 *
 * @class DepartamentoMapper
 */

const DepartamentoDTO = require('../dto/DepartamentoDTO');

class DepartamentoMapper {
  /**
   * @param {Object} categoria
   * @returns {DepartamentoDTO}
   */
  static toDTO(categoria = {}) {
    return new DepartamentoDTO({
      codigo: categoria.codigo ?? categoria.id ?? null,
      nome: categoria.nome ?? categoria.descricao ?? '',
      origemId: categoria.id ?? null,
      origemTipo: categoria.subcategoria_id || categoria.categoria_id ? 'subcategoria' : 'categoria',
      extras: {}
    });
  }

  /**
   * @param {Object[]} categorias
   * @returns {DepartamentoDTO[]}
   */
  static toDTOList(categorias = []) {
    return (categorias || []).map((c) => DepartamentoMapper.toDTO(c));
  }
}

module.exports = DepartamentoMapper;
