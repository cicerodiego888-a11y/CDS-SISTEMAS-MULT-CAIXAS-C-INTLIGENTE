/**
 * Sprint 14.11 — ToledoConfigurationParser
 * Interpreta apenas respostas de configuração (Lab V1 framing).
 */

'use strict';

const frameParser = require('../ToledoFrameParser');
const { RESPONSES, COMMANDS } = require('../ToledoProtocol');
const { ConfigurationError, CODES } = require('./ToledoConfigurationErrors');
const mapper = require('./ToledoConfigurationMapper');

const PROTOCOL_PROFILE = Object.freeze({
  source: 'lab-v1-framing',
  readCommand: COMMANDS.CONFIG_READ,
  writeCommand: COMMANDS.CONFIG_WRITE,
  version: '14.11-infra'
});

function parse(raw) {
  if (!raw || !raw.length) {
    throw ConfigurationError.fromCode(CODES.FRAME_INVALID, 'Frame de configuração vazio', {
      statusCode: 408
    });
  }

  let parsed;
  try {
    parsed = frameParser.parse(raw);
  } catch (err) {
    throw ConfigurationError.fromCode(CODES.FRAME_INVALID, err.message || 'Frame inválido', {
      statusCode: 502,
      cause: err.code
    });
  }

  if (parsed.comando === RESPONSES.NAK || parsed.isNak) {
    throw ConfigurationError.fromCode(CODES.NACK, 'NACK na configuração', {
      statusCode: 502,
      payload: parsed.payload
    });
  }

  const ok = parsed.comando === RESPONSES.ACK
    || parsed.comando === RESPONSES.CONFIG
    || parsed.comando === COMMANDS.CONFIG_READ
    || parsed.isAck;

  if (!ok) {
    throw ConfigurationError.fromCode(
      CODES.FRAME_INVALID,
      `Resposta inesperada de configuração: ${parsed.comando}`,
      { statusCode: 502 }
    );
  }

  const payload = parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : {};
  const parametros = payload.parametros || payload.config || payload;
  const cds = mapper.toCds({
    nome: payload.nome,
    modelo: payload.modelo,
    firmware: payload.firmware,
    parametros
  });

  return {
    ...cds,
    ack: parsed.isAck || parsed.comando === RESPONSES.ACK,
    raw: parsed.raw,
    comando: parsed.comando,
    _proto: PROTOCOL_PROFILE.version
  };
}

function getProtocolProfile() {
  return { ...PROTOCOL_PROFILE };
}

module.exports = {
  parse,
  getProtocolProfile,
  PROTOCOL_PROFILE
};
