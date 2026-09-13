/**
 * validarChaveNfe — Validação básica de chave de acesso NF-e (44 dígitos).
 *
 * @module motores/central-entradas/utils/validarChaveNfe
 */

/**
 * @param {string} chave
 * @returns {{ valida: boolean, erro?: string }}
 */
function validarChaveNfe(chave) {
  const limpa = String(chave || '').replace(/\D/g, '');

  if (!limpa) {
    return { valida: false, erro: 'Chave não informada' };
  }

  if (limpa.length !== 44) {
    return { valida: false, erro: 'Chave deve conter 44 dígitos' };
  }

  return { valida: true, chave: limpa };
}

module.exports = {
  validarChaveNfe
};
