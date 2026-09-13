/**
 * Ambientes SEFAZ oficiais.
 *
 * Alinhado ao padrão fiscal já usado no CDS:
 * - PRODUCAO = 1
 * - HOMOLOGACAO = 2
 *
 * Sprint F1 — fundação. Ainda não utilizado em runtime.
 *
 * @module services/fiscal/core/EnvironmentType
 */

const EnvironmentType = Object.freeze({
  PRODUCAO: 'PRODUCAO',
  HOMOLOGACAO: 'HOMOLOGACAO'
});

/**
 * Código numérico SEFAZ (tpAmb).
 * @type {Readonly<Record<string, number>>}
 */
const EnvironmentCode = Object.freeze({
  [EnvironmentType.PRODUCAO]: 1,
  [EnvironmentType.HOMOLOGACAO]: 2
});

/**
 * @param {string} value
 * @returns {boolean}
 */
function isEnvironmentType(value) {
  return Object.prototype.hasOwnProperty.call(EnvironmentType, value);
}

/**
 * @returns {string[]}
 */
function listEnvironmentTypes() {
  return Object.values(EnvironmentType);
}

/**
 * Converte código numérico (1|2) para EnvironmentType.
 * @param {number|string} code
 * @returns {string|null}
 */
function fromAmbienteCode(code) {
  const n = Number(code);
  if (n === 1) return EnvironmentType.PRODUCAO;
  if (n === 2) return EnvironmentType.HOMOLOGACAO;
  return null;
}

/**
 * Converte EnvironmentType para código numérico SEFAZ.
 * @param {string} environmentType
 * @returns {number|null}
 */
function toAmbienteCode(environmentType) {
  const code = EnvironmentCode[environmentType];
  return code === undefined ? null : code;
}

module.exports = {
  EnvironmentType,
  EnvironmentCode,
  isEnvironmentType,
  listEnvironmentTypes,
  fromAmbienteCode,
  toAmbienteCode
};
