/**
 * Sprint 14.4 — ToledoErrors
 */

'use strict';

const CODES = Object.freeze({
  CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
  INVALID_FRAME: 'INVALID_FRAME',
  CHECKSUM_ERROR: 'CHECKSUM_ERROR',
  UNSUPPORTED_PROTOCOL: 'UNSUPPORTED_PROTOCOL',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  HANDSHAKE_FAILED: 'HANDSHAKE_FAILED',
  NOT_CONNECTED: 'NOT_CONNECTED',
  DRIVER_ERROR: 'DRIVER_ERROR'
});

class ToledoError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {object} [meta]
   */
  constructor(code, message, meta = {}) {
    super(message || code);
    this.name = 'ToledoError';
    this.code = code || CODES.DRIVER_ERROR;
    this.statusCode = meta.statusCode || 502;
    this.meta = meta;
  }

  static fromCode(code, message, meta) {
    return new ToledoError(code, message || code, meta);
  }
}

module.exports = {
  ToledoError,
  CODES,
  CONNECTION_TIMEOUT: CODES.CONNECTION_TIMEOUT,
  INVALID_FRAME: CODES.INVALID_FRAME,
  CHECKSUM_ERROR: CODES.CHECKSUM_ERROR,
  UNSUPPORTED_PROTOCOL: CODES.UNSUPPORTED_PROTOCOL,
  DEVICE_OFFLINE: CODES.DEVICE_OFFLINE,
  INVALID_RESPONSE: CODES.INVALID_RESPONSE,
  HANDSHAKE_FAILED: CODES.HANDSHAKE_FAILED,
  NOT_CONNECTED: CODES.NOT_CONNECTED
};
