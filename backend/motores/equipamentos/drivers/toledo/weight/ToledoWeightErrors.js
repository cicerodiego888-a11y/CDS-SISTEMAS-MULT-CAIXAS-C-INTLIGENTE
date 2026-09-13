/**
 * Sprint 14.9 — ToledoWeightErrors
 */

'use strict';

const CODES = Object.freeze({
  WEIGHT_TIMEOUT: 'WEIGHT_TIMEOUT',
  WEIGHT_INVALID: 'WEIGHT_INVALID',
  WEIGHT_NEGATIVE: 'WEIGHT_NEGATIVE',
  WEIGHT_UNSTABLE: 'WEIGHT_UNSTABLE',
  FRAME_INVALID: 'FRAME_INVALID',
  CHECKSUM_ERROR: 'CHECKSUM_ERROR',
  NACK: 'NACK',
  CANCELLED: 'WEIGHT_CANCELLED',
  INVALID_INPUT: 'INVALID_INPUT',
  READ_ERROR: 'WEIGHT_READ_ERROR'
});

class WeightError extends Error {
  constructor(code, message, meta = {}) {
    super(message || code);
    this.name = 'WeightError';
    this.code = code || CODES.READ_ERROR;
    this.statusCode = meta.statusCode || 400;
    this.meta = meta;
  }

  static fromCode(code, message, meta) {
    return new WeightError(code, message || code, meta);
  }
}

module.exports = { WeightError, CODES, ...CODES };
