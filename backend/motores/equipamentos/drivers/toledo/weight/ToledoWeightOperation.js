/**
 * Sprint 14.9 — ToledoWeightOperation
 * Solicita peso via Driver (nunca TcpConnection).
 */

'use strict';

const ToledoOperation = require('../operations/ToledoOperation');
const { OperationError, CODES } = require('../operations/OperationErrors');
const frameBuilder = require('../ToledoFrameBuilder');
const { COMMANDS } = require('../ToledoProtocol');
const weightParser = require('./ToledoWeightParser');
const weightValidator = require('./ToledoWeightValidator');
const { WeightError, CODES: WCODES } = require('./ToledoWeightErrors');

class ToledoWeightOperation extends ToledoOperation {
  static get OPERATION() { return 'READ_WEIGHT'; }

  constructor(opcoes = {}) {
    super({
      ...opcoes,
      operation: 'READ_WEIGHT',
      timeout: opcoes.timeout != null ? opcoes.timeout : 2000
    });
    this.frame = opcoes.frame || null;
  }

  async run(ctx) {
    if (!ctx.driver) {
      throw OperationError.fromCode(CODES.CONNECTION_LOST, 'Driver ausente');
    }

    const frame = this.frame || frameBuilder.build(COMMANDS.READ_WEIGHT, {
      _proto: weightParser.PROTOCOL_PROFILE.version,
      ts: Date.now()
    });
    this.bytesSent = frame.length;

    await ctx.driver.sendFrame(frame);

    let raw;
    try {
      raw = await ctx.driver.receiveFrame({ timeoutMs: this.timeout });
    } catch (err) {
      throw WeightError.fromCode(
        WCODES.WEIGHT_TIMEOUT,
        err.message || 'Timeout na leitura de peso',
        { statusCode: 408 }
      );
    }

    this.bytesReceived = raw && raw.length ? raw.length : 0;

    weightValidator.validateFrame(raw);
    const parsed = weightParser.parse(raw);
    weightValidator.assertValid(parsed);

    return {
      peso: parsed.peso,
      unidade: parsed.unidade,
      estabilidade: parsed.estabilidade,
      estavel: parsed.estabilidade
    };
  }
}

module.exports = ToledoWeightOperation;
module.exports.ToledoWeightOperation = ToledoWeightOperation;
