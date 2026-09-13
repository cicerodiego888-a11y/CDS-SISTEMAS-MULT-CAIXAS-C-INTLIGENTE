/**
 * EtiquetaValidator — Regras de validação do contrato EtiquetaDTO.
 *
 * @class EtiquetaValidator
 */

const { criarResultado } = require('./validationResult');

class EtiquetaValidator {
  /**
   * @param {import('./EtiquetaDTO')|Object} entrada
   * @returns {import('./validationResult').ResultadoValidacao}
   */
  static validar(entrada) {
    const EtiquetaDTO = require('./EtiquetaDTO');
    const dto = entrada instanceof EtiquetaDTO ? entrada : new EtiquetaDTO(entrada || {});
    const erros = [];

    if (!dto.layout || !String(dto.layout).trim()) {
      erros.push('Layout da etiqueta é obrigatório');
    }

    if (dto.preco != null && (!Number.isFinite(dto.preco) || dto.preco < 0)) {
      erros.push('Preço da etiqueta inválido');
    }

    if (dto.validade && Number.isNaN(Date.parse(dto.validade))) {
      erros.push('Data de validade inválida');
    }

    return criarResultado(erros);
  }
}

module.exports = EtiquetaValidator;
