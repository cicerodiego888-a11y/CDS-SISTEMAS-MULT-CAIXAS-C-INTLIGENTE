/**
 * RC14.14.2 — ToledoFrameBuilder (fachada de produção)
 * Delega ao Builder oficial em protocol/. Sem framing paralelo.
 */

'use strict';

const official = require('./protocol/ToledoFrameBuilder');
const checksumMod = require('./protocol/ToledoChecksum');
const { COMMANDS } = require('./ToledoProtocol');
const { ToledoError, CODES } = require('./ToledoErrors');

function build(comando, payload) {
  try {
    return official.build(comando, payload);
  } catch (err) {
    throw ToledoError.fromCode(CODES.INVALID_FRAME, err.message || 'Frame inválido');
  }
}

function checksum(bodyBytes) {
  return checksumMod.toHex(bodyBytes);
}

function encode(payload) {
  return official.encodePayload(payload);
}

function xorChecksum(buffer) {
  return checksumMod.calculate(buffer);
}

function buildHandshake(extra = {}) {
  return build(COMMANDS.HANDSHAKE, {
    driver: 'TOLEDO_PRIX4_UNO',
    versao: '14.14.3',
    firmware_alvo: '90AX',
    ...extra
  });
}

function buildPing(extra = {}) {
  return build(COMMANDS.PING, { ts: Date.now(), ...extra });
}

function buildAck(payload = null) {
  return build(require('./ToledoProtocol').RESPONSES.ACK, payload);
}

module.exports = {
  build,
  checksum,
  encode,
  buildHandshake,
  buildPing,
  buildAck,
  xorChecksum,
  // constantes oficiais
  STX: official.STX,
  ETX: official.ETX,
  SEP: official.SEP,
  CMD_LEN: official.CMD_LEN,
  MAX_PAYLOAD: official.MAX_PAYLOAD,
  /** @deprecated use protocol/ToledoFrameBuilder diretamente */
  OFFICIAL: official
};
