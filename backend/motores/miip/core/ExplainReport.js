/**
 * ExplainReport — Relatório de explicação para a Central MIIP.
 *
 * Sprint 12 — Camada de Explicabilidade.
 *
 * @class ExplainReport
 */

const MiipExplanation = require('./MiipExplanation');

const VERSAO_PADRAO = '1.0.0';

class ExplainReport {
  /**
   * @param {Object} [dados]
   * @param {MiipExplanation|Object} [dados.explicacao]
   * @param {string} [dados.modo]
   * @param {string|null} [dados.textoFormatado]
   * @param {string|null} [dados.geradoEm]
   * @param {string|null} [dados.acao]
   * @param {number|null} [dados.score]
   * @param {number|null} [dados.produtoId]
   * @param {boolean} [dados.precisaConfirmacao]
   * @param {boolean} [dados.precisaCadastro]
   */
  constructor(dados = {}) {
    this.explicacao = dados.explicacao instanceof MiipExplanation
      ? dados.explicacao
      : MiipExplanation.create(dados.explicacao ?? {});
    this.modo = dados.modo ?? 'usuario';
    this.textoFormatado = dados.textoFormatado ?? '';
    this.geradoEm = dados.geradoEm ?? null;
    this.acao = dados.acao ?? null;
    this.score = dados.score ?? null;
    this.produtoId = dados.produtoId ?? null;
    this.precisaConfirmacao = dados.precisaConfirmacao === true;
    this.precisaCadastro = dados.precisaCadastro === true;
  }

  /**
   * @param {Object} [dados]
   * @returns {ExplainReport}
   */
  static create(dados = {}) {
    return new ExplainReport(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      versao: VERSAO_PADRAO,
      explicacao: this.explicacao.toJSON(),
      modo: this.modo,
      textoFormatado: this.textoFormatado,
      geradoEm: this.geradoEm,
      acao: this.acao,
      score: this.score,
      produtoId: this.produtoId,
      precisaConfirmacao: this.precisaConfirmacao,
      precisaCadastro: this.precisaCadastro
    };
  }
}

ExplainReport.VERSAO_PADRAO = VERSAO_PADRAO;

module.exports = ExplainReport;
