/**
 * Paginação determinística do DANFE A4 retrato (mm).
 * Página 1: canhoto + cabeçalho completo.
 * Páginas seguintes: cabeçalho compacto, sem canhoto.
 */

'use strict';

const { alturaLinhaProduto } = require('./danfeProdutosGrid');

const PAGE_H = 287;
const MARGIN = 5;

function alturaDescricao(desc) {
  return alturaLinhaProduto({ descricao: desc });
}

function paginarItensDanfe(modelo) {
  const itens = Array.isArray(modelo.itens) ? modelo.itens : [];
  const nDups = Array.isArray(modelo.duplicatas) ? modelo.duplicatas.length : 0;
  const faturaH = nDups > 0 ? 4 + Math.min(nDups, 4) * 4 : 5;
  const header1 = 20 + 2 + 34 + 8 + 22 + faturaH + 16 + 22 + 5;
  const headerCont = 18 + 5;
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
