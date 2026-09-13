/**
 * Paginação determinística do DANFE A4 retrato (mm).
 * Página 1: canhoto + cabeçalho completo.
 * Páginas seguintes: cabeçalho compacto, sem canhoto.
 */

'use strict';

const PAGE_H = 287;
const MARGIN = 5;

function alturaDescricao(desc) {
  const len = String(desc || '').length;
  const linhas = Math.max(1, Math.ceil(len / 38));
  return Math.min(12, 4.0 + (linhas - 1) * 3.0);
}

function paginarItensDanfe(modelo) {
  const itens = Array.isArray(modelo.itens) ? modelo.itens : [];
  const header1 = 24 + 3 + 42 + 14 + 24 + 18 + 24 + 6;
  const headerCont = 24 + 6;
  const extras = 26;
  const footer = 7;

  const paginas = [];
  let idx = 0;
  let pagina = 0;
  while (idx < itens.length || pagina === 0) {
    const primeira = pagina === 0;
    let usado = (primeira ? header1 : headerCont) + footer;
    const slice = [];
    if (!itens.length && primeira) {
      paginas.push({ itens: [], extra: true, temCanhoto: true });
      break;
    }
    while (idx < itens.length) {
      const h = alturaDescricao(itens[idx].descricao);
      const precisaExtra = idx === itens.length - 1 ? extras : 0;
      if (usado + h + precisaExtra > PAGE_H && slice.length) break;
      slice.push(itens[idx]);
      usado += h;
      idx += 1;
    }
    const extra = idx >= itens.length;
    paginas.push({ itens: slice, extra, temCanhoto: primeira });
    pagina += 1;
    if (idx >= itens.length) break;
  }
  if (paginas.length && !paginas[paginas.length - 1].extra) {
    paginas.push({ itens: [], extra: true, temCanhoto: false });
  }
  return paginas.map((p, i, arr) => ({
    ...p,
    folha: i + 1,
    total: arr.length
  }));
}

module.exports = {
  PAGE_H,
  MARGIN,
  alturaDescricao,
  paginarItensDanfe
};
