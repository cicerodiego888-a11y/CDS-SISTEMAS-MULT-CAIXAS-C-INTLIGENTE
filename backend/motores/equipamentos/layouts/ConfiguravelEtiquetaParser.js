/**
 * Parser oficial de etiqueta de balança — 100% dirigido por configuração cadastrada.
 * Não contém layouts hardcoded de fabricantes.
 */

const { normalizarLayoutEtiqueta } = require('./LayoutEtiquetaNormalizer');

function normalizarPluLocal(pluRaw) {
  const digits = String(pluRaw || '').replace(/\D/g, '');
  if (!digits) return '';
  const trimmed = digits.replace(/^0+/, '');
  return trimmed || '0';
}

/**
 * @param {string} codigo
 * @param {Object} layoutBruto
 * @returns {Object|null}
 */
function parseEtiquetaComLayout(codigo, layoutBruto) {
  const norm = normalizarLayoutEtiqueta(layoutBruto || {});
  if (!norm.ok) return null;

  const cfg = norm.layout;
  const limpo = String(codigo || '').replace(/\D/g, '');
  if (!limpo || limpo.length !== cfg.tamanho_total) return null;
  if (!limpo.startsWith(cfg.prefixo)) return null;

  const prefixLen = cfg.prefixo.length;
  const pluStart = prefixLen;
  const pluEnd = pluStart + cfg.digitos_plu;
  const varStart = cfg.posicao_inicial - 1;
  const varEnd = cfg.posicao_final;

  if (pluEnd !== varStart) {
    // PLU deve ocupar exatamente o intervalo entre prefixo e variável
    return null;
  }

  const pluRaw = limpo.substring(pluStart, pluEnd);
  if (pluRaw.length !== cfg.digitos_plu) return null;

  const payloadRaw = limpo.substring(varStart, varEnd);
  if (payloadRaw.length !== cfg.digitos_variavel) return null;

  if (cfg.digito_verificador) {
    const dv = limpo.substring(cfg.tamanho_total - 1);
    if (!/^\d$/.test(dv)) return null;
  }

  const payloadNum = Number(payloadRaw);
  if (!Number.isFinite(payloadNum)) return null;

  const plu = normalizarPluLocal(pluRaw);
  const base = {
    plu,
    pluRaw,
    codigoOriginal: limpo,
    layoutId: cfg.preset_id || 'configurado',
    layout: cfg
  };

  if (cfg.tipo_variavel === 'PESO') {
    return {
      ...base,
      valorTotal: null,
      peso: payloadNum / 1000,
      tipoPayload: 'PESO'
    };
  }

  return {
    ...base,
    valorTotal: payloadNum / 100,
    peso: null,
    tipoPayload: 'VALOR'
  };
}

module.exports = {
  parseEtiquetaComLayout,
  normalizarPluLocal
};
