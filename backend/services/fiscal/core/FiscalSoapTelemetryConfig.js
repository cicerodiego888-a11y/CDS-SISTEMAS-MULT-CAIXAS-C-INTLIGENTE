/**
 * Leitura best-effort de flags de telemetria (RC6.6).
 * Não altera configuração nem regras — só lê.
 *
 * @module services/fiscal/core/FiscalSoapTelemetryConfig
 */

let _cache = { at: 0, logDetalhado: false, modoDebug: false };
const TTL_MS = 5000;
let _warmStarted = false;

function _parseBool(v) {
  return String(v || '').trim().toLowerCase() === 'true' || v === true || v === 1 || v === '1';
}

/**
 * Aquecimento assíncrono de log_detalhado a partir do KV da Central.
 */
function warmFiscalTelemetryFlagsFromDb() {
  if (_warmStarted) return;
  _warmStarted = true;
  try {
    // eslint-disable-next-line global-require
    const db = require('../../../database');
    db.get(
      `SELECT valor FROM central_entradas_config WHERE chave = ? LIMIT 1`,
      ['log_detalhado'],
      (err, row) => {
        if (!err && row) {
          _cache.logDetalhado = _parseBool(row.valor);
          _cache.at = Date.now();
        }
      }
    );
    db.get(
      `SELECT valor FROM central_entradas_config WHERE chave = ? LIMIT 1`,
      ['modo_debug'],
      (err, row) => {
        if (!err && row) {
          _cache.modoDebug = _parseBool(row.valor);
          _cache.at = Date.now();
        }
      }
    );
  } catch {
    // ignore — DB pode não estar pronto
  }
}

/**
 * @returns {{ logDetalhado: boolean, modoDebug: boolean }}
 */
function getFiscalConfigSyncFlags() {
  warmFiscalTelemetryFlagsFromDb();
  const agora = Date.now();

  const logDetalhado = process.env.CDS_FISCAL_AUDIT_SOAP === '1'
    || global.__CDS_FISCAL_LOG_DETALHADO__ === true
    || _cache.logDetalhado;
  const modoDebug = process.env.CDS_FISCAL_DEBUG === '1'
    || global.__CDS_FISCAL_MODO_DEBUG__ === true
    || _cache.modoDebug;

  if (agora - _cache.at >= TTL_MS) {
    _cache.at = agora;
  }

  return { logDetalhado, modoDebug };
}

/**
 * @param {{ logDetalhado?: boolean, modoDebug?: boolean }} flags
 */
function setFiscalTelemetryFlagsForTests(flags = {}) {
  if (flags.logDetalhado != null) global.__CDS_FISCAL_LOG_DETALHADO__ = Boolean(flags.logDetalhado);
  if (flags.modoDebug != null) global.__CDS_FISCAL_MODO_DEBUG__ = Boolean(flags.modoDebug);
  _cache.at = 0;
}

module.exports = {
  getFiscalConfigSyncFlags,
  setFiscalTelemetryFlagsForTests,
  warmFiscalTelemetryFlagsFromDb
};
