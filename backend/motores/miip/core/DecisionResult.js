/**
 * DecisionResult — Resultado oficial da decisão MIIP.
 *
 * Sprint 11 — Fase 2 Inteligência.
 *
 * @class DecisionResult
 */

const DecisionAction = require('./DecisionAction');
const DecisionExplanation = require('./DecisionExplanation');
const DecisionStatistics = require('./DecisionStatistics');
const DecisionHistory = require('./DecisionHistory');

const VERSAO_PADRAO = '1.0.0';

class DecisionResult {
  /**
   * @param {Object} [dados]
   * @param {string|null} [dados.acao]
   * @param {string|null} [dados.nivelCerteza]
   * @param {string[]} [dados.motivos]
   * @param {DecisionExplanation|Object|null} [dados.explicacao]
   * @param {Object|null} [dados.produtoSelecionado]
   * @param {Object[]} [dados.alternativas]
   * @param {boolean} [dados.precisaConfirmacao]
   * @param {boolean} [dados.precisaCadastro]
   * @param {number|null} [dados.score]
   * @param {DecisionStatistics|Object|null} [dados.estatisticas]
   * @param {DecisionHistory|Object|null} [dados.historico]
   */
  constructor(dados = {}) {
    this.acao = dados.acao ?? null;
    this.nivelCerteza = dados.nivelCerteza ?? null;
    this.motivos = Array.isArray(dados.motivos) ? [...dados.motivos] : [];
    this.explicacao = dados.explicacao instanceof DecisionExplanation
      ? dados.explicacao
      : DecisionExplanation.create(dados.explicacao ?? {});
    this.produtoSelecionado = dados.produtoSelecionado ?? null;
    this.alternativas = Array.isArray(dados.alternativas) ? [...dados.alternativas] : [];
    this.precisaConfirmacao = dados.precisaConfirmacao === true;
    this.precisaCadastro = dados.precisaCadastro === true;
    this.score = dados.score ?? null;
    this.estatisticas = dados.estatisticas instanceof DecisionStatistics
      ? dados.estatisticas
      : DecisionStatistics.create(dados.estatisticas ?? {});
    this.historico = dados.historico instanceof DecisionHistory
      ? dados.historico
      : (dados.historico ? DecisionHistory.create(dados.historico) : null);
  }

  /**
   * @param {Object} [dados]
   * @returns {DecisionResult}
   */
  static create(dados = {}) {
    return new DecisionResult(dados);
  }

  /**
   * @returns {boolean}
   */
  isAutoAssociar() {
    return this.acao === DecisionAction.AUTO_ASSOCIAR;
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      versao: VERSAO_PADRAO,
      acao: this.acao,
      nivelCerteza: this.nivelCerteza,
      motivos: this.motivos,
      explicacao: this.explicacao.toJSON(),
      produtoSelecionado: this.produtoSelecionado,
      alternativas: this.alternativas,
      precisaConfirmacao: this.precisaConfirmacao,
      precisaCadastro: this.precisaCadastro,
      score: this.score,
      estatisticas: this.estatisticas.toJSON(),
      historico: this.historico ? this.historico.toJSON() : null
    };
  }
}

DecisionResult.VERSAO_PADRAO = VERSAO_PADRAO;

module.exports = DecisionResult;
