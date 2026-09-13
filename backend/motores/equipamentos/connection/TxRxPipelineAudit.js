/**
 * RC14.14.10 — Auditoria do Pipeline TX/RX
 * Logs estruturados para localizar onde a resposta da balança deixa de existir.
 */

'use strict';

function agoraIso() {
  return new Date().toISOString();
}

function toBuf(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data == null) return Buffer.alloc(0);
  return Buffer.from(data);
}

function hexOf(buf) {
  const b = toBuf(buf);
  if (!b.length) return '';
  return b.toString('hex').toUpperCase().match(/.{1,2}/g).join(' ');
}

function asciiOf(buf) {
  const b = toBuf(buf);
  return [...b]
    .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'))
    .join('');
}

function getLogger() {
  try {
    return require('../services/LoggerService');
  } catch (_) {
    return {
      info: async (msg, ctx) => console.log('[txrx-audit]', msg, ctx?.contexto || ctx || ''),
      warn: async (msg, ctx) => console.warn('[txrx-audit]', msg, ctx?.contexto || ctx || ''),
      error: async (msg, ctx) => console.error('[txrx-audit]', msg, ctx?.contexto || ctx || '')
    };
  }
}

/**
 * Emite log de auditoria TX/RX (não lança).
 * @param {string} evento
 * @param {Object} campos
 */
function audit(evento, campos = {}) {
  const logger = getLogger();
  const nivel = /timeout|error|falha/i.test(evento) ? 'warn' : 'info';
  const payload = {
    timestamp: agoraIso(),
    evento,
    ...campos
  };
  // Console direto — facilita leitura no terminal do ERP
  try {
    const linhas = [`[TXRX] ${evento}`];
    for (const [k, v] of Object.entries(payload)) {
      if (k === 'evento' || k === 'timestamp') continue;
      if (v === undefined) continue;
      linhas.push(`  ${k}=${v === null ? 'null' : v}`);
    }
    console.log(linhas.join('\n'));
  } catch (_) { /* ignore */ }

  logger[nivel](evento, {
    operacao: 'txrx_pipeline_audit',
    contexto: payload
  }).catch(() => {});

  return payload;
}

function formatTx(buf, meta = {}) {
  const b = toBuf(buf);
  return {
    host: meta.host || null,
    porta: meta.porta != null ? Number(meta.porta) : null,
    bytes: b.length,
    txHex: hexOf(b),
    txAscii: asciiOf(b)
  };
}

function formatRx(buf, meta = {}) {
  const b = toBuf(buf);
  return {
    host: meta.host || null,
    porta: meta.porta != null ? Number(meta.porta) : null,
    bytes: b.length,
    rxHex: hexOf(b),
    rxAscii: asciiOf(b),
    tempoDesdeTxMs: meta.tempoDesdeTxMs != null ? Number(meta.tempoDesdeTxMs) : null
  };
}

module.exports = {
  audit,
  formatTx,
  formatRx,
  hexOf,
  asciiOf,
  toBuf,
  agoraIso
};
