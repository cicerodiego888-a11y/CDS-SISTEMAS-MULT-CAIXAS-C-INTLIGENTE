/**
 * MiipAction — Ações recomendadas após identificação.
 *
 * Define o que o sistema (e o frontend) deve fazer com o resultado.
 * Valores oficiais conforme ARQUITETURA_MIIP.md.
 *
 * Sprint Core: catálogo estrutural — sem regras de decisão.
 *
 * @readonly
 * @enum {string}
 */

const MiipAction = {
  /** Confiança alta — vincular produto automaticamente. */
  AUTO_VINCULAR: 'auto_vincular',

  /** Confiança média/baixa — apresentar candidatos ao operador. */
  SUGERIR: 'sugerir',

  /** Nenhum candidato confiável — sugerir cadastro de novo produto. */
  CRIAR_NOVO: 'criar_novo',

  /** Conflito entre engines — exigir decisão humana. */
  REVISAR_MANUAL: 'revisar_manual'
};

/** @type {string[]} Lista imutável de todas as ações válidas. */
const TODAS = Object.freeze(Object.values(MiipAction));

/**
 * Verifica se o valor informado é uma ação MIIP válida.
 *
 * @param {string} valor
 * @returns {boolean}
 */
function isValid(valor) {
  return typeof valor === 'string' && TODAS.includes(valor);
}

/**
 * Retorna todas as ações disponíveis.
 *
 * @returns {string[]}
 */
function values() {
  return [...TODAS];
}

module.exports = Object.freeze({
  ...MiipAction,
  TODAS,
  isValid,
  values
});
