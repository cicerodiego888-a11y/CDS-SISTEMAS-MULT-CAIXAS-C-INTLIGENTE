/**
 * MiipConfidence — Níveis de confiança da identificação.
 *
 * Indica quão seguro o MIIP está para agir automaticamente.
 * Distinto de MiipScore (métrica contínua de correspondência).
 *
 * Sprint Core: catálogo estrutural — sem thresholds ou regras de cálculo.
 *
 * @readonly
 * @enum {string}
 */

const MiipConfidence = {
  /** Score alto, sem conflito — ação automática permitida. */
  ALTA: 'ALTA',

  /** Score moderado — sugestão com confirmação do operador. */
  MEDIA: 'MEDIA',

  /** Score baixo — sugestão com alerta visual. */
  BAIXA: 'BAIXA',

  /** Score insuficiente — sem candidato confiável. */
  NENHUMA: 'NENHUMA'
};

/** @type {string[]} Lista imutável de todos os níveis válidos. */
const TODOS = Object.freeze(Object.values(MiipConfidence));

/**
 * Verifica se o valor informado é um nível de confiança válido.
 *
 * @param {string} valor
 * @returns {boolean}
 */
function isValid(valor) {
  return typeof valor === 'string' && TODOS.includes(valor);
}

/**
 * Retorna todos os níveis de confiança disponíveis.
 *
 * @returns {string[]}
 */
function values() {
  return [...TODOS];
}

module.exports = Object.freeze({
  ...MiipConfidence,
  TODOS,
  isValid,
  values
});
