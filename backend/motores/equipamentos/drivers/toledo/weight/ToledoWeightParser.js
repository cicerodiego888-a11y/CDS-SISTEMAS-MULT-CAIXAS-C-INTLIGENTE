/**
 * Sprint 14.9 — ToledoWeightParser
 * Converte frame Lab V1 (PW / ACK) em objeto de domínio.
 * Sem lógica de interface.
 */

'use strict';

const frameParser = require('../ToledoFrameParser');
const { RESPONSES, COMMANDS } = require('../ToledoProtocol');
const { WeightError, CODES } = require('./ToledoWeightErrors');

const PROTOCOL_PROFILE = Object.freeze({
  source: 'lab-v1-framing',
  command: COMMANDS.READ_WEIGHT,
  version: '14.9-infra'
});

/**
 * @param {Buffer|string} raw
 * @returns {{peso:number, unidade:string, estabilidade:boolean, bruto?:*, raw:Buffer, comando:string}}
 */
function parse(raw) {
  if (!raw || !raw.length) {
    throw WeightError.fromCode(CODES.FRAME_INVALID, 'Frame de peso vazio', { statusCode: 408 });
  }

  let parsed;
  try {
    parsed = frameParser.parse(raw);
  } catch (err) {
    if (err.code === 'CHECKSUM_ERROR' || String(err.message || '').includes('Checksum')) {
      throw WeightError.fromCode(CODES.CHECKSUM_ERROR, err.message || 'Checksum inválido', {
        statusCode: 502,
        cause: err.code
      });
    }
    throw WeightError.fromCode(CODES.FRAME_INVALID, err.message || 'Frame inválido', {
      statusCode: 502,
      cause: err.code
    });
  }

  if (parsed.comando === RESPONSES.NAK || parsed.isNak) {
    throw WeightError.fromCode(CODES.NACK, 'NACK na leitura de peso', {
      statusCode: 502,
      payload: parsed.payload
    });
  }

  const cmdOk = parsed.comando === RESPONSES.ACK
    || parsed.comando === RESPONSES.WEIGHT
    || parsed.comando === COMMANDS.READ_WEIGHT
    || parsed.isAck;

  if (!cmdOk) {
    throw WeightError.fromCode(
      CODES.FRAME_INVALID,
      `Resposta inesperada de peso: ${parsed.comando}`,
      { statusCode: 502 }
    );
  }

  const p = parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : {};
  const pesoRaw = p.peso != null ? p.peso : (p.valor != null ? p.valor : p.weight);
  const unidade = String(p.unidade || p.unit || 'kg').toLowerCase();
  const estabilidade = p.estabilidade != null
    ? Boolean(p.estabilidade)
    : (p.estavel != null ? Boolean(p.estavel) : Boolean(p.stable));

  return {
    peso: pesoRaw != null ? Number(pesoRaw) : NaN,
    unidade,
    estabilidade,
    bruto: parsed.payload,
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
