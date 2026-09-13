/**
 * ProdutoNormalizer — Normalização de dados de produto antes do envio ao driver.
 *
 * @class ProdutoNormalizer
 */

const ProdutoDTO = require('./ProdutoDTO');

const DESCRICAO_REDUZIDA_MAX = 22;

class ProdutoNormalizer {
  /**
   * @param {ProdutoDTO|Object} entrada
   * @returns {ProdutoDTO}
   */
  static normalizar(entrada) {
    const dto = entrada instanceof ProdutoDTO ? entrada : new ProdutoDTO(entrada || {});

    const descricao = String(dto.descricao || '').trim();
    let descricaoReduzida = String(dto.descricaoReduzida || descricao).trim();
    if (descricaoReduzida.length > DESCRICAO_REDUZIDA_MAX) {
      descricaoReduzida = descricaoReduzida.slice(0, DESCRICAO_REDUZIDA_MAX);
    }

    return new ProdutoDTO({
      plu: dto.plu != null ? String(dto.plu).trim() : null,
      codigoInterno: dto.codigoInterno,
      codigoBarras: dto.codigoBarras ? String(dto.codigoBarras).replace(/\D/g, '') : null,
      descricao,
      descricaoReduzida,
      preco: Math.round(Number(dto.preco) * 100) / 100,
      unidade: String(dto.unidade || 'kg').toLowerCase(),
      pesavel: Boolean(dto.pesavel),
      validadeDias: dto.validadeDias,
      departamento: dto.departamento != null ? String(dto.departamento) : null,
      tara: dto.tara,
      extras: { ...dto.extras }
    });
  }
}

module.exports = ProdutoNormalizer;
