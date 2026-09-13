/**
 * Validação de PLU no cadastro (Sprint 06).
 * Opcional — vazio é válido (clientes atuais sem PLU).
 * @module motores/produto-identidade/validators/validarPlu
 */

const PLU_MAX_DIGITOS = 10;

/**
 * @param {string|number|null|undefined} plu
 * @returns {{ ok: true, valor: string|null } | { ok: false, erro: string }}
 */
function validarPluOpcional(plu) {
  if (plu === undefined || plu === null) {
    return { ok: true, valor: null, informado: false };
  }

  const bruto = String(plu).trim();
  if (!bruto) {
    return { ok: true, valor: null, informado: true };
  }

  const digits = bruto.replace(/\D/g, '');
  if (!digits) {
    return { ok: false, erro: 'PLU inválido: informe apenas dígitos.' };
  }
  if (digits.length > PLU_MAX_DIGITOS) {
    return { ok: false, erro: `PLU inválido: máximo ${PLU_MAX_DIGITOS} dígitos.` };
  }

  return { ok: true, valor: digits, informado: true };
}

/**
 * Flag de produto pesável — alias oficial de produto_fracionado / vendido_por_peso.
 * @param {Object} body
 * @returns {0|1|undefined} undefined = não informado
 */
function resolverFlagProdutoPesavel(body = {}) {
  if (
    body.produto_pesavel !== undefined
    || body.produto_fracionado !== undefined
    || body.vendido_por_peso !== undefined
  ) {
    return Number(
      body.produto_pesavel ?? body.produto_fracionado ?? body.vendido_por_peso ?? 0
    ) ? 1 : 0;
  }
  return undefined;
}

module.exports = {
  validarPluOpcional,
  resolverFlagProdutoPesavel,
  PLU_MAX_DIGITOS
};
