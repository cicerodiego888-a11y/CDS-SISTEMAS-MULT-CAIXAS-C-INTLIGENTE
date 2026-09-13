/**
 * DepartamentoNormalizer — Normalização de dados de departamento.
 *
 * @class DepartamentoNormalizer
 */

const DepartamentoDTO = require('./DepartamentoDTO');

const NOME_MAX = 30;

class DepartamentoNormalizer {
  /**
   * @param {DepartamentoDTO|Object} entrada
   * @returns {DepartamentoDTO}
   */
  static normalizar(entrada) {
    const dto = entrada instanceof DepartamentoDTO ? entrada : new DepartamentoDTO(entrada || {});

    let nome = String(dto.nome || '').trim();
    if (nome.length > NOME_MAX) {
      nome = nome.slice(0, NOME_MAX);
    }

    return new DepartamentoDTO({
      codigo: dto.codigo != null ? String(dto.codigo).trim() : null,
      nome,
      origemId: dto.origemId,
      origemTipo: dto.origemTipo || 'categoria',
      extras: { ...dto.extras }
    });
  }
}

module.exports = DepartamentoNormalizer;
