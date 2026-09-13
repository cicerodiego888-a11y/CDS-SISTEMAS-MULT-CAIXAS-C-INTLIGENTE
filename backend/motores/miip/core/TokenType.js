/**
 * TokenType — Tipos semânticos de tokens canônicos.
 *
 * Sprint 7.1 — base para motores de Atributos, Sinônimos e Similaridade.
 *
 * @module motores/miip/core/TokenType
 */

const TokenType = Object.freeze({
  PALAVRA: 'PALAVRA',
  NUMERO: 'NUMERO',
  MEDIDA: 'MEDIDA',
  MARCA: 'MARCA',
  UNIDADE: 'UNIDADE',
  QUANTIDADE: 'QUANTIDADE',
  EMBALAGEM: 'EMBALAGEM',
  DESCONHECIDO: 'DESCONHECIDO'
});

module.exports = TokenType;
