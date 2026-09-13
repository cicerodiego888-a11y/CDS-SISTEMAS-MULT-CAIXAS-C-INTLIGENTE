/**
 * MUC RC1 — Parser de apresentações (ProdutoApresentacao)
 * Normaliza linhas de produto_embalagens e legado produtos.*
 * @module motores/muc/core/ParserApresentacoes
 */
'use strict';

const { normalizarTipoApresentacao, tipoParaUnidadeComercial } = require('../constants/tiposApresentacao');
const { normalizarTipoConversao, inferirTipoConversao } = require('../constants/tiposConversao');
const { num } = require('../dto/ConversaoDTO');

/**
 * Converte row produto_embalagens → ProdutoApresentacao DTO
 * @param {Object} row
 * @returns {Object|null}
 */
function parseApresentacaoRow(row) {
  if (!row) return null;
  const tipo = normalizarTipoApresentacao(row.tipo);
  const unidadeBase = String(row.unidade || 'un').toLowerCase();
  return Object.freeze({
    id: row.id,
    produtoId: row.produto_id,
    tipo,
    descricao: row.descricao || null,
    quantidade: num(row.quantidade, 4) || 1,
    unidade: unidadeBase,
    unidadeComercial: tipoParaUnidadeComercial(tipo),
    gtin: row.gtin || null,
    codigoFornecedor: row.codigo_fornecedor || null,
    codigoInternoFornecedor: row.codigo_interno_fornecedor || null,
    fornecedorCnpj: row.fornecedor_cnpj || null,
    fornecedorNome: row.fornecedor_nome || null,
    fornecedorDescricao: row.fornecedor_descricao || null,
    valorCompra: num(row.valor_compra, 2),
    precoVenda: num(row.preco_venda, 2),
    tipoConversao: normalizarTipoConversao(
      row.tipo_conversao || inferirTipoConversao(tipo, unidadeBase)
    ),
    principal: Number(row.principal || 0) === 1,
    compra: Number(row.compra ?? 1) === 1,
    venda: Number(row.venda ?? 1) === 1,
    estoque: Number(row.estoque ?? 1) === 1,
    ativa: Number(row.ativa ?? 1) === 1,
    vigenciaInicio: row.vigencia_inicio || null,
    vigenciaFim: row.vigencia_fim || null,
    origem: row.origem || 'CADASTRO',
    observacao: row.observacao || null
  });
}

/** Legado produtos → apresentação sintética */
function parseApresentacaoLegadoProduto(produto) {
  if (!produto) return null;
  const uc = String(produto.unidade_comercial || 'UN').toUpperCase();
  const qtd = num(produto.quantidade_por_embalagem, 4);
  if (qtd <= 0 && uc === 'UN') return null;

  const tipo = normalizarTipoApresentacao(uc);
  const unidadeBase = String(produto.unidade || 'un').toLowerCase();
  return parseApresentacaoRow({
    id: null,
    produto_id: produto.id,
    tipo,
    quantidade: qtd || 1,
    unidade: unidadeBase,
    gtin: produto.codigo_barras || null,
    fornecedor_nome: produto.fornecedor || null,
    valor_compra: produto.valor_compra_embalagem || 0,
    preco_venda: num(produto.preco_venda, 2) * (qtd || 1),
    principal: 1,
    compra: produto.compra_por_embalagem ?? 1,
    venda: 1,
    estoque: 1,
    ativa: 1,
    origem: 'LEGADO'
  });
}

function parseListaApresentacoes(rows) {
  return (rows || []).map(parseApresentacaoRow).filter(Boolean);
}

module.exports = {
  parseApresentacaoRow,
  parseApresentacaoLegadoProduto,
  parseListaApresentacoes
};
