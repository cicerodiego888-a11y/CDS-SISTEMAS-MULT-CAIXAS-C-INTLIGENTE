/**
 * ProdutoDTO — Contrato oficial de produto para o Motor Equipamentos.
 *
 * Objeto de transporte independente do SQLite/ERP.
 * Drivers NUNCA recebem entidades do banco — apenas este DTO.
 *
 * @class ProdutoDTO
 */

class ProdutoDTO {
  /**
   * @param {Object} dados
   */
  constructor(dados = {}) {
    this.plu = dados.plu ?? dados.codigo ?? null;
    this.codigoInterno = dados.codigoInterno ?? null;
    this.codigoBarras = dados.codigoBarras ?? null;
    this.descricao = dados.descricao ?? '';
    this.descricaoReduzida = dados.descricaoReduzida ?? '';
    this.preco = Number(dados.preco ?? 0);
    this.unidade = dados.unidade ?? 'kg';
    this.pesavel = Boolean(dados.pesavel);
    this.validadeDias = dados.validadeDias ?? null;
    this.departamento = dados.departamento ?? null;
    this.tara = dados.tara ?? null;
    this.extras = dados.extras ?? {};
  }

  /**
   * @returns {import('./validationResult').ResultadoValidacao}
   */
  validar() {
    const ProdutoValidator = require('./ProdutoValidator');
    return ProdutoValidator.validar(this);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      plu: this.plu,
      codigoInterno: this.codigoInterno,
      codigoBarras: this.codigoBarras,
      descricao: this.descricao,
      descricaoReduzida: this.descricaoReduzida,
      preco: this.preco,
      unidade: this.unidade,
      pesavel: this.pesavel,
      validadeDias: this.validadeDias,
      departamento: this.departamento,
      tara: this.tara,
      extras: this.extras
    };
  }

  /**
   * @param {Object} plain
   * @returns {ProdutoDTO}
   */
  static fromJSON(plain) {
    return new ProdutoDTO(plain || {});
  }
}

module.exports = ProdutoDTO;
