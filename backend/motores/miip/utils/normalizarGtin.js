/**
 * normalizarGtin — Normalização estrutural de GTIN/EAN.
 *
 * Remove caracteres não numéricos e valida comprimentos aceitos.
 * Não corrige dígito verificador — apenas normalização para lookup exato.
 *
 * @module motores/miip/utils/normalizarGtin
 */

/** Comprimentos GTIN aceitos (EAN-8, UPC-12, EAN-13, GTIN-14). */
const COMPRIMENTOS_VALIDOS = Object.freeze([8, 12, 13, 14]);

/**
 * Normaliza valor para GTIN numérico.
 *
 * @param {string|number|null|undefined} valor
 * @returns {string|null}
 */
function normalizarGtin(valor) {
  if (valor == null || valor === '') return null;

  const digitos = String(valor).replace(/\D/g, '');
  if (!digitos) return null;
  if (!COMPRIMENTOS_VALIDOS.includes(digitos.length)) return null;

  return digitos;
}

/**
 * Verifica se o valor é um GTIN estruturalmente válido após normalização.
 *
 * @param {string|number|null|undefined} valor
 * @returns {boolean}
 */
function isGtinValido(valor) {
  return normalizarGtin(valor) !== null;
}

module.exports = {
  COMPRIMENTOS_VALIDOS,
  normalizarGtin,
  isGtinValido
};
