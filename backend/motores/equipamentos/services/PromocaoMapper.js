/**
 * PromocaoMapper — Converte promoção do ERP em PromocaoDTO.
 *
 * Neutro em relação ao banco. Preparado para qualquer fabricante.
 *
 * @class PromocaoMapper
 */

const PromocaoDTO = require('../dto/PromocaoDTO');

class PromocaoMapper {
  /**
   * @param {Object} promocao
   * @returns {PromocaoDTO}
   */
  static toDTO(promocao = {}) {
    return new PromocaoDTO({
      plu: promocao.plu ?? promocao.produto_codigo ?? promocao.produto_id ?? null,
      precoPromocional: promocao.preco_promocional ?? promocao.precoPromocional ?? 0,
      precoOriginal: promocao.preco_original ?? promocao.precoOriginal ?? null,
      dataInicio: promocao.data_inicio ?? promocao.dataInicio ?? null,
      dataFim: promocao.data_fim ?? promocao.dataFim ?? null,
      ativa: String(promocao.status ?? '').toLowerCase() === 'ativa' || Boolean(promocao.ativa),
      extras: {}
    });
  }

  /**
   * @param {Object[]} promocoes
   * @returns {PromocaoDTO[]}
   */
  static toDTOList(promocoes = []) {
    return (promocoes || []).map((p) => PromocaoMapper.toDTO(p));
  }
}

module.exports = PromocaoMapper;
