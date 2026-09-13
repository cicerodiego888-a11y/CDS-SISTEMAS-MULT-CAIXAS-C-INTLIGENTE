/**
 * MiipLearningEvent — Evento oficial de aprendizado do MIIP.
 *
 * Sprint 5: representa uma confirmação explícita do operador.
 *
 * @class MiipLearningEvent
 */

class MiipLearningEvent {
  /**
   * @param {Object} [dados]
   * @param {string} [dados.requestId]
   * @param {number} [dados.produtoId]
   * @param {string} [dados.fornecedor]
   * @param {string} [dados.cnpj]
   * @param {string} [dados.codigoFornecedor]
   * @param {string} [dados.descricaoFornecedor]
   * @param {number|string|null} [dados.usuario]
   * @param {string} [dados.origem]
   * @param {string|null} [dados.timestamp]
   */
  constructor(dados = {}) {
    this.requestId = dados.requestId ?? null;
    this.produtoId = Number(dados.produtoId ?? 0) || null;
    this.fornecedor = dados.fornecedor ?? '';
    this.cnpj = dados.cnpj ?? '';
    this.codigoFornecedor = dados.codigoFornecedor ?? '';
    this.descricaoFornecedor = dados.descricaoFornecedor ?? '';
    this.usuario = dados.usuario ?? null;
    this.origem = dados.origem ?? 'feedback';
    this.timestamp = dados.timestamp ?? new Date().toISOString();
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {MiipLearningEvent}
   */
  static create(plain) {
    return new MiipLearningEvent(plain || {});
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      requestId: this.requestId,
      produtoId: this.produtoId,
      fornecedor: this.fornecedor,
      cnpj: this.cnpj,
      codigoFornecedor: this.codigoFornecedor,
      descricaoFornecedor: this.descricaoFornecedor,
      usuario: this.usuario,
      origem: this.origem,
      timestamp: this.timestamp
    };
  }
}

module.exports = MiipLearningEvent;
