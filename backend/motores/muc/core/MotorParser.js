/**
 * MUC RC2 — Etapa 1: Parser
 * @module motores/muc/core/MotorParser
 */
'use strict';

const { criarConversaoDTO } = require('../dto/ConversaoDTO');
const { parseApresentacaoRow } = require('./ParserApresentacoes');

function executar(input = {}) {
  const dto = criarConversaoDTO(input);
  const apresentacao = input.apresentacao
    ? parseApresentacaoRow(input.apresentacao)
    : null;
  return Object.freeze({
    input,
    dto,
    apresentacao,
    origemDados: input.origemDados
      || (input.item?.origem_conversao ? 'ITEM_COMPRA' : 'API')
  });
}

module.exports = { executar };
