/**
 * DecisionRule — Regra configurável do Decision Engine.
 *
 * Sprint 11 — Fase 2 Inteligência.
 *
 * @class DecisionRule
 */

class DecisionRule {
  /**
   * @param {Object} [dados]
   * @param {string} [dados.nome]
   * @param {number} [dados.peso]
   * @param {boolean} [dados.ativo]
   * @param {number} [dados.prioridade]
   * @param {string|null} [dados.acao]
   * @param {Object} [dados.condicoes]
   * @param {string|null} [dados.descricao]
   */
  constructor(dados = {}) {
    this.nome = dados.nome ?? null;
    this.peso = Number(dados.peso ?? 0);
    this.ativo = dados.ativo !== false;
    this.prioridade = Number(dados.prioridade ?? 999);
    this.acao = dados.acao ?? null;
    this.condicoes = dados.condicoes ?? {};
    this.descricao = dados.descricao ?? null;
  }

  /**
   * @param {Object} [dados]
   * @returns {DecisionRule}
   */
  static create(dados = {}) {
    return new DecisionRule(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      nome: this.nome,
      peso: this.peso,
      ativo: this.ativo,
      prioridade: this.prioridade,
      acao: this.acao,
      condicoes: this.condicoes,
      descricao: this.descricao
    };
  }
}

module.exports = DecisionRule;
