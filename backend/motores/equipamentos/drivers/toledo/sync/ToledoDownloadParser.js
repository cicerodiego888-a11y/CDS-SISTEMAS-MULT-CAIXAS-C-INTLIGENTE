/**
 * Sprint 14.8 — ToledoDownloadParser
 * Converte resposta do framing V1 em objetos de domínio PLU.
 */

'use strict';

const frameParser = require('../ToledoFrameParser');
const { RESPONSES } = require('../ToledoProtocol');
const { SyncError, CODES } = require('./ToledoSyncErrors');
const { normalizar } = require('./ToledoSyncComparator');

function extrairLista(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.plus)) return payload.plus;
  if (Array.isArray(payload.plu)) return payload.plu;
  if (Array.isArray(payload.items)) return payload.items;
  if (payload.plu != null) return [payload];
  return [];
}

/**
 * @param {Buffer|string} raw
 * @returns {{plus:Array, payload:*, raw:Buffer}}
 */
function parseResponse(raw) {
  if (!raw || !raw.length) {
    throw SyncError.fromCode(CODES.DOWNLOAD_FAILED, 'Sem resposta da balança', { statusCode: 408 });
  }

  let parsed;
  try {
    parsed = frameParser.parse(raw);
  } catch (err) {
    throw SyncError.fromCode(CODES.DOWNLOAD_FAILED, err.message || 'Frame inválido', {
      statusCode: 502,
      cause: err.code
    });
  }

  if (parsed.comando === RESPONSES.NAK || parsed.isNak) {
    throw SyncError.fromCode(CODES.DOWNLOAD_FAILED, 'NACK no download de PLUs', {
      statusCode: 502,
      payload: parsed.payload
    });
  }

  const okCmd = parsed.comando === RESPONSES.ACK
    || parsed.comando === RESPONSES.PLU_DATA
    || parsed.isAck;
  if (!okCmd) {
    throw SyncError.fromCode(
      CODES.DOWNLOAD_FAILED,
      `Resposta inesperada no download: ${parsed.comando}`,
      { statusCode: 502 }
    );
  }

  const plus = extrairLista(parsed.payload)
    .map((p) => normalizar(p))
    .filter((p) => p.plu);

  return {
    plus,
    payload: parsed.payload,
    raw: parsed.raw
  };
}

module.exports = {
  parseResponse,
  extrairLista
};
