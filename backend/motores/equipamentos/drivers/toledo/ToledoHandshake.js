/**
 * Sprint 14.4 — ToledoHandshake
 * Handshake oficial via frames. Sem abrir socket.
 */

'use strict';

const frameBuilder = require('./ToledoFrameBuilder');
const frameParser = require('./ToledoFrameParser');
const { LIMITS, RESPONSES } = require('./ToledoProtocol');
const { ToledoError, CODES } = require('./ToledoErrors');

/**
 * @param {{sendFrame:Function, receiveFrame:Function, timeoutMs?:number}} canal
 * @returns {Promise<{ok:boolean, latencia:number, frame:object}>}
 */
async function executar(canal, opcoes = {}) {
  if (!canal || typeof canal.sendFrame !== 'function' || typeof canal.receiveFrame !== 'function') {
    throw ToledoError.fromCode(CODES.DRIVER_ERROR, 'Canal de handshake inválido');
  }

  const timeoutMs = opcoes.timeoutMs != null ? Number(opcoes.timeoutMs) : LIMITS.handshakeTimeoutMs;
  const inicio = process.hrtime.bigint();
  const frameHs = frameBuilder.buildHandshake(opcoes.payload || {});

  await canal.sendFrame(frameHs);
  const raw = await canal.receiveFrame({ timeoutMs });

  if (!raw || !raw.length) {
    throw ToledoError.fromCode(CODES.CONNECTION_TIMEOUT, 'Timeout no handshake', {
      statusCode: 408
    });
  }

  let parsed;
  try {
    parsed = frameParser.parse(raw);
  } catch (err) {
    if (err.code === CODES.CHECKSUM_ERROR) throw err;
    throw ToledoError.fromCode(CODES.INVALID_RESPONSE, err.message || 'Resposta inválida no handshake');
  }

  if (parsed.comando === RESPONSES.NAK || parsed.isNak) {
    throw ToledoError.fromCode(CODES.HANDSHAKE_FAILED, 'Handshake rejeitado (NAK)');
  }

  if (parsed.comando !== RESPONSES.ACK && !parsed.isAck) {
    throw ToledoError.fromCode(
      CODES.INVALID_RESPONSE,
      `Resposta inesperada no handshake: ${parsed.comando}`
    );
  }

  const latencia = Math.max(0, Math.round(Number(process.hrtime.bigint() - inicio) / 1e6));
  return { ok: true, latencia, frame: parsed };
}

module.exports = {
  executar,
  handshake: executar
};
