/**
 * Sprint 15.2 — ToledoFrameParser (Motor 90AX)
 * Interpreta respostas. Checksum via ToledoChecksum.
 */

'use strict';

const checksum = require('./ToledoChecksum');
const { STX, ETX, SEP, CMD_LEN } = require('./ToledoFrameBuilder');
const { InvalidFrameError } = require('./ToledoProtocolErrors');
const { CHECKSUM_LEN } = require('./ToledoChecksum');

function toBuffer(raw) {
  if (Buffer.isBuffer(raw)) return raw;
  if (typeof raw === 'string') return Buffer.from(raw, 'binary');
  if (raw == null) throw new InvalidFrameError('Frame vazio');
  return Buffer.from(raw);
}

/**
 * @param {Buffer|string} buffer
 * @returns {{command:string, payload:*, checksum:string, valid:boolean, raw:Buffer, isAck:boolean, isNak:boolean}}
 */
function parse(buffer) {
  const raw = toBuffer(buffer);
  if (!raw || raw.length < 6) {
    throw new InvalidFrameError('Frame muito curto');
  }
  if (raw[0] !== STX) throw new InvalidFrameError('STX ausente');
  if (raw[raw.length - 1] !== ETX) throw new InvalidFrameError('ETX ausente');

  const inner = raw.subarray(1, raw.length - 1);
  if (inner.length < CMD_LEN + 1 + CHECKSUM_LEN) {
    throw new InvalidFrameError('Estrutura incompleta');
  }

  const chkAscii = inner.subarray(inner.length - CHECKSUM_LEN).toString('ascii');
  const body = inner.subarray(0, inner.length - CHECKSUM_LEN);
  const expected = checksum.toHex(body);
  const valid = checksum.compare(chkAscii, expected);
  if (!valid) {
    checksum.assertValid(body, chkAscii);
  }

  if (body[CMD_LEN] !== SEP) throw new InvalidFrameError('SEP ausente');
  const command = body.subarray(0, CMD_LEN).toString('ascii').toUpperCase();
  const payloadBuf = body.subarray(CMD_LEN + 1);
  let payload = null;
  if (payloadBuf.length) {
    const texto = payloadBuf.toString('utf8');
    try {
      payload = JSON.parse(texto);
    } catch (_) {
      payload = texto;
    }
  }

  return {
    command,
    comando: command,
    payload,
    checksum: chkAscii.toUpperCase(),
    valid: true,
    raw,
    isAck: command === 'AK',
    isNak: command === 'NK'
  };
}

module.exports = {
  parse,
  toBuffer
};
