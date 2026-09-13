/**
 * Sprint 14.6 — Operações concretas (Ping, Handshake, Identify)
 * Usam exclusivamente ctx.driver — nunca TcpConnection.
 */

'use strict';

const ToledoOperation = require('./ToledoOperation');
const { OperationError, CODES } = require('./OperationErrors');
const { FABRICANTE, MODELO, DRIVER, FIRMWARE_ALVO } = require('../ToledoProtocol');
const frameBuilder = require('../ToledoFrameBuilder');

class PingOperation extends ToledoOperation {
  static get OPERATION() { return 'PING'; }

  constructor(opcoes = {}) {
    super({ ...opcoes, operation: 'PING', timeout: opcoes.timeout != null ? opcoes.timeout : 2000 });
  }

  async run(ctx) {
    if (!ctx.driver) {
      throw OperationError.fromCode(CODES.CONNECTION_LOST, 'Driver ausente no contexto');
    }
    const frame = frameBuilder.buildPing();
    this.bytesSent = frame.length;
    const result = await ctx.driver.ping({ timeoutMs: this.timeout });
    this.bytesReceived = result.frame?.raw?.length || 0;
    return { ok: true, ping: true };
  }
}

class HandshakeOperation extends ToledoOperation {
  static get OPERATION() { return 'HANDSHAKE'; }

  constructor(opcoes = {}) {
    super({ ...opcoes, operation: 'HANDSHAKE', timeout: opcoes.timeout != null ? opcoes.timeout : 3000 });
  }

  async run(ctx) {
    if (!ctx.driver) {
      throw OperationError.fromCode(CODES.CONNECTION_LOST, 'Driver ausente no contexto');
    }
    const hsFrame = frameBuilder.buildHandshake();
    this.bytesSent = hsFrame.length;
    const result = await ctx.driver.handshake({ timeoutMs: this.timeout });
    this.bytesReceived = result.frame?.raw?.length || 0;
    return {
      ok: true,
      handshake: true,
      latencia: result.latencia
    };
  }
}

class IdentifyOperation extends ToledoOperation {
  static get OPERATION() { return 'IDENTIFY'; }

  constructor(opcoes = {}) {
    super({ ...opcoes, operation: 'IDENTIFY', timeout: opcoes.timeout != null ? opcoes.timeout : 4000 });
  }

  async run(ctx) {
    if (!ctx.driver) {
      throw OperationError.fromCode(CODES.CONNECTION_LOST, 'Driver ausente no contexto');
    }

    // Reutiliza handshake do Driver (sem TcpConnection direto)
    const hsFrame = frameBuilder.buildHandshake();
    this.bytesSent = hsFrame.length;
    let latencia = null;
    try {
      const hs = await ctx.driver.handshake({ timeoutMs: Math.min(this.timeout, 3000) });
      this.bytesReceived += hs.frame?.raw?.length || 0;
      latencia = hs.latencia;
    } catch (_) {
      // Se já online, tenta ping
      const ping = await ctx.driver.ping({ timeoutMs: Math.min(this.timeout, 2000) });
      this.bytesReceived += ping.frame?.raw?.length || 0;
    }

    return {
      ok: true,
      identify: `${FABRICANTE} ${MODELO}`.toUpperCase().replace(/\s+/g, ' '),
      fabricante: FABRICANTE,
      modelo: MODELO,
      driver: DRIVER,
      firmware: FIRMWARE_ALVO,
      latencia
    };
  }
}

module.exports = {
  PingOperation,
  HandshakeOperation,
  IdentifyOperation
};
