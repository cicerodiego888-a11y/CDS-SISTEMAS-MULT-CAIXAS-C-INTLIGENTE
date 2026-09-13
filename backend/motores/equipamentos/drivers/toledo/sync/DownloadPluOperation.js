/**
 * Sprint 14.8 — DownloadPluOperation (Operation Engine)
 * Framing V1 Lab (DP) — mesma pilha Driver → ConnectionManager.
 */

'use strict';

const ToledoOperation = require('../operations/ToledoOperation');
const { OperationError, CODES } = require('../operations/OperationErrors');
const frameBuilder = require('../ToledoFrameBuilder');
const { COMMANDS } = require('../ToledoProtocol');
const downloadParser = require('./ToledoDownloadParser');

class DownloadPluOperation extends ToledoOperation {
  static get OPERATION() { return 'DOWNLOAD_PLU'; }

  constructor(opcoes = {}) {
    super({
      ...opcoes,
      operation: 'DOWNLOAD_PLU',
      timeout: opcoes.timeout != null ? opcoes.timeout : 8000
    });
    this.range = opcoes.range || { all: true };
    this.frame = opcoes.frame || null;
  }

  async run(ctx) {
    if (!ctx.driver) {
      throw OperationError.fromCode(CODES.CONNECTION_LOST, 'Driver ausente');
    }
    const frame = this.frame || frameBuilder.build(COMMANDS.DOWNLOAD_PLU, this.range);
    this.bytesSent = frame.length;
    await ctx.driver.sendFrame(frame);
    const raw = await ctx.driver.receiveFrame({ timeoutMs: this.timeout });
    this.bytesReceived = raw && raw.length ? raw.length : 0;
    const parsed = downloadParser.parseResponse(raw);
    return {
      ok: true,
      plus: parsed.plus,
      total: parsed.plus.length,
      payload: parsed.payload
    };
  }
}

module.exports = DownloadPluOperation;
module.exports.DownloadPluOperation = DownloadPluOperation;
