/**
 * RC15.10 — Exclusão mútua operação × heartbeat
 * session.busy impede disconnect/reconexão destrutiva do Heartbeat.
 */

'use strict';

const sessionRegistry = require('./EquipmentSessionRegistry');

const OP_BUSY = Object.freeze({
  UPLOAD: 'UPLOAD',
  DOWNLOAD: 'DOWNLOAD',
  CONFIG: 'CONFIG',
  DIAGNOSTICO: 'DIAGNOSTICO'
});

function _resolverSession(alvo = {}) {
  if (!alvo || (typeof alvo !== 'object')) return null;
  try {
    return sessionRegistry.get(alvo) || sessionRegistry.getOrCreate(alvo);
  } catch (_) {
    return null;
  }
}

/**
 * Marca sessão ocupada (refcount).
 * @returns {import('./EquipmentSession').EquipmentSession|null}
 */
function markBusy(alvo, reason = 'OP') {
  const session = _resolverSession(alvo);
  if (!session || typeof session.markBusy !== 'function') return session;
  session.markBusy(reason);
  try {
    // eslint-disable-next-line no-console
    console.log([
      '',
      '===== SESSION BUSY =====',
      `reason: ${reason}`,
      `host: ${session.host || '—'}`,
      `porta: ${session.porta != null ? session.porta : '—'}`,
      `busyDepth: ${session.busyDepth}`,
      '========================',
      ''
    ].join('\n'));
  } catch (_) { /* ignore */ }
  return session;
}

function clearBusy(alvo, reason = null) {
  const session = _resolverSession(alvo);
  if (!session || typeof session.clearBusy !== 'function') return session;
  session.clearBusy(reason);
  try {
    // eslint-disable-next-line no-console
    console.log([
      '',
      '===== SESSION IDLE =====',
      `reason: ${reason || session.busyReason || '—'}`,
      `busy: ${session.busy === true}`,
      `busyDepth: ${session.busyDepth}`,
      '========================',
      ''
    ].join('\n'));
  } catch (_) { /* ignore */ }
  return session;
}

async function withBusy(alvo, reason, fn) {
  markBusy(alvo, reason);
  try {
    return await fn();
  } finally {
    clearBusy(alvo, reason);
  }
}

/** Heartbeat deve ignorar o equipamento. */
function deveSuspenderHeartbeat(session) {
  return Boolean(session && session.busy === true);
}

/**
 * Heartbeat NÃO pode chamar disconnect quando:
 * - busy, ou
 * - connected + persistent
 */
function podeHeartbeatDisconnect(session) {
  if (!session) return true;
  if (session.busy === true) return false;
  if (session.connected === true && session.persistent === true) return false;
  return true;
}

function mapOperacaoParaBusy(nome) {
  const key = String(nome || '').toUpperCase();
  if (key === 'UPLOAD_PLU' || key === 'UPLOAD') return OP_BUSY.UPLOAD;
  if (key === 'DOWNLOAD_PLU' || key === 'DOWNLOAD') return OP_BUSY.DOWNLOAD;
  if (key === 'CONFIG_READ' || key === 'CONFIG_WRITE' || key === 'CONFIG') return OP_BUSY.CONFIG;
  if (key === 'DIAGNOSTICO' || key === 'DIAGNOSTIC') return OP_BUSY.DIAGNOSTICO;
  return null;
}

module.exports = {
  OP_BUSY,
  markBusy,
  clearBusy,
  withBusy,
  deveSuspenderHeartbeat,
  podeHeartbeatDisconnect,
  mapOperacaoParaBusy
};
