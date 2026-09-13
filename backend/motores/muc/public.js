/**
 * MUC RC2.1 — Superfície pública oficial (única entrada permitida para consumidores)
 * @module motores/muc/public
 */
'use strict';

const { obterMuc, VERSAO, EVENTOS_PUBLICOS } = require('./index');
const { criarConversaoDTO } = require('./dto/ConversaoDTO');
const { criarResultadoConversaoDTO, resultadoParaJson, resultadoFromJson } = require('./dto/ResultadoConversaoDTO');
const { criarProdutoApresentacaoDTO, criarProdutoApresentacaoLegadoDTO, criarListaProdutoApresentacaoDTO } = require('./dto/ProdutoApresentacaoDTO');
const { criarRegraConversaoDTO } = require('./dto/RegraConversaoDTO');

module.exports = {
  obterMuc,
  VERSAO,
  EVENTOS_PUBLICOS,
  criarConversaoDTO,
  criarResultadoConversaoDTO,
  criarProdutoApresentacaoDTO,
  criarProdutoApresentacaoLegadoDTO,
  criarListaProdutoApresentacaoDTO,
  criarRegraConversaoDTO,
  resultadoParaJson,
  resultadoFromJson
};
