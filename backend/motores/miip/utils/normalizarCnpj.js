/**
 * normalizarCnpj — Normalização estrutural oficial de CNPJ (só dígitos).
 *
 * Contrato:
 * - "09.591.661/0001-03" → "09591661000103"
 * - "09591661000103" → "09591661000103"
 * - "09 591 661 0001 03" → "09591661000103"
 * - null / undefined / vazio / ≠14 dígitos → null
 *
 * Não valida dígitos verificadores. Para validação DV use
 * backend/services/cadastro/documentoCpfCnpj.js (validarCnpj).
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
