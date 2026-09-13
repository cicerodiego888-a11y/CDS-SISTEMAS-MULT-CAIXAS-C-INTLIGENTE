/**
 * Sprint 14.11 — ToledoConfigurationOperation
 */

'use strict';

const ToledoOperation = require('../operations/ToledoOperation');
const { OperationError, CODES } = require('../operations/OperationErrors');
const frameBuilder = require('../ToledoFrameBuilder');
const { COMMANDS } = require('../ToledoProtocol');
const configParser = require('./ToledoConfigurationParser');
const { ConfigurationError, CODES: CCODES } = require('./ToledoConfigurationErrors');

class ToledoConfigurationOperation extends ToledoOperation {
  static get OPERATION() { return 'CONFIG'; }

  constructor(opcoes = {}) {
    const mode = opcoes.mode === 'write'
      || String(opcoes.operation || '').toUpperCase() === 'CONFIG_WRITE'
      ? 'write'
      : 'read';
    super({
      ...opcoes,
      operation: mode === 'write' ? 'CONFIG_WRITE' : 'CONFIG_READ',
      timeout: opcoes.timeout != null ? opcoes.timeout : 4000
    });
    this.mode = mode;
    this.parametros = opcoes.parametros || {};
    this.frame = opcoes.frame || null;
  }

  async run(ctx) {
    if (!ctx.driver) {
      throw OperationError.fromCode(CODES.CONNECTION_LOST, 'Driver ausente');
    }

    let frame = this.frame;
    if (!frame) {
      if (this.mode === 'write') {
        frame = frameBuilder.build(COMMANDS.CONFIG_WRITE, {
          parametros: this.parametros,
          _proto: configParser.PROTOCOL_PROFILE.version
        });
      } else {
        frame = frameBuilder.build(COMMANDS.CONFIG_READ, {
          _proto: configParser.PROTOCOL_PROFILE.version,
          ts: Date.now()
        });
      }
    }

    this.bytesSent = frame.length;
    await ctx.driver.sendFrame(frame);

    let raw;
    try {
      raw = await ctx.driver.receiveFrame({ timeoutMs: this.timeout });
    } catch (err) {
      throw ConfigurationError.fromCode(
        this.mode === 'write' ? CCODES.WRITE_FAILED : CCODES.READ_FAILED,
        err.message || 'Timeout na configuração',
        { statusCode: 408 }
      );
    }

    this.bytesReceived = raw && raw.length ? raw.length : 0;
    const parsed = configParser.parse(raw);

    return {
      mode: this.mode,
      parametros: parsed.parametros,
      firmware: parsed.firmware,
      modelo: parsed.modelo,
      ack: parsed.ack
    };
  }
}

module.exports = ToledoConfigurationOperation;
module.exports.ToledoConfigurationOperation = ToledoConfigurationOperation;
