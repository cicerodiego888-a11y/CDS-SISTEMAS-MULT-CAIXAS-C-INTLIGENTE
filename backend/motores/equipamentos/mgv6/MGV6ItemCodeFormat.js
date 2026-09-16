/**
 * RC14.15.20 — Formatação do Código do Item (CCCCCC) no TXITENS.
 *
 * PLU não é valor monetário. Nunca aplicar *100, centavos ou formatter de PPPPPP.
 */

'use strict';

const { MGV6Error, CODES } = require('./MGV6Errors');

const CCCCCC_LENGTH = 6;

/**
 * PLU numérico → inteiro (25.00 → 25). Não concatena casas decimais (25.00 ≠ 2500).
 * @param {*} plu
 * @returns {number|null}
 */
function parseMGV6ItemCodeInteger(plu) {
  if (plu == null) return null;
  const raw = String(plu).trim();
  if (!raw) return null;
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

/**
 * Campo CCCCCC do TXITENS: exatamente 6 posições, zero à esquerda.
 * @param {string|number} plu
 * @returns {string}
 */
function formatMGV6ItemCode(plu) {
  const n = parseMGV6ItemCodeInteger(plu);
  if (n == null) {
    throw MGV6Error.fromCode(
      CODES.CODE_INVALID,
      'PLU / código do item da balança deve ser inteiro não negativo',
      { statusCode: 400, plu: plu == null ? null : String(plu) }
    );
  }
  const value = String(n);
  if (value.length > CCCCCC_LENGTH) {
    throw MGV6Error.fromCode(
      CODES.CODE_OVERFLOW,
      `Código do item com ${value.length} dígitos excede ${CCCCCC_LENGTH} (CCCCCC)`,
      { statusCode: 400, plu: value, limite: CCCCCC_LENGTH }
    );
  }
  return value.padStart(CCCCCC_LENGTH, '0');
}

/**
 * Bloco posicional TT+Z+CCCCCC (9 chars) a partir do mesmo inteiro do CCCCCC.
 * @param {string|number} plu
 * @returns {string}
 */
function formatMGV6ItemCode9(plu) {
  return formatMGV6ItemCode(plu).padStart(9, '0');
}

module.exports = {
  CCCCCC_LENGTH,
  parseMGV6ItemCodeInteger,
  formatMGV6ItemCode,
  formatMGV6ItemCode9
};
