/**
 * Sprint 15.5 — ToledoChangeDetector
 * Detecta mudanças campo a campo entre produtos/cargas.
 */

'use strict';

const CAMPOS_PLU = Object.freeze([
  'descricao', 'preco', 'tara', 'departamento', 'validade', 'etiqueta', 'label', 'promocao'
]);

function pluKey(item) {
  if (!item) return '';
  return String(item.plu != null ? item.plu : item.codigo || '');
}

function normalizar(item) {
  if (!item || typeof item !== 'object') return null;
  const out = { ...item, plu: pluKey(item) };
  if (out.preco != null) out.preco = Number(out.preco);
  return out;
}

/**
 * @returns {Array<{plu, campo, valor_anterior, valor_novo, tipo}>}
 */
function detectarCampos(anterior, atual) {
  const a = normalizar(anterior) || {};
  const b = normalizar(atual) || {};
  const mudancas = [];
  for (const campo of CAMPOS_PLU) {
    const va = a[campo] ?? null;
    const vb = b[campo] ?? null;
    if (String(va ?? '') !== String(vb ?? '')) {
      let tipo = 'ALTERADO';
      if (campo === 'preco') tipo = 'PRECO';
      else if (campo === 'departamento') tipo = 'DEPARTAMENTO';
      else if (campo === 'etiqueta' || campo === 'label') tipo = 'ETIQUETA';
      else if (campo === 'promocao') tipo = 'PROMOCAO';
      mudancas.push({
        plu: b.plu || a.plu,
        produto_id: b.produto_id ?? a.produto_id ?? null,
        campo,
        valor_anterior: va,
        valor_novo: vb,
        tipo
      });
    }
  }
  return mudancas;
}

function indexByPlu(lista = []) {
  const map = new Map();
  for (const item of lista) {
    const k = pluKey(item);
    if (k) map.set(k, normalizar(item));
  }
  return map;
}

module.exports = {
  CAMPOS_PLU,
  pluKey,
  normalizar,
  detectarCampos,
  indexByPlu
};
