/**
 * MiipHealthStatus — Estados de saúde do MIIP.
 *
 * Sprint 14 — Observabilidade e Telemetria.
 *
 * @readonly
 * @enum {string}
 */

const MiipHealthStatus = {
  OK: 'OK',
  WARNING: 'WARNING',
  ERROR: 'ERROR'
};

/** @type {string[]} */
const TODOS = Object.freeze(Object.values(MiipHealthStatus));

/**
 * @param {string} valor
 * @returns {boolean}
 */
function isValid(valor) {
  return typeof valor === 'string' && TODOS.includes(valor);
}

/**
 * @param {string[]} estados
 * @returns {string}
 */
function consolidar(...estados) {
  const lista = estados.flat().filter(Boolean);
  if (lista.includes(MiipHealthStatus.ERROR)) return MiipHealthStatus.ERROR;
  if (lista.includes(MiipHealthStatus.WARNING)) return MiipHealthStatus.WARNING;
  return MiipHealthStatus.OK;
}

module.exports = Object.freeze({
  ...MiipHealthStatus,
  TODOS,
  isValid,
  consolidar
});
