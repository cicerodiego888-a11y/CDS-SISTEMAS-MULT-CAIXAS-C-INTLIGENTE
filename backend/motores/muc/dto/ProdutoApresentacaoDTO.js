/**
 * MUC RC2.1 — ProdutoApresentacaoDTO (contrato público)
 * @module motores/muc/dto/ProdutoApresentacaoDTO
 */
'use strict';

const { parseApresentacaoRow, parseApresentacaoLegadoProduto, parseListaApresentacoes } = require('../core/ParserApresentacoes');

/**
 * @param {Object} row — linha produto_embalagens ou objeto equivalente
 * @returns {Readonly<Object>|null}
 */
function criarProdutoApresentacaoDTO(row) {
  return parseApresentacaoRow(row);
}

function criarProdutoApresentacaoLegadoDTO(produto) {
  return parseApresentacaoLegadoProduto(produto);
}

function criarListaProdutoApresentacaoDTO(rows) {
  return Object.freeze(parseListaApresentacoes(rows));
}

module.exports = {
  criarProdutoApresentacaoDTO,
  criarProdutoApresentacaoLegadoDTO,
  criarListaProdutoApresentacaoDTO
};
