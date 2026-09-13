/**
 * normalizarCnpj — Normalização estrutural de CNPJ.
 *
 * @module motores/miip/utils/normalizarCnpj
 */

/**
 * Normaliza CNPJ para 14 dígitos.
 *
 * @param {string|number|null|undefined} valor
 * @returns {string|null}
 */
function normalizarCnpj(valor) {
  if (valor == null || valor === '') return null;

  const digitos = String(valor).replace(/\D/g, '');
  if (digitos.length !== 14) return null;

  return digitos;
}

/**
 * @param {string|number|null|undefined} valor
 * @returns {boolean}
 */
function isCnpjValido(valor) {
  return normalizarCnpj(valor) !== null;
}

module.exports = {
  normalizarCnpj,
  isCnpjValido
};
