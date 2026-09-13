/**
 * DecisionHistory — Registro histórico de uma decisão MIIP.
 *
 * Sprint 11 — Fase 2 Inteligência.
 *
 * @class DecisionHistory
 */

const VERSAO_PADRAO = '1.0.0';

class DecisionHistory {
  /**
   * @param {Object} [dados]
   * @param {string|null} [dados.regra]
   * @param {number|null} [dados.score]
   * @param {string|null} [dados.data]
   * @param {string|null} [dados.versaoRegra]
   * @param {string|null} [dados.acao]
   * @param {string|null} [dados.operacaoId]
   */
  constructor(dados = {}) {
    this.regra = dados.regra ?? null;
    this.score = dados.score ?? null;
    this.data = dados.data ?? null;
    this.versaoRegra = dados.versaoRegra ?? VERSAO_PADRAO;
    this.acao = dados.acao ?? null;
    this.operacaoId = dados.operacaoId ?? null;
  }

  /**
   * @param {Object} [dados]
   * @returns {DecisionHistory}
   */
  static create(dados = {}) {
    return new DecisionHistory(dados);
  }

  /**
   * @param {Object} [dados]
   * @returns {DecisionHistory}
   */
  static agora(dados = {}) {
    return new DecisionHistory({
      ...dados,
      data: dados.data ?? new Date().toISOString()
    });
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      regra: this.regra,
      score: this.score,
      data: this.data,
      versaoRegra: this.versaoRegra,
      acao: this.acao,
      operacaoId: this.operacaoId
    };
  }
}

DecisionHistory.VERSAO_PADRAO = VERSAO_PADRAO;

module.exports = DecisionHistory;
