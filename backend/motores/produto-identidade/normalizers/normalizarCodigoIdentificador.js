/**
 * Normalização de códigos por tipo — MIP Sprint 01.
 * @module motores/produto-identidade/normalizers/normalizarCodigoIdentificador
 */

const { TIPOS_IDENTIFICADOR } = require('../constants/tiposIdentificador');

/**
 * @param {string|number|null|undefined} valor
 * @param {string} [tipo]
 * @returns {string}
 */
function normalizarCodigoIdentificador(valor, tipo = TIPOS_IDENTIFICADOR.INTERNO) {
  const bruto = String(valor ?? '').trim();
  if (!bruto) return '';

  const t = String(tipo || TIPOS_IDENTIFICADOR.INTERNO).toUpperCase();

  if (
    t === TIPOS_IDENTIFICADOR.EAN8
    || t === TIPOS_IDENTIFICADOR.EAN13
    || t === TIPOS_IDENTIFICADOR.GTIN
    || t === TIPOS_IDENTIFICADOR.PLU
    || t === TIPOS_IDENTIFICADOR.MGV6
  ) {
    return bruto.replace(/\D/g, '');
  }

  if (t === TIPOS_IDENTIFICADOR.INTERNO || t === TIPOS_IDENTIFICADOR.LEGADO) {
    return bruto;
  }

  return bruto;
}

/**
 * Detecta tipo de código de barras a partir do comprimento numérico.
 * @param {string} codigoBarras
 * @returns {string|null} tipo ou null se vazio
 */
function detectarTipoCodigoBarras(codigoBarras) {
  const digits = normalizarCodigoIdentificador(codigoBarras, TIPOS_IDENTIFICADOR.EAN13);
  if (!digits) return null;
  if (digits.length === 8) return TIPOS_IDENTIFICADOR.EAN8;
  if (digits.length === 13) return TIPOS_IDENTIFICADOR.EAN13;
  if (digits.length === 14) return TIPOS_IDENTIFICADOR.GTIN;
  if (digits.length > 0 && digits.length <= 14) return TIPOS_IDENTIFICADOR.EAN13;
  return TIPOS_IDENTIFICADOR.OUTRO;
}

module.exports = {
  normalizarCodigoIdentificador,
  detectarTipoCodigoBarras
};
