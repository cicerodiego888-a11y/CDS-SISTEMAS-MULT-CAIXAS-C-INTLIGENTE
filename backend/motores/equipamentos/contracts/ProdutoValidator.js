/**
 * ProdutoValidator — Regras de validação do contrato ProdutoDTO.
 *
 * @class ProdutoValidator
 */

const { criarResultado } = require('./validationResult');

const UNIDADES_VALIDAS = ['kg', 'g', 'un'];

class ProdutoValidator {
  /**
   * @param {import('./ProdutoDTO')|Object} entrada
   * @returns {import('./validationResult').ResultadoValidacao}
   */
  static validar(entrada) {
    const ProdutoDTO = require('./ProdutoDTO');
    const dto = entrada instanceof ProdutoDTO ? entrada : new ProdutoDTO(entrada || {});
    const erros = [];

    if (dto.plu === null || dto.plu === undefined || String(dto.plu).trim() === '') {
      erros.push('PLU/código é obrigatório');
    }

    if (!dto.descricao || !String(dto.descricao).trim()) {
      erros.push('Descrição é obrigatória');
    }

    if (!Number.isFinite(dto.preco) || dto.preco < 0) {
      erros.push('Preço inválido');
    }

    if (dto.unidade && !UNIDADES_VALIDAS.includes(String(dto.unidade).toLowerCase())) {
      erros.push(`Unidade inválida: ${dto.unidade}`);
    }

    if (dto.validadeDias != null) {
      const dias = Number(dto.validadeDias);
      if (!Number.isFinite(dias) || dias < 0) {
        erros.push('Validade em dias inválida');
      }
    }

    if (dto.codigoBarras && !/^\d{8,14}$/.test(String(dto.codigoBarras).replace(/\D/g, ''))) {
      erros.push('Código de barras inválido');
    }

    return criarResultado(erros);
  }
}

module.exports = ProdutoValidator;
