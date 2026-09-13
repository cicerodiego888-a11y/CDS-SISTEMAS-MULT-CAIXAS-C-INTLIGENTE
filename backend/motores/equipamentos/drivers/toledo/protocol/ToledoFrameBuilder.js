/**
 * Sprint 15.2 — ToledoFrameBuilder (Motor 90AX)
 * Constrói quadros oficiais. Drivers NÃO montam bytes manualmente.
 *
 * Formato 90AX / Lab V1:
 *   [STX 0x02][CMD 2 ASCII][SEP 0x1C][PAYLOAD UTF-8][CHK 2 hex][ETX 0x03]
 */

'use strict';

const checksum = require('./ToledoChecksum');
const { InvalidFrameError } = require('./ToledoProtocolErrors');

const STX = 0x02;
const ETX = 0x03;
const SEP = 0x1c;
const CMD_LEN = 2;
const MAX_PAYLOAD = 4096;

function encodePayload(payload) {
  if (payload == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(payload)) return payload;
  if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

/**
 * @param {string} command
 * @param {*} [payload]
 * @returns {Buffer}
 */
function build(command, payload) {
  const cmd = String(command || '').toUpperCase().slice(0, CMD_LEN);
  if (cmd.length !== CMD_LEN) {
    throw new InvalidFrameError(`Comando inválido: ${command}`);
  }
  const payloadBuf = encodePayload(payload);
  if (payloadBuf.length > MAX_PAYLOAD) {
    throw new InvalidFrameError('Payload excede limite');
  }
  const body = Buffer.concat([
    Buffer.from(cmd, 'ascii'),
    Buffer.from([SEP]),
    payloadBuf
  ]);
  const chk = checksum.toHex(body);
  return Buffer.concat([
    Buffer.from([STX]),
    body,
    Buffer.from(chk, 'ascii'),
    Buffer.from([ETX])
  ]);
}

/** Alias lab (FrameStudio) — mesmo framing oficial com CHK */
function buildFrame(comando, payload) {
  return build(comando, payload);
}

module.exports = {
  build,
  buildFrame,
  encodePayload,
  STX,
  ETX,
  SEP,
  CMD_LEN,
  MAX_PAYLOAD
};
