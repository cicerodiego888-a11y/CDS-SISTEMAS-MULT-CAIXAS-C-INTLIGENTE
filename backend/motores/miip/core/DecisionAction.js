/**
 * DecisionAction — Ações oficiais do Decision Engine MIIP.
 *
 * Sprint 11 — Fase 2 Inteligência.
 *
 * @readonly
 * @enum {string}
 */

const DecisionAction = {
  /** Confiança máxima — associar automaticamente. */
  AUTO_ASSOCIAR: 'AUTO_ASSOCIAR',

  /** Score alto com gap — sugerir com confirmação do operador. */
  SUGERIR_CONFIRMACAO: 'SUGERIR_CONFIRMACAO',

  /** Score médio — apresentar sugestões ao operador. */
  MOSTRAR_SUGESTOES: 'MOSTRAR_SUGESTOES',

  /** Score baixo — cadastrar novo produto. */
  CADASTRAR_NOVO: 'CADASTRAR_NOVO'
};

/** @type {string[]} */
const TODAS = Object.freeze(Object.values(DecisionAction));

/**
 * @param {string} valor
 * @returns {boolean}
 */
function isValid(valor) {
  return typeof valor === 'string' && TODAS.includes(valor);
}

/**
 * @returns {string[]}
 */
function values() {
  return [...TODAS];
}

module.exports = Object.freeze({
  ...DecisionAction,
  TODAS,
  isValid,
  values
});
