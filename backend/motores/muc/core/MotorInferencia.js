/**
 * MUC RC1 — Motor de inferência de conversão
 * @module motores/muc/core/MotorInferencia
 */
'use strict';

const { inferirTipoConversao, normalizarTipoConversao } = require('../constants/tiposConversao');
const { normalizarTipoApresentacao } = require('../constants/tiposApresentacao');
const { parseApresentacaoRow, parseApresentacaoLegadoProduto } = require('./ParserApresentacoes');
const { num } = require('../dto/ConversaoDTO');

const ORIGENS_CONFIANCA = Object.freeze({
  APRESENTACAO_CADASTRADA: 100,
  GTIN: 95,
  CODIGO_FORNECEDOR: 90,
  APRENDIZADO: 85,
  XML: 75,
  LEGADO: 70,
  MANUAL: 60,
  INFERIDO: 50
});

/**
 * Resolve apresentação + fator a partir do contexto de conversão
 * @param {Object} dto - ConversaoDTO
 * @returns {{ apresentacao, fator, tipoConversao, confianca, metodoInferencia }}
 */
function inferirConversao(dto) {
  let apresentacao = dto.apresentacao ? parseApresentacaoRow(dto.apresentacao) : null;
  let metodo = 'DIRETO';
  let confianca = dto.confiancaInformada || ORIGENS_CONFIANCA.MANUAL;

  if (!apresentacao && dto.apresentacaoId && dto._apresentacaoCache) {
    apresentacao = parseApresentacaoRow(dto._apresentacaoCache);
    metodo = 'APRESENTACAO_ID';
    confianca = ORIGENS_CONFIANCA.APRESENTACAO_CADASTRADA;
  }

  if (!apresentacao && dto.produto) {
    apresentacao = parseApresentacaoLegadoProduto(dto.produto);
    if (apresentacao) {
      metodo = 'LEGADO_PRODUTO';
      confianca = ORIGENS_CONFIANCA.LEGADO;
    }
  }

  const tipoApresentacao = normalizarTipoApresentacao(
    apresentacao?.tipo ?? dto.unidadeCompra
  );
  const unidadeEstoque = String(
    apresentacao?.unidade ?? dto.unidadeEstoque ?? 'un'
  ).toLowerCase();

  let fator = num(
    apresentacao?.quantidade
    ?? dto.quantidadePorApresentacao
    ?? 1,
    4
  );
  if (tipoApresentacao === 'UN') fator = 1;

  const tipoConversao = normalizarTipoConversao(
    apresentacao?.tipoConversao
    ?? dto.tipoConversao
    ?? inferirTipoConversao(tipoApresentacao, unidadeEstoque)
  );

  if (dto.origem === 'GTIN' && dto.gtin) {
    metodo = 'GTIN';
    confianca = Math.max(confianca, ORIGENS_CONFIANCA.GTIN);
  } else if (dto.origem === 'FORNECEDOR' && dto.codigoFornecedor) {
    metodo = 'CODIGO_FORNECEDOR';
    confianca = Math.max(confianca, ORIGENS_CONFIANCA.CODIGO_FORNECEDOR);
  } else if (dto.origem === 'APRENDIZADO') {
    metodo = 'APRENDIZADO';
    confianca = Math.max(confianca, ORIGENS_CONFIANCA.APRENDIZADO);
  } else if (dto.origem === 'XML') {
    metodo = 'XML';
    confianca = Math.max(confianca, ORIGENS_CONFIANCA.XML);
  } else if (apresentacao?.id) {
    confianca = Math.max(confianca, ORIGENS_CONFIANCA.APRESENTACAO_CADASTRADA);
  }

  return {
    apresentacao,
    fator,
    tipoConversao,
    tipoApresentacao,
    unidadeEstoque,
    confianca,
    metodoInferencia: metodo
  };
}

module.exports = {
  inferirConversao,
  ORIGENS_CONFIANCA
};
