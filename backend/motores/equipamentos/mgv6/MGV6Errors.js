/**
 * Sprint 14.15.1 — Erros do Bridge MGV6 (compatibilidade / exportação).
 * Não faz parte do Driver Toledo TCP.
 */

'use strict';

const CODES = Object.freeze({
  VALIDATION_ERROR: 'MGV6_VALIDATION_ERROR',
  CONFIG_INVALID: 'MGV6_CONFIG_INVALID',
  CODE_INVALID: 'MGV6_CODE_INVALID',
  PRICE_INVALID: 'MGV6_PRICE_INVALID',
  DESCRIPTION_INVALID: 'MGV6_DESCRIPTION_INVALID',
  ENCODING_ERROR: 'MGV6_ENCODING_ERROR',
  PATH_INVALID: 'MGV6_PATH_INVALID',
  PATH_TRAVERSAL: 'MGV6_PATH_TRAVERSAL',
  FOLDER_INVALID: 'MGV6_FOLDER_INVALID',
  WRITE_DENIED: 'MGV6_WRITE_DENIED',
  EXPORT_FAILED: 'MGV6_EXPORT_FAILED',
  /** RC14.15.11 — arquivo TXITENS inválido (não inicia MGV6) */
  FILE_INVALID: 'MGV6_FILE_INVALID',
  LAUNCH_DISABLED: 'MGV6_LAUNCH_DISABLED',
  LAUNCH_INVALID: 'MGV6_LAUNCH_INVALID',
  LAUNCH_FAILED: 'MGV6_LAUNCH_FAILED',
  /** RC14.15.19 — EXE ausente antes do ShellExecute */
  EXECUTABLE_NOT_FOUND: 'MGV6_EXECUTABLE_NOT_FOUND',
  EQUIPAMENTO_INVALID: 'MGV6_EQUIPAMENTO_INVALID',
  PRODUTO_INVALID: 'MGV6_PRODUTO_INVALID',
  NOT_ENABLED: 'MGV6_NOT_ENABLED',
  EMPTY_LIST: 'MGV6_EMPTY_LIST',
  /** RC14.15.4 — registro TXITENS excede 320 caracteres */
  RECORD_OVERFLOW: 'MGV6_RECORD_OVERFLOW',
  /** RC14.15.5 — descrição ultrapassa área 300 (pos 20–319) */
  DESCRIPTION_OVERFLOW: 'MGV6_DESCRIPTION_OVERFLOW',
  /** RC14.15.5 — registro final ≠ 320 */
  RECORD_SIZE_INVALID: 'MGV6_RECORD_SIZE_INVALID',
  /** @deprecated RC14.15.5 — residual; gate ativo é PRODUCT_PLU_REQUIRED */
  PRODUCT_IDENTITY_REQUIRED: 'MGV6_PRODUCT_IDENTITY_REQUIRED',
  /** Integrar com Balança sem PLU (código do item da balança) */
  PRODUCT_PLU_REQUIRED: 'MGV6_PRODUCT_PLU_REQUIRED',
  /** Produto não marcado para Integrar com Balança */
  PRODUCT_NOT_INTEGRATED: 'MGV6_PRODUCT_NOT_INTEGRATED',
  /** Código do item com mais de 9 dígitos no bloco posicional TX */
  CODE_OVERFLOW: 'MGV6_CODE_OVERFLOW',
  /** RC14.15.3 — bloqueio cruzado de pipelines */
  MODO_ENVIO_TCP: 'MODO_ENVIO_TCP',
  MODO_ENVIO_MGV6: 'MODO_ENVIO_MGV6'
});

class MGV6Error extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'MGV6Error';
    this.code = code || CODES.VALIDATION_ERROR;
    this.statusCode = details.statusCode || 400;
    this.details = details;
  }

  /**
   * @param {string} code
   * @param {string} message
   * @param {object} [details]
   */
  static fromCode(code, message, details = {}) {
    return new MGV6Error(code, message, details);
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      details: this.details || undefined
    };
  }
}

module.exports = {
  CODES,
  MGV6Error
};
