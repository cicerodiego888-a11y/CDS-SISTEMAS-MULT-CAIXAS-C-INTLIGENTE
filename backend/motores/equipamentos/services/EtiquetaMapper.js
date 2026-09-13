/**
 * EtiquetaMapper — Converte dados de etiqueta do ERP em EtiquetaDTO.
 *
 * Neutro em relação ao banco. Preparado para qualquer fabricante.
 *
 * @class EtiquetaMapper
 */

const EtiquetaDTO = require('../dto/EtiquetaDTO');

class EtiquetaMapper {
  /**
   * @param {Object} dados
   * @returns {EtiquetaDTO}
   */
  static toDTO(dados = {}) {
    return new EtiquetaDTO({
      layout: dados.layout ?? 'padrao',
      plu: dados.plu ?? dados.codigo ?? dados.produto_id ?? null,
      descricao: dados.nome ?? dados.descricao ?? '',
      preco: dados.preco_venda ?? dados.preco ?? null,
      validade: dados.data_validade ?? dados.validade ?? null,
      formatoCodigoBarras: dados.formatoCodigoBarras ?? 'EAN13',
      extras: {}
    });
  }

  /**
   * @param {Object[]} lista
   * @returns {EtiquetaDTO[]}
   */
  static toDTOList(lista = []) {
    return (lista || []).map((d) => EtiquetaMapper.toDTO(d));
  }
}

module.exports = EtiquetaMapper;
