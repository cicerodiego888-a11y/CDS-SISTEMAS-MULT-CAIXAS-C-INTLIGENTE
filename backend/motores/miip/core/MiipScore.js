/**
 * MiipScore — Representação do score de identificação.
 *
 * Score (0–100) mede quão bem o candidato corresponde ao item.
 * Confiança (MiipConfidence) é derivada separadamente em sprint futura.
 *
 * Sprint Core: objeto de valor — sem cálculo ou agregação.
 *
 * @class MiipScore
 */

class MiipScore {
  /**
   * @param {Object} [dados]
   * @param {number} [dados.valor] - Score final do melhor candidato (0–100)
   * @param {number|null} [dados.gap] - Diferença entre 1º e 2º candidato
   * @param {number} [dados.enginesConcordantes] - Engines que apontaram o top 1
   */
  constructor(dados = {}) {
    this.valor = Number(dados.valor ?? 0);
    this.gap = dados.gap == null ? null : Number(dados.gap);
    this.enginesConcordantes = Number(dados.enginesConcordantes ?? 0);
  }

  /**
   * Factory para criação explícita.
   *
   * @param {Object} [dados]
   * @returns {MiipScore}
   */
  static create(dados = {}) {
    return new MiipScore(dados);
  }

  /**
   * Cria instância vazia (score zerado).
   *
   * @returns {MiipScore}
   */
  static vazio() {
    return new MiipScore({ valor: 0, gap: null, enginesConcordantes: 0 });
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      valor: this.valor,
      gap: this.gap,
      enginesConcordantes: this.enginesConcordantes
    };
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {MiipScore}
   */
  static fromJSON(plain) {
    return new MiipScore(plain || {});
  }
}

module.exports = MiipScore;
