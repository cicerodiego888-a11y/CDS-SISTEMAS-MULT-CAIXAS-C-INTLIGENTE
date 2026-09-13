'use strict';

/**
 * Comparação de texto de busca: acentos, concatenação e zeros à esquerda (02M ≡ 2M).
 */

const { normalizarNomeBusca } = require('./normalizarNomeBusca');

function compactarMedidas(texto) {
  return String(texto || '').replace(/(^|[^0-9])0+(\d)/g, '$1$2');
}

function haystackBuscaProduto(produto) {
  return [
    String(produto?.nome_busca || ''),
    normalizarNomeBusca(produto?.nome || ''),
    normalizarNomeBusca(produto?.marca || ''),
    normalizarNomeBusca(produto?.categoria || '')
  ].filter(Boolean).join('|');
}

function textoContemToken(haystack, token) {
  const h = String(haystack || '');
  const t = String(token || '');
  if (!t) return false;
  if (h.includes(t)) return true;
  const semZero = t.replace(/^0+(?=\d)/, '');
  if (semZero && semZero !== t && h.includes(semZero)) return true;
  const hc = compactarMedidas(h);
  if (hc.includes(t)) return true;
  if (semZero && semZero !== t && hc.includes(semZero)) return true;
  return compactarMedidas(t) !== t && hc.includes(compactarMedidas(t));
}

function textoContemFraseCompacta(haystack, fraseCompacta) {
  const h = String(haystack || '');
  const f = String(fraseCompacta || '');
  if (!f) return false;
  if (h.includes(f)) return true;
  return compactarMedidas(h).includes(compactarMedidas(f));
}

function produtoCasaFraseBusca(produto, termoNorm) {
  const termo = String(termoNorm || '');
  if (!termo || !produto) return false;
  const nb = String(produto.nome_busca || '');
  const nomeN = normalizarNomeBusca(produto.nome || '');
  const marca = normalizarNomeBusca(produto.marca || '');
  return textoContemFraseCompacta(nb, termo)
    || textoContemFraseCompacta(nomeN, termo)
    || (marca && textoContemFraseCompacta(marca, termo))
    || textoContemFraseCompacta(haystackBuscaProduto(produto), termo);
}

module.exports = {
  compactarMedidas,
  haystackBuscaProduto,
  textoContemToken,
  textoContemFraseCompacta,
  produtoCasaFraseBusca
};
