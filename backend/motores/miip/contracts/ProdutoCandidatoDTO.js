/**
 * ProdutoCandidatoDTO — Produto candidato retornado por um motor.
 *
 * @class ProdutoCandidatoDTO
 */

class ProdutoCandidatoDTO {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.produtoId = Number(dados.produtoId ?? dados.produto_id ?? 0);
    this.nome = dados.nome ?? '';
    this.codigo = dados.codigo ?? '';
    this.codigoBarras = dados.codigoBarras ?? dados.codigo_barras ?? null;
    this.scoreParcial = Number(dados.scoreParcial ?? dados.score_parcial ?? 0);
    this.scorePonderado = Number(dados.scorePonderado ?? dados.score_ponderado ?? 0);
    this.motorOrigem = dados.motorOrigem ?? dados.motor_origem ?? dados.engineOrigem ?? '';
    this.evidencias = Array.isArray(dados.evidencias) ? [...dados.evidencias] : [];
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {ProdutoCandidatoDTO}
   */
  static create(plain) {
    return new ProdutoCandidatoDTO(plain || {});
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      produtoId: this.produtoId,
      nome: this.nome,
      codigo: this.codigo,
      codigoBarras: this.codigoBarras,
      scoreParcial: this.scoreParcial,
      scorePonderado: this.scorePonderado,
      motorOrigem: this.motorOrigem,
      evidencias: this.evidencias
    };
  }
}

module.exports = ProdutoCandidatoDTO;
