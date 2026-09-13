/**
 * Sprint 14.7 — ToledoPluErrors
 */

'use strict';

const CODES = Object.freeze({
  PLU_REQUIRED: 'PLU_REQUIRED',
  DESCRICAO_REQUIRED: 'DESCRICAO_REQUIRED',
  PRECO_REQUIRED: 'PRECO_REQUIRED',
  PRECO_INVALIDO: 'PRECO_INVALIDO',
  CAMPO_OBRIGATORIO: 'CAMPO_OBRIGATORIO',
  TAMANHO_EXCEDIDO: 'TAMANHO_EXCEDIDO',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NACK: 'NACK',
  ACK_AUSENTE: 'ACK_AUSENTE',
  UPLOAD_CANCELLED: 'UPLOAD_CANCELLED',
  UPLOAD_ERROR: 'UPLOAD_ERROR',
  PROTOCOL_PENDING: 'PROTOCOL_PENDING',
  UPLOAD_USANDO_SESSAO_DIFERENTE: 'UPLOAD_USANDO_SESSAO_DIFERENTE'
});

class PluError extends Error {
  constructor(code, message, meta = {}) {
    super(message || code);
    this.name = 'PluError';
    this.code = code || CODES.UPLOAD_ERROR;
    this.statusCode = meta.statusCode || 400;
    this.meta = meta;
  }

  static fromCode(code, message, meta) {
    return new PluError(code, message || code, meta);
  }
}

module.exports = { PluError, CODES, ...CODES };
