/**
 * MUC RC1 — DTO de entrada para conversão
 * @module motores/muc/dto/ConversaoDTO
 */
'use strict';

const { normalizarTipoConversao } = require('../constants/tiposConversao');
const { normalizarTipoApresentacao } = require('../constants/tiposApresentacao');

function num(v, casas = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** casas) / 10 ** casas;
}

/**
 * @param {Object} raw
 * @returns {Object}
 */
function criarConversaoDTO(raw = {}) {
  const item = raw.item || raw;
  return Object.freeze({
    produtoId: raw.produtoId ?? item.produto_id ?? null,
    apresentacaoId: raw.apresentacaoId
      ?? raw.embalagemId
      ?? item.produto_apresentacao_id
      ?? item.embalagem_id
      ?? null,
    apresentacao: raw.apresentacao || null,
    produto: raw.produto || null,
    item,
    origem: String(raw.origem || item.origem_conversao || 'MANUAL').toUpperCase(),
    quantidadeCompra: num(raw.quantidadeCompra ?? item.quantidade_comercial ?? item.quantidade_embalagens ?? 0, 4),
    unidadeCompra: normalizarTipoApresentacao(
      raw.unidadeCompra ?? item.compra_em ?? item.unidade_comercial ?? 'UN'
    ),
    quantidadePorApresentacao: num(
      raw.quantidadePorApresentacao ?? item.quantidade_por_embalagem ?? raw.apresentacao?.quantidade,
      4
    ),
    valorTotalCompra: num(raw.valorTotalCompra ?? item.valor_total_embalagem ?? item.subtotal, 2),
    unidadeEstoque: String(raw.unidadeEstoque ?? item.unidade ?? raw.produto?.unidade ?? 'un').toLowerCase(),
    tipoConversao: raw.tipoConversao != null
      ? normalizarTipoConversao(raw.tipoConversao)
      : (item.tipo_conversao != null ? normalizarTipoConversao(item.tipo_conversao) : null),
    quantidadeFiscal: item.quantidade_fiscal,
    quantidadeNaoFiscal: item.quantidade_nao_fiscal,
    fornecedorCnpj: raw.fornecedorCnpj ?? item.fornecedor_cnpj ?? null,
    gtin: raw.gtin ?? item.codigo_barras ?? null,
    codigoFornecedor: raw.codigoFornecedor ?? item.codigo_fornecedor ?? null,
    descricao: raw.descricao ?? item.produto_nome ?? item.descricao_produto ?? null,
    usuarioId: raw.usuarioId ?? null,
    usuarioNome: raw.usuarioNome ?? null,
    motivo: raw.motivo ?? null,
    confiancaInformada: num(raw.confianca ?? item.confianca_conversao, 2)
  });
}

module.exports = { criarConversaoDTO, num };
