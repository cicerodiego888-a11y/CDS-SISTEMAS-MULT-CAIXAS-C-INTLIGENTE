/**
 * Leitura XLSX — Importação Inicial de Produtos V1.0.4.
 * Nunca executa SQL do arquivo; apenas extrai dados.
 */
'use strict';

const XLSX = require('xlsx');
const {
  chaveHeader,
  mapearLinhaProduto,
  mapearLinhaApresentacao,
  mapearLinhaQuantidade
} = require('./helpers');

function sheetParaObjetos(workbook, nomePreferido) {
  const nomes = workbook.SheetNames || [];
  const alvo = nomes.find((n) => chaveHeader(n) === chaveHeader(nomePreferido))
    || nomes.find((n) => chaveHeader(n).includes(chaveHeader(nomePreferido)));
  if (!alvo) return [];
  const sheet = workbook.Sheets[alvo];
  return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
}

/**
 * @param {Buffer|ArrayBuffer|Uint8Array} buffer
 */
function lerWorkbookXlsx(buffer) {
  return XLSX.read(buffer, { type: 'buffer', cellDates: true });
}

function extrairDadosImportacao(buffer) {
  const workbook = lerWorkbookXlsx(buffer);
  const abas = workbook.SheetNames || [];
  const produtosRaw = sheetParaObjetos(workbook, 'PRODUTOS');
  const apresentacoesRaw = sheetParaObjetos(workbook, 'APRESENTACOES');

  // RESUMO é ignorado para cadastro. Nunca usar como fonte de produtos.
  if (!produtosRaw.length && abas.length) {
    const primeiraUtil = abas.find((n) => {
      const k = chaveHeader(n);
      return k !== 'resumo'
        && k !== 'apresentacoes'
        && k !== 'quantidades'
        && !k.includes('resumo');
    });
    if (primeiraUtil && chaveHeader(primeiraUtil) !== 'produtos') {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[primeiraUtil], { defval: null, raw: true });
      produtosRaw.push(...rows);
    }
  }

  const produtos = produtosRaw
    .map(mapearLinhaProduto)
    .filter((p) => p.nome);
  const apresentacoes = apresentacoesRaw
    .map(mapearLinhaApresentacao)
    .filter((a) => a.codigo_origem || a.nome_produto || a.quantidade > 0);

  return {
    abas,
    produtos,
    apresentacoes,
    total_linhas_produtos: produtosRaw.length,
    total_linhas_apresentacoes: apresentacoesRaw.length
  };
}

/**
 * Extrai aba QUANTIDADES para o modo Atualizar Quantidades.
 */
function extrairDadosQuantidades(buffer) {
  const workbook = lerWorkbookXlsx(buffer);
  const abas = workbook.SheetNames || [];
  let quantidadesRaw = sheetParaObjetos(workbook, 'QUANTIDADES');

  if (!quantidadesRaw.length && abas.length) {
    const primeiraUtil = abas.find((n) => {
      const k = chaveHeader(n);
      return k !== 'resumo' && !k.includes('resumo');
    });
    if (primeiraUtil) {
      quantidadesRaw = XLSX.utils.sheet_to_json(workbook.Sheets[primeiraUtil], { defval: null, raw: true });
    }
  }

  const quantidades = quantidadesRaw
    .map(mapearLinhaQuantidade)
    .filter((q) => q.codigo_origem || q.nome);

  return {
    abas,
    quantidades,
    total_linhas: quantidadesRaw.length
  };
}

/**
 * Gera buffer XLSX de teste (fixture) — cadastro inicial.
 */
function gerarXlsxFixture({ produtos = [], apresentacoes = [] } = {}) {
  const wb = XLSX.utils.book_new();
  const wsProd = XLSX.utils.json_to_sheet(produtos);
  XLSX.utils.book_append_sheet(wb, wsProd, 'PRODUTOS');
  if (apresentacoes.length) {
    const wsApr = XLSX.utils.json_to_sheet(apresentacoes);
    XLSX.utils.book_append_sheet(wb, wsApr, 'APRESENTACOES');
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Gera buffer XLSX de teste — atualização de quantidades.
 */
function gerarXlsxQuantidadesFixture({ quantidades = [] } = {}) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(quantidades);
  XLSX.utils.book_append_sheet(wb, ws, 'QUANTIDADES');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  lerWorkbookXlsx,
  extrairDadosImportacao,
  extrairDadosQuantidades,
  gerarXlsxFixture,
  gerarXlsxQuantidadesFixture,
  sheetParaObjetos
};
