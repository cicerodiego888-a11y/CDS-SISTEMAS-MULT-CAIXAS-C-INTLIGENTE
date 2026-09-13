/**
 * Sprint 14.6 — OperationResult
 */

'use strict';

class OperationResult {
  constructor(dados = {}) {
    this.success = dados.success === true;
    this.operation = dados.operation || null;
    this.duration = dados.duration != null ? Number(dados.duration) : 0;
    this.bytesSent = Number(dados.bytesSent) || 0;
    this.bytesReceived = Number(dados.bytesReceived) || 0;
    this.error = dados.error || null;
    this.data = dados.data != null ? dados.data : null;
    this.operationId = dados.operationId || null;
    this.status = dados.status || (this.success ? 'SUCCESS' : 'ERROR');
  }

  paraApi() {
    return {
      success: this.success,
      operation: this.operation,
      duration: this.duration,
      bytesSent: this.bytesSent,
      bytesReceived: this.bytesReceived,
      error: this.error,
      data: this.data,
      operationId: this.operationId,
      status: this.status
    };
  }
}

module.exports = OperationResult;
module.exports.OperationResult = OperationResult;
