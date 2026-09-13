/**
 * Sprint 14.8 / 15.5 — ToledoSyncErrors
 */

'use strict';

const CODES = Object.freeze({
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  DOWNLOAD_CANCELLED: 'DOWNLOAD_CANCELLED',
  COMPARE_FAILED: 'COMPARE_FAILED',
  PLAN_INVALID: 'PLAN_INVALID',
  SYNC_NOT_CONFIRMED: 'SYNC_NOT_CONFIRMED',
  SYNC_CANCELLED: 'SYNC_CANCELLED',
  SYNC_FAILED: 'SYNC_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ROLLBACK_FAILED: 'ROLLBACK_FAILED',
  NO_CHANGES: 'NO_CHANGES'
});

class SyncError extends Error {
  constructor(code, message, meta = {}) {
    super(message || code);
    this.name = 'SyncError';
    this.code = code || CODES.SYNC_FAILED;
    this.statusCode = meta.statusCode || 400;
    this.meta = meta;
  }

  static fromCode(code, message, meta) {
    return new SyncError(code, message || code, meta);
  }
}

module.exports = { SyncError, CODES, ...CODES };
