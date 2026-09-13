/**
 * Sprint 14.6 — OperationErrors
 */

'use strict';

const CODES = Object.freeze({
  QUEUE_BUSY: 'QUEUE_BUSY',
  TIMEOUT: 'TIMEOUT',
  CONNECTION_LOST: 'CONNECTION_LOST',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  OPERATION_CANCELLED: 'OPERATION_CANCELLED',
  INVALID_INPUT: 'INVALID_INPUT',
  UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',
  DRIVER_ERROR: 'DRIVER_ERROR'
});

class OperationError extends Error {
  constructor(code, message, meta = {}) {
    super(message || code);
    this.name = 'OperationError';
    this.code = code || CODES.DRIVER_ERROR;
    this.statusCode = meta.statusCode || 502;
    this.meta = meta;
  }

  static fromCode(code, message, meta) {
    return new OperationError(code, message || code, meta);
  }
}

module.exports = {
  OperationError,
  CODES,
  ...CODES
};
