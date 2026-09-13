/**
 * Sprint 14.6 — ToledoOperation (classe base)
 */

'use strict';

const crypto = require('crypto');
const OperationResult = require('./OperationResult');
const { OperationError, CODES } = require('./OperationErrors');

class ToledoOperation {
  /**
   * @param {object} [opcoes]
   */
  constructor(opcoes = {}) {
    this.id = opcoes.id || crypto.randomBytes(8).toString('hex');
    this.operation = opcoes.operation || this.constructor.OPERATION || 'UNKNOWN';
    this.startedAt = null;
    this.finishedAt = null;
    this.status = 'PENDING';
    this.timeout = opcoes.timeout != null ? Number(opcoes.timeout) : 3000;
    this.retries = Number(opcoes.retries) || 0;
    this._cancelled = false;
    this.bytesSent = 0;
    this.bytesReceived = 0;
  }

  cancel() {
    this._cancelled = true;
    if (this.status === 'PENDING' || this.status === 'QUEUED' || this.status === 'RUNNING') {
      this.status = 'CANCELLED';
      this.finishedAt = new Date().toISOString();
    }
  }

  get cancelled() {
    return this._cancelled;
  }

  /**
   * @param {import('./OperationContext')} _ctx
   */
  async run(_ctx) {
    throw OperationError.fromCode(CODES.UNSUPPORTED_OPERATION, 'Operação não implementada');
  }

  /**
   * @param {import('./OperationContext')} ctx
   * @returns {Promise<OperationResult>}
   */
  async execute(ctx) {
    if (this._cancelled) {
      return new OperationResult({
        success: false,
        operation: this.operation,
        operationId: this.id,
        status: 'CANCELLED',
        error: CODES.OPERATION_CANCELLED
      });
    }

    this.status = 'RUNNING';
    this.startedAt = new Date().toISOString();
    const inicio = process.hrtime.bigint();

    try {
      const data = await Promise.race([
        this.run(ctx),
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(OperationError.fromCode(CODES.TIMEOUT, `Timeout na operação ${this.operation}`, {
              statusCode: 408
            }));
          }, this.timeout);
        })
      ]);

      if (this._cancelled) {
        this.status = 'CANCELLED';
        this.finishedAt = new Date().toISOString();
        return new OperationResult({
          success: false,
          operation: this.operation,
          operationId: this.id,
          status: 'CANCELLED',
          duration: Math.round(Number(process.hrtime.bigint() - inicio) / 1e6),
          bytesSent: this.bytesSent,
          bytesReceived: this.bytesReceived,
          error: CODES.OPERATION_CANCELLED
        });
      }

      this.status = 'SUCCESS';
      this.finishedAt = new Date().toISOString();
      return new OperationResult({
        success: true,
        operation: this.operation,
        operationId: this.id,
        status: 'SUCCESS',
        duration: Math.round(Number(process.hrtime.bigint() - inicio) / 1e6),
        bytesSent: this.bytesSent,
        bytesReceived: this.bytesReceived,
        data
      });
    } catch (err) {
      this.status = this._cancelled ? 'CANCELLED' : 'ERROR';
      this.finishedAt = new Date().toISOString();
      return new OperationResult({
        success: false,
        operation: this.operation,
        operationId: this.id,
        status: this.status,
        duration: Math.round(Number(process.hrtime.bigint() - inicio) / 1e6),
        bytesSent: this.bytesSent,
        bytesReceived: this.bytesReceived,
        error: err.code || err.message || CODES.DRIVER_ERROR
      });
    }
  }

  snapshot() {
    return {
      id: this.id,
      operation: this.operation,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      status: this.status,
      timeout: this.timeout,
      retries: this.retries
    };
  }
}

module.exports = ToledoOperation;
module.exports.ToledoOperation = ToledoOperation;
