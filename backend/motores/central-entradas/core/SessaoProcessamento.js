/**
 * SessaoProcessamento — Correlaciona uma execução Parser + MIIP por documento.
 *
 * Sprint 1: estrutura placeholder para sprints de processamento.
 *
 * @class SessaoProcessamento
 */

class SessaoProcessamento {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.id = dados.id ?? null;
    this.documentoId = dados.documentoId ?? dados.documento_id ?? null;
    this.iniciadaEm = dados.iniciadaEm ?? dados.iniciada_em ?? null;
    this.finalizadaEm = dados.finalizadaEm ?? dados.finalizada_em ?? null;
    this.sucesso = dados.sucesso ?? null;
    this.detalhe = dados.detalhe ?? null;
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {SessaoProcessamento}
   */
  static create(plain) {
    return new SessaoProcessamento(plain || {});
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      documentoId: this.documentoId,
      iniciadaEm: this.iniciadaEm,
      finalizadaEm: this.finalizadaEm,
      sucesso: this.sucesso,
      detalhe: this.detalhe
    };
  }
}

module.exports = SessaoProcessamento;
