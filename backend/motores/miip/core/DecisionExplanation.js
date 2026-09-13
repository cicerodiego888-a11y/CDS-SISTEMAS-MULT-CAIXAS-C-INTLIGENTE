/**
 * DecisionExplanation — Explicação amigável da decisão MIIP.
 *
 * Sprint 11 — Fase 2 Inteligência.
 *
 * @class DecisionExplanation
 */

class DecisionExplanation {
  /**
   * @param {Object} [dados]
   * @param {string[]} [dados.linhas]
   * @param {string|null} [dados.texto]
   * @param {string[]} [dados.baseadoEm]
   */
  constructor(dados = {}) {
    this.linhas = Array.isArray(dados.linhas) ? [...dados.linhas] : [];
    this.baseadoEm = Array.isArray(dados.baseadoEm) ? [...dados.baseadoEm] : [];
    this.texto = dados.texto ?? this._montarTexto();
  }

  /**
   * @private
   * @returns {string}
   */
  _montarTexto() {
    if (this.linhas.length === 0) return '';

    const partes = [...this.linhas];

    if (this.baseadoEm.length > 0) {
      partes.push('Baseado em:');
      this.baseadoEm.forEach((item) => partes.push(item));
    }

    return partes.join('\n');
  }

  /**
   * @param {Object} [dados]
   * @returns {DecisionExplanation}
   */
  static create(dados = {}) {
    return new DecisionExplanation(dados);
  }

  /**
   * @param {string[]} linhas
   * @param {string[]} [baseadoEm]
   * @returns {DecisionExplanation}
   */
  static fromLinhas(linhas = [], baseadoEm = []) {
    return new DecisionExplanation({ linhas, baseadoEm });
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      linhas: this.linhas,
      baseadoEm: this.baseadoEm,
      texto: this.texto
    };
  }
}

module.exports = DecisionExplanation;
