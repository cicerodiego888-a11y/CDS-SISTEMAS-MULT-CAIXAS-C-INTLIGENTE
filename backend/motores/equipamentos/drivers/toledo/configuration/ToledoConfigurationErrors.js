/**
 * Sprint 14.11 — ToledoConfigurationErrors
 */

'use strict';

const CODES = Object.freeze({
  INVALID_INPUT: 'CONFIG_INVALID_INPUT',
  UNKNOWN_PARAM: 'CONFIG_UNKNOWN_PARAM',
  READONLY_PARAM: 'CONFIG_READONLY_PARAM',
  OUT_OF_RANGE: 'CONFIG_OUT_OF_RANGE',
  TYPE_INVALID: 'CONFIG_TYPE_INVALID',
  READ_FAILED: 'CONFIG_READ_FAILED',
  WRITE_FAILED: 'CONFIG_WRITE_FAILED',
  PROFILE_NOT_FOUND: 'CONFIG_PROFILE_NOT_FOUND',
  NACK: 'CONFIG_NACK',
  FRAME_INVALID: 'CONFIG_FRAME_INVALID',
  UNSUPPORTED: 'CONFIG_UNSUPPORTED'
});

class ConfigurationError extends Error {
  constructor(code, message, meta = {}) {
    super(message || code);
    this.name = 'ConfigurationError';
    this.code = code || CODES.WRITE_FAILED;
    this.statusCode = meta.statusCode || 400;
    this.meta = meta;
  }

  static fromCode(code, message, meta) {
    return new ConfigurationError(code, message || code, meta);
  }
}

module.exports = { ConfigurationError, CODES, ...CODES };
