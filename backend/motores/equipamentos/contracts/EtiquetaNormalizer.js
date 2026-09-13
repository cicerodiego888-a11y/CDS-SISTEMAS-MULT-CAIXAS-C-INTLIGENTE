/**
 * EtiquetaNormalizer — Normalização de dados de etiqueta.
 *
 * @class EtiquetaNormalizer
 */

const EtiquetaDTO = require('./EtiquetaDTO');

class EtiquetaNormalizer {
  /**
   * @param {EtiquetaDTO|Object} entrada
   * @returns {EtiquetaDTO}
   */
  static normalizar(entrada) {
    const dto = entrada instanceof EtiquetaDTO ? entrada : new EtiquetaDTO(entrada || {});

    return new EtiquetaDTO({
      layout: String(dto.layout || 'padrao').trim().toLowerCase(),
      plu: dto.plu != null ? String(dto.plu).trim() : null,
      descricao: String(dto.descricao || '').trim(),
      preco: dto.preco != null ? Math.round(Number(dto.preco) * 100) / 100 : null,
      validade: dto.validade,
      formatoCodigoBarras: dto.formatoCodigoBarras
        ? String(dto.formatoCodigoBarras).toUpperCase()
        : null,
      extras: { ...dto.extras }
    });
  }
}

module.exports = EtiquetaNormalizer;
