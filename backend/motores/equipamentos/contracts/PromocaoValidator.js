/**
 * PromocaoValidator — Regras de validação do contrato PromocaoDTO.
 *
 * @class PromocaoValidator
 */

const { criarResultado } = require('./validationResult');

class PromocaoValidator {
  /**
   * @param {import('./PromocaoDTO')|Object} entrada
   * @returns {import('./validationResult').ResultadoValidacao}
   */
  static validar(entrada) {
    const PromocaoDTO = require('./PromocaoDTO');
    const dto = entrada instanceof PromocaoDTO ? entrada : new PromocaoDTO(entrada || {});
    const erros = [];

    if (dto.plu === null || dto.plu === undefined || String(dto.plu).trim() === '') {
      erros.push('PLU/código é obrigatório');
    }

    if (!Number.isFinite(dto.precoPromocional) || dto.precoPromocional < 0) {
      erros.push('Preço promocional inválido');
    }

    if (dto.precoOriginal != null && (!Number.isFinite(dto.precoOriginal) || dto.precoOriginal < 0)) {
      erros.push('Preço original inválido');
    }

    if (dto.dataInicio && dto.dataFim) {
      const ini = new Date(dto.dataInicio);
      const fim = new Date(dto.dataFim);
      if (Number.isNaN(ini.getTime()) || Number.isNaN(fim.getTime())) {
        erros.push('Datas de promoção inválidas');
      } else if (ini > fim) {
        erros.push('Data início não pode ser posterior à data fim');
      }
    }

    return criarResultado(erros);
  }
}

module.exports = PromocaoValidator;
