/**
 * Normalização de PLU extraído de etiqueta (Sprint 08 — hardening).
 * Lookup de PLU zero / zero-padded (00, 0000, …) — RC14.15.1+.
 * @module motores/produto-identidade/utils/normalizarPlu
 */

/**
 * Forma canônica para exibição/meta (remove zeros à esquerda; all-zero → "0").
 * @param {string|number|null|undefined} pluRaw
 * @returns {string}
 */
function normalizarPlu(pluRaw) {
  const digits = String(pluRaw ?? '').replace(/\D/g, '');
  return digits.replace(/^0+/, '') || (digits ? '0' : '');
}

/**
 * Variantes de PLU para identificação (cadastro pode guardar 0, 00, 0000, 000000…).
 * Nunca descarta PLU composto só de zeros.
 *
 * @param {string|number|null|undefined} pluRaw
 * @returns {string[]}
 */
function variantesPlu(pluRaw) {
  const digits = String(pluRaw ?? '').replace(/\D/g, '');
  if (!digits) return [];

  const stripped = digits.replace(/^0+/, '') || '0';
  const out = new Set();
  out.add(digits);
  out.add(stripped);

  // paddings comuns em balança / cadastro (2–10 dígitos)
  for (let len = 1; len <= 10; len += 1) {
    out.add(stripped.padStart(len, '0'));
  }

  return [...out];
}

/**
 * PLU presente e utilizável na identificação (inclui "0", "00", "0000").
 * @param {*} plu
 * @returns {boolean}
 */
function pluInformado(plu) {
  if (plu === 0) return true;
  if (plu == null) return false;
  return String(plu).replace(/\D/g, '').length > 0;
}

module.exports = {
  normalizarPlu,
  variantesPlu,
  pluInformado
};
