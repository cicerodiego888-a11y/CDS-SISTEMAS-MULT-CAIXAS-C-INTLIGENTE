/**
 * RC14.14.2 — ToledoFrameParser (fachada de produção)
 * Delega ao Parser oficial em protocol/. Sem parser paralelo.
 */

'use strict';

const official = require('./protocol/ToledoFrameParser');
const { RESPONSES } = require('./ToledoProtocol');
const { ToledoError, CODES } = require('./ToledoErrors');

function decode(raw) {
  try {
    return official.toBuffer(raw);
  } catch (err) {
    throw ToledoError.fromCode(CODES.INVALID_FRAME, err.message || 'Frame vazio ou inválido');
  }
}

/**
 * @param {Buffer|string} raw
 * @returns {{comando:string, command:string, payload:*, checksum:string, raw:Buffer, isAck:boolean, isNak:boolean, valid:boolean}}
 */
function parse(raw) {
  try {
    const parsed = official.parse(raw);
    return {
      comando: parsed.command || parsed.comando,
      command: parsed.command || parsed.comando,
      payload: parsed.payload,
      checksum: parsed.checksum,
      raw: parsed.raw,
      isAck: parsed.isAck || parsed.comando === RESPONSES.ACK || parsed.command === RESPONSES.ACK,
      isNak: parsed.isNak || parsed.comando === RESPONSES.NAK || parsed.command === RESPONSES.NAK,
      valid: parsed.valid !== false
    };
  } catch (err) {
    if (err.code === 'INVALID_CHECKSUM' || /checksum/i.test(err.message || '')) {
      throw ToledoError.fromCode(CODES.CHECKSUM_ERROR, err.message || 'Checksum inválido');
    }
    throw ToledoError.fromCode(CODES.INVALID_FRAME, err.message || 'Frame inválido');
  }
}

function validate(buf) {
  try {
    parse(buf);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      code: err.code || CODES.INVALID_FRAME
    };
  }
}

module.exports = {
  parse,
  validate,
  decode,
  /** @deprecated use protocol/ToledoFrameParser diretamente */
  OFFICIAL: official
};
