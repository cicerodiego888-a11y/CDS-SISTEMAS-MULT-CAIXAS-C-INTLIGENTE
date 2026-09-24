/**
 * Grid oficial da tabela DADOS DOS PRODUTOS / SERVIÇOS do DANFE NF-e.
 * Somente layout — não altera dados fiscais.
 */

'use strict';

const LARGURA_UTIL_TABELA_MM = 200;
const FONT_PRODUTO = 5;
const FONT_CABECALHO = 4.2;
const CHAR_WIDTH_FACTOR = 0.50;
const ALTURA_CABECALHO_MM = 5.2;
const ALTURA_LINHA_BASE_MM = 5.2;
const ALTURA_LINHA_EXTRA_MM = 2.8;
const MAX_LINHAS_DESCRICAO = 8;
const PT_POR_MM = 2.83465;

const COLUNAS_PRODUTOS = Object.freeze([
  { id: 'codigo', labelPdf: 'COD', labelHtml: 'CÓDIGO', w: 18, align: 'left', wrap: false },
  { id: 'descricao', labelPdf: 'DESCRICAO', labelHtml: 'DESCRIÇÃO', w: 50, align: 'left', wrap: true },
  { id: 'ncm', labelPdf: 'NCM', labelHtml: 'NCM/SH', w: 16, align: 'center', wrap: false },
  { id: 'cst', labelPdf: 'CST', labelHtml: 'CST', w: 9, align: 'center', wrap: false },
  { id: 'cfop', labelPdf: 'CFOP', labelHtml: 'CFOP', w: 9, align: 'center', wrap: false },
  { id: 'unidade', labelPdf: 'UN', labelHtml: 'UN', w: 7, align: 'center', wrap: false },
  { id: 'quantidade', labelPdf: 'QTD', labelHtml: 'QTD.', w: 12, align: 'right', wrap: false },
  { id: 'valorUnitario', labelPdf: 'VL UNIT', labelHtml: 'VL UNIT', w: 14, align: 'right', wrap: false },
  { id: 'valorTotal', labelPdf: 'VL TOTAL', labelHtml: 'VL TOTAL', w: 14, align: 'right', wrap: false },
  { id: 'baseIcms', labelPdf: 'BC ICMS', labelHtml: 'BC ICMS', w: 14, align: 'right', wrap: false },
  { id: 'valorIcms', labelPdf: 'VL ICMS', labelHtml: 'VL ICMS', w: 13, align: 'right', wrap: false },
  { id: 'valorIpi', labelPdf: 'VL IPI', labelHtml: 'VL IPI', w: 12, align: 'right', wrap: false },
  { id: 'aliquota', labelPdf: 'ALIQ', labelHtml: 'ALIQ', w: 12, align: 'right', wrap: false }
]);

function validarLargurasColunas(colunas = COLUNAS_PRODUTOS, larguraUtil = LARGURA_UTIL_TABELA_MM) {
  const soma = colunas.reduce((acc, col) => acc + Number(col.w || 0), 0);
  if (soma - larguraUtil > 1e-6) {
    throw new Error(
      `DANFE produtos: SUM(widths)=${soma} ultrapassa larguraUtilTabela=${larguraUtil}`
    );
  }
  return soma;
}

validarLargurasColunas();

function obterColunasProdutosDanfe() {
  let x = 0;
  return COLUNAS_PRODUTOS.map((col) => {
    const def = { ...col, x };
    x += col.w;
    return def;
  });
}

function colunaPorId(id) {
  return obterColunasProdutosDanfe().find((col) => col.id === id) || null;
}

function charsPorLargura(larguraMm, fontSize = FONT_PRODUTO) {
  const larguraPt = Number(larguraMm) * PT_POR_MM;
  const charPt = fontSize * CHAR_WIDTH_FACTOR;
  return Math.max(4, Math.floor((larguraPt - 2.2) / charPt));
}

function wrapTexto(texto, larguraMm, fontSize = FONT_PRODUTO, maxLinhas = MAX_LINHAS_DESCRICAO) {
  const max = charsPorLargura(larguraMm, fontSize);
  const s = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!s) return [''];
  if (s.length <= max) return [s];
  const out = [];
  let rest = s;
  while (rest.length && out.length < maxLinhas) {
    if (rest.length <= max) {
      out.push(rest);
      break;
    }
    let cut = rest.lastIndexOf(' ', max);
    if (cut < Math.floor(max * 0.4)) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest && out.length === maxLinhas) {
    const last = out[maxLinhas - 1];
    out[maxLinhas - 1] = last.length > 1 ? `${last.slice(0, Math.max(1, last.length - 1))}…` : last;
  }
  return out.length ? out : [''];
}

function quebrarDescricao(descricao) {
  const col = colunaPorId('descricao');
  return wrapTexto(descricao, col.w, FONT_PRODUTO);
}

function alturaLinhaProduto(item) {
  const linhas = quebrarDescricao(item && item.descricao).length;
  return ALTURA_LINHA_BASE_MM + Math.max(0, linhas - 1) * ALTURA_LINHA_EXTRA_MM;
}

function mapearValoresLinha(item, { fmtMoney, fmtQtd }) {
  return {
    codigo: item && item.codigo != null ? String(item.codigo) : '',
    descricao: item && item.descricao != null ? String(item.descricao) : '',
    ncm: item && item.ncm != null ? String(item.ncm) : '',
    cst: item && item.cst != null ? String(item.cst) : '',
    cfop: item && item.cfop != null ? String(item.cfop) : '',
    unidade: item && item.unidade != null ? String(item.unidade) : '',
    quantidade: fmtQtd(item && item.qtd),
    valorUnitario: fmtMoney(item && item.vUn),
    valorTotal: fmtMoney(item && item.vProd),
    baseIcms: fmtMoney(item && item.vBC),
    valorIcms: fmtMoney(item && item.vICMS),
    valorIpi: fmtMoney(item && item.vIPI),
    aliquota: fmtMoney(item && item.pICMS)
  };
}

module.exports = {
  LARGURA_UTIL_TABELA_MM,
  FONT_PRODUTO,
  FONT_CABECALHO,
  ALTURA_CABECALHO_MM,
  ALTURA_LINHA_BASE_MM,
  ALTURA_LINHA_EXTRA_MM,
  MAX_LINHAS_DESCRICAO,
  COLUNAS_PRODUTOS,
  validarLargurasColunas,
  obterColunasProdutosDanfe,
  colunaPorId,
  charsPorLargura,
  wrapTexto,
  quebrarDescricao,
  alturaLinhaProduto,
  mapearValoresLinha
};
