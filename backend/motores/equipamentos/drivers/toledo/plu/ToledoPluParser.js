/**
 * Sprint 14.7 — ToledoPluParser
 * Interpreta apenas ACK / NACK / Erro de upload.
 */

'use strict';

const frameParser = require('../ToledoFrameParser');
const { RESPONSES } = require('../ToledoProtocol');
const { PluError, CODES } = require('./ToledoPluErrors');

/**
 * @param {Buffer|string} raw
 * @returns {{ok:boolean, ack:boolean, nack:boolean, payload:*, raw:Buffer, error?:string}}
 */
function parse(raw) {
  if (!raw || !raw.length) {
    throw PluError.fromCode(CODES.ACK_AUSENTE, 'Sem resposta da balança', { statusCode: 408 });
  }

  let parsed;
  try {
    parsed = frameParser.parse(raw);
  } catch (err) {
    throw PluError.fromCode(CODES.UPLOAD_ERROR, err.message || 'Frame inválido', {
      statusCode: 502,
      cause: err.code
    });
  }

  if (parsed.comando === RESPONSES.ACK || parsed.isAck) {
    return {
      ok: true,
      ack: true,
      nack: false,
      payload: parsed.payload,
      raw: parsed.raw
    };
  }

  if (parsed.comando === RESPONSES.NAK || parsed.isNak) {
    return {
      ok: false,
      ack: false,
      nack: true,
      payload: parsed.payload,
      raw: parsed.raw,
      error: CODES.NACK
    };
  }

  return {
    ok: false,
    ack: false,
    nack: false,
    payload: parsed.payload,
    raw: parsed.raw,
    error: `Resposta inesperada: ${parsed.comando}`
  };
}

function assertAck(raw) {
  const r = parse(raw);
  if (!r.ack) {
    throw PluError.fromCode(
      r.nack ? CODES.NACK : CODES.ACK_AUSENTE,
      r.error || 'Upload sem ACK',
      { statusCode: 502, payload: r.payload }
    );
  }
  return r;
}

module.exports = {
  parse,
  assertAck
};
