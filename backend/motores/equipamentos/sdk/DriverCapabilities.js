/**
 * Sprint 15.7 — Capacidades padronizadas do Device Profile SDK.
 */

'use strict';

const CAPABILITIES = Object.freeze({
  DISCOVERY: 'discovery',
  CONNECTION: 'connection',
  IDENTIFICATION: 'identification',
  SYNCHRONIZATION: 'synchronization',
  SCHEDULER: 'scheduler',
  TELEMETRY: 'telemetry',
  DIAGNOSTICS: 'diagnostics',
  ROLLBACK: 'rollback',
  UPDATE: 'update',
  BACKUP: 'backup',
  // aliases amigáveis no manifesto
  IDENTIFY: 'identify',
  SYNC: 'sync'
});

const CAPABILITY_ALIASES = Object.freeze({
  identify: CAPABILITIES.IDENTIFICATION,
  identification: CAPABILITIES.IDENTIFICATION,
  sync: CAPABILITIES.SYNCHRONIZATION,
  synchronization: CAPABILITIES.SYNCHRONIZATION,
  discovery: CAPABILITIES.DISCOVERY,
  connection: CAPABILITIES.CONNECTION,
  scheduler: CAPABILITIES.SCHEDULER,
  telemetry: CAPABILITIES.TELEMETRY,
  diagnostics: CAPABILITIES.DIAGNOSTICS,
  diagnostico: CAPABILITIES.DIAGNOSTICS,
  rollback: CAPABILITIES.ROLLBACK,
  update: CAPABILITIES.UPDATE,
  backup: CAPABILITIES.BACKUP
});

const ALL_CANONICAL = Object.freeze([
  CAPABILITIES.DISCOVERY,
  CAPABILITIES.CONNECTION,
  CAPABILITIES.IDENTIFICATION,
  CAPABILITIES.SYNCHRONIZATION,
  CAPABILITIES.SCHEDULER,
  CAPABILITIES.TELEMETRY,
  CAPABILITIES.DIAGNOSTICS,
  CAPABILITIES.ROLLBACK,
  CAPABILITIES.UPDATE,
  CAPABILITIES.BACKUP
]);

/**
 * Normaliza mapa de capabilities do manifesto.
 * Aceita objeto { identify: true } ou array ['sync','rollback'].
 * @param {Object|string[]|null} raw
 * @returns {{ mapa: Object<string, boolean>, lista: string[], aliases: Object }}
 */
function normalizarCapabilities(raw) {
  const mapa = {};
  ALL_CANONICAL.forEach((c) => { mapa[c] = false; });

  const aliases = {};

  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      const key = String(item || '').toLowerCase();
      const canon = CAPABILITY_ALIASES[key] || key;
      if (ALL_CANONICAL.includes(canon)) {
        mapa[canon] = true;
        aliases[key] = canon;
      }
    });
  } else if (raw && typeof raw === 'object') {
    Object.keys(raw).forEach((key) => {
      const k = String(key).toLowerCase();
      const canon = CAPABILITY_ALIASES[k] || k;
      const on = raw[key] === true || raw[key] === 1 || raw[key] === 'true';
      if (ALL_CANONICAL.includes(canon)) {
        mapa[canon] = on;
        aliases[k] = canon;
      }
    });
  }

  const lista = ALL_CANONICAL.filter((c) => mapa[c]);
  return { mapa, lista, aliases };
}

function temCapability(capabilities, nome) {
  const { mapa } = normalizarCapabilities(capabilities);
  const key = String(nome || '').toLowerCase();
  const canon = CAPABILITY_ALIASES[key] || key;
  return Boolean(mapa[canon]);
}

module.exports = {
  CAPABILITIES,
  CAPABILITY_ALIASES,
  ALL_CANONICAL,
  normalizarCapabilities,
  temCapability
};
