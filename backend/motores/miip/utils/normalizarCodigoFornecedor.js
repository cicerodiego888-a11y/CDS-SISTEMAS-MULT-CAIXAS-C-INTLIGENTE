/**
 * normalizarCodigoFornecedor — Normalização do cProd / código do fornecedor.
 *
 * @module motores/miip/utils/normalizarCodigoFornecedor
 */

/**
 * Normaliza código do item no fornecedor (cProd XML).
 *
 * @param {string|number|null|undefined} valor
 * @returns {string|null}
 */
function normalizarCodigoFornecedor(valor) {
  if (valor == null) return null;

  const codigo = String(valor).trim();
  return codigo === '' ? null : codigo;
}

module.exports = {
  normalizarCodigoFornecedor
};
