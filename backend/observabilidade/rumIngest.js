'use strict';

/**
 * RC12.2 — Ingestão RUM (frontend → Event Bus).
 * Whitelist de eventos + sanitização; sem regra de negócio.
 * @module observabilidade/rumIngest
 */

const eventBus = require('./eventBus');
const { sanitizePayload } = require('./eventSanitizer');
const {
  CATEGORIAS,
  EVENT_NAMES,
  RESULTADOS,
  SCHEMA_VERSION
} = require('./eventTypes');

const RUM_ALLOWED = new Set([
  EVENT_NAMES.AUTH_LOGIN_DURATION,
  EVENT_NAMES.MODULE_OPEN,
  EVENT_NAMES.MODULE_LAZY_CREATED,
  EVENT_NAMES.MODULE_LAZY_REUSED,
  EVENT_NAMES.MODULE_LAZY_ERROR
]);

const RUM_CATEGORIA = Object.freeze({
  [EVENT_NAMES.AUTH_LOGIN_DURATION]: CATEGORIAS.SECURITY,
  [EVENT_NAMES.MODULE_OPEN]: CATEGORIAS.UX,
  [EVENT_NAMES.MODULE_LAZY_CREATED]: CATEGORIAS.PERFORMANCE,
  [EVENT_NAMES.MODULE_LAZY_REUSED]: CATEGORIAS.PERFORMANCE,
  [EVENT_NAMES.MODULE_LAZY_ERROR]: CATEGORIAS.PERFORMANCE
});

/** Campos permitidos no payload RUM (fail-closed). */
const PAYLOAD_ALLOW = new Set([
  'page',
  'module',
  'scripts',
  'new_scripts',
  'first_open',
  'reuse',
  'ok',
  'error_code',
  'error_kind',
  'source',
  'phase',
  'loads',
  'total_ms'
]);

/**
 * @param {object} body
 * @param {{ usuario_id?: string|number|null, terminal_id?: string|null }} [ctx]
 * @returns {{ ok: boolean, accepted?: number, rejected?: number, errors?: string[] }}
 */
function ingestRumBatch(body, ctx = {}) {
  const items = Array.isArray(body)
    ? body
    : (body && Array.isArray(body.events) ? body.events : (body && body.event_name ? [body] : []));

  if (!items.length) {
    return { ok: false, accepted: 0, rejected: 0, errors: ['empty'] };
  }

  let accepted = 0;
  let rejected = 0;
  const errors = [];

  for (const raw of items.slice(0, 50)) {
    try {
      const eventName = String(raw && raw.event_name || '').trim();
      if (!RUM_ALLOWED.has(eventName)) {
        rejected += 1;
        errors.push(`event_not_allowed:${eventName || 'missing'}`);
        continue;
      }

      const duracao = Number(raw.duracao_ms != null ? raw.duracao_ms : raw.duration_ms);
      const resultadoRaw = String(raw.resultado || '').toLowerCase();
      const resultado = Object.values(RESULTADOS).includes(resultadoRaw)
        ? resultadoRaw
        : (raw.ok === false || eventName === EVENT_NAMES.MODULE_LAZY_ERROR
          ? RESULTADOS.ERRO
          : RESULTADOS.OK);

      const dirtyPayload = (raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload))
        ? raw.payload
        : {};
      const slim = {};
      for (const [k, v] of Object.entries(dirtyPayload)) {
        if (!PAYLOAD_ALLOW.has(k)) continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v == null) {
          slim[k] = v;
        }
      }
      slim.source = slim.source || 'frontend.rum';

      const { value: payload } = sanitizePayload(slim);

      eventBus.publish({
        event_name: eventName,
        categoria: RUM_CATEGORIA[eventName] || CATEGORIAS.UX,
        origem: String(raw.origem || 'frontend.rum').slice(0, 120),
        duracao_ms: Number.isFinite(duracao) ? duracao : undefined,
        resultado,
        correlation_id: raw.correlation_id ? String(raw.correlation_id).slice(0, 64) : undefined,
        usuario_id: ctx.usuario_id != null ? ctx.usuario_id : undefined,
        terminal_id: ctx.terminal_id != null ? String(ctx.terminal_id).slice(0, 64) : undefined,
        payload: {
          ...payload,
          rum: true,
          schema: SCHEMA_VERSION
        }
      });
      accepted += 1;
    } catch (err) {
      rejected += 1;
      errors.push(err && err.message ? err.message : 'ingest_error');
    }
  }

  return {
    ok: accepted > 0,
    accepted,
    rejected,
    errors: errors.slice(0, 10)
  };
}

module.exports = {
  ingestRumBatch,
  RUM_ALLOWED,
  PAYLOAD_ALLOW
};
