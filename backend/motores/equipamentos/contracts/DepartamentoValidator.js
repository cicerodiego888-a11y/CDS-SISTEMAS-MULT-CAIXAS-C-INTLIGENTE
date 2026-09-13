/**
 * DepartamentoValidator — Regras de validação do contrato DepartamentoDTO.
 *
 * @class DepartamentoValidator
 */

const { criarResultado } = require('./validationResult');

const ORIGENS_VALIDAS = ['categoria', 'subcategoria'];

class DepartamentoValidator {
  /**
   * @param {import('./DepartamentoDTO')|Object} entrada
   * @returns {import('./validationResult').ResultadoValidacao}
   */
  static validar(entrada) {
    const DepartamentoDTO = require('./DepartamentoDTO');
    const dto = entrada instanceof DepartamentoDTO ? entrada : new DepartamentoDTO(entrada || {});
    const erros = [];

    if (dto.codigo === null || dto.codigo === undefined || String(dto.codigo).trim() === '') {
      erros.push('Código do departamento é obrigatório');
    }

    if (!dto.nome || !String(dto.nome).trim()) {
      erros.push('Nome do departamento é obrigatório');
    }

    if (dto.origemTipo && !ORIGENS_VALIDAS.includes(dto.origemTipo)) {
      erros.push(`Tipo de origem inválido: ${dto.origemTipo}`);
    }

    return criarResultado(erros);
  }
}

module.exports = DepartamentoValidator;
