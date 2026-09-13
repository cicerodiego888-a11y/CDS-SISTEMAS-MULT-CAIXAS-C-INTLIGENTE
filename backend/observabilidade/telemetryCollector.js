'use strict';

/**
 * RC12.2 — Coletor em memória: assina o Event Bus e alimenta agregadores.
 * Sem persistência definitiva.
 * @module observabilidade/telemetryCollector
 */

const eventBus = require('./eventBus');
const { EVENT_NAMES } = require('./eventTypes');
const { createMetricsStore } = require('./metricsAggregator');

const BOOT_EVENTS = new Set([
  EVENT_NAMES.BOOT_STARTED,
  EVENT_NAMES.BOOT_DATABASE_READY,
  EVENT_NAMES.BOOT_DATABASE_ERROR,
  EVENT_NAMES.BOOT_HTTP_LISTENING,
  EVENT_NAMES.BOOT_BACKGROUND_START,
  EVENT_NAMES.BOOT_BACKGROUND_STEP,
  EVENT_NAMES.BOOT_BACKGROUND_READY,
  EVENT_NAMES.BOOT_BACKGROUND_ERROR,
  EVENT_NAMES.BOOT_MIP_FLAG_READY
]);

const BACKGROUND_EVENTS = new Set([
  EVENT_NAMES.BOOT_BACKGROUND_START,
  EVENT_NAMES.BOOT_BACKGROUND_STEP,
  EVENT_NAMES.BOOT_BACKGROUND_READY,
  EVENT_NAMES.BOOT_BACKGROUND_ERROR
]);

const LAZY_BACKEND = new Set([
  EVENT_NAMES.LAZY_SERVICE_INIT,
  EVENT_NAMES.LAZY_SERVICE_CREATED,
  EVENT_NAMES.LAZY_SERVICE_REUSED,
  EVENT_NAMES.LAZY_SERVICE_ERROR
]);

const LAZY_FRONTEND = new Set([
  EVENT_NAMES.MODULE_OPEN,
  EVENT_NAMES.MODULE_LAZY_CREATED,
  EVENT_NAMES.MODULE_LAZY_REUSED,
  EVENT_NAMES.MODULE_LAZY_ERROR
]);

const MIIP_EVENTS = new Set([
  EVENT_NAMES.MIIP_IDENTIFY_STARTED,
  EVENT_NAMES.MIIP_IDENTIFY_FINISHED,
  EVENT_NAMES.MIIP_HEALTH_DEGRADED
]);

const CENTRAL_EVENTS = new Set([
  EVENT_NAMES.CENTRAL_EVENT,
  EVENT_NAMES.CENTRAL_SYNC_INICIADA,
  EVENT_NAMES.CENTRAL_SYNC_CONCLUIDA,
  EVENT_NAMES.CENTRAL_SYNC_ERRO,
  EVENT_NAMES.CENTRAL_PARSER_CONCLUIDO,
  EVENT_NAMES.CENTRAL_MIIP_CONCLUIDO,
  EVENT_NAMES.CENTRAL_DOCUMENTO_RECEBIDO,
  EVENT_NAMES.CENTRAL_ERRO
]);

const NFE_EVENTS = new Set([
  EVENT_NAMES.SOAP_INICIADO,
  EVENT_NAMES.SOAP_FINALIZADO,
  EVENT_NAMES.SOAP_FALHA,
  EVENT_NAMES.SOAP_TIMEOUT,
  EVENT_NAMES.SOAP_HTTP_ERROR,
  EVENT_NAMES.SOAP_CSTAT
]);

let started = false;
let unsub = null;
const store = createMetricsStore({ maxSamples: 800 });
let lastResource = null;
/** @type {Record<string, number|null>} */
const lastDurationByDomain = {};
/** @type {Record<string, number|null>} */
const lastDurationByEvent = {};

function domainFor(eventName) {
  // Background antes de Boot (subset dos eventos BOOT_*).
  if (BACKGROUND_EVENTS.has(eventName)) return 'background';
  if (BOOT_EVENTS.has(eventName)) return 'boot';
  if (eventName === EVENT_NAMES.AUTH_LOGIN_DURATION) return 'login';
  if (LAZY_BACKEND.has(eventName) || LAZY_FRONTEND.has(eventName)) return 'lazy';
  if (MIIP_EVENTS.has(eventName)) return 'miip';
  if (CENTRAL_EVENTS.has(eventName)) return 'central';
  if (NFE_EVENTS.has(eventName)) return 'nfe';
  if (eventName === EVENT_NAMES.RESOURCE_SAMPLE) return 'recursos';
  return null;
}

function onEvent(envelope) {
  try {
    if (!envelope || !envelope.event_name) return;
    const name = envelope.event_name;
    const domain = domainFor(name);
    if (!domain) return;

    store.increment(`domain:${domain}`);
    store.increment(`event:${name}`);

    const dur = Number(envelope.duracao_ms);
    if (Number.isFinite(dur)) {
      store.push(`duration:${name}`, dur);
      store.push(`domain_duration:${domain}`, dur);
      lastDurationByDomain[domain] = dur;
      lastDurationByEvent[name] = dur;
    }

    if (name === EVENT_NAMES.RESOURCE_SAMPLE && envelope.payload) {
      const p = envelope.payload;
      lastResource = {
        ts: envelope.timestamp || new Date().toISOString(),
        heap_rss_mb: p.heap_rss_mb,
        heap_used_mb: p.heap_used_mb,
        cpu_percent: p.cpu_percent,
        event_loop_delay_ms: p.event_loop_delay_ms,
        uptime_s: p.uptime_s,
        sample_n: p.sample_n
      };
      if (Number.isFinite(Number(p.heap_rss_mb))) store.push('resource:heap_rss_mb', p.heap_rss_mb);
      if (Number.isFinite(Number(p.heap_used_mb))) store.push('resource:heap_used_mb', p.heap_used_mb);
      if (Number.isFinite(Number(p.cpu_percent))) store.push('resource:cpu_percent', p.cpu_percent);
      if (Number.isFinite(Number(p.event_loop_delay_ms))) {
        store.push('resource:event_loop_delay_ms', p.event_loop_delay_ms);
      }
      if (Number.isFinite(Number(p.uptime_s))) store.push('resource:uptime_s', p.uptime_s);
    }

    if (name === EVENT_NAMES.MODULE_LAZY_CREATED || name === EVENT_NAMES.LAZY_SERVICE_CREATED) {
      store.increment('lazy:created');
      if (Number.isFinite(dur)) store.push('lazy:first_open_ms', dur);
    }
    if (name === EVENT_NAMES.MODULE_LAZY_REUSED || name === EVENT_NAMES.LAZY_SERVICE_REUSED) {
      store.increment('lazy:reused');
      if (Number.isFinite(dur)) store.push('lazy:reuse_ms', dur);
    }
    if (name === EVENT_NAMES.MODULE_LAZY_ERROR || name === EVENT_NAMES.LAZY_SERVICE_ERROR) {
      store.increment('lazy:error');
    }
  } catch (_) {
    /* never throw into bus */
  }
}

function start() {
  if (started) return { ok: true, reason: 'already' };
  unsub = eventBus.subscribe('*', onEvent);
  started = true;
  return { ok: true };
}

function stop() {
  if (unsub) {
    try { unsub(); } catch (_) { /* ignore */ }
    unsub = null;
  }
  started = false;
}

function domainSummary(domain, eventNames) {
  const durationStats = store.stats(`domain_duration:${domain}`);
  const events = {};
  for (const name of eventNames) {
    const c = store.count(`event:${name}`);
    if (!c) continue;
    events[name] = {
      events: c,
      last: lastDurationByEvent[name] != null ? lastDurationByEvent[name] : null,
      ...store.stats(`duration:${name}`)
    };
  }
  return {
    events_total: store.count(`domain:${domain}`),
    duration_ms: {
      ...durationStats,
      last: lastDurationByDomain[domain] != null ? lastDurationByDomain[domain] : null
    },
    by_event: events
  };
}

function getSummary() {
  const loginDuration = {
    ...store.stats(`duration:${EVENT_NAMES.AUTH_LOGIN_DURATION}`),
    last: lastDurationByEvent[EVENT_NAMES.AUTH_LOGIN_DURATION] != null
      ? lastDurationByEvent[EVENT_NAMES.AUTH_LOGIN_DURATION]
      : null
  };
  const firstOpen = {
    ...store.stats('lazy:first_open_ms'),
    last: lastDurationByEvent[EVENT_NAMES.MODULE_LAZY_CREATED] != null
      ? lastDurationByEvent[EVENT_NAMES.MODULE_LAZY_CREATED]
      : (lastDurationByEvent[EVENT_NAMES.LAZY_SERVICE_CREATED] != null
        ? lastDurationByEvent[EVENT_NAMES.LAZY_SERVICE_CREATED]
        : null)
  };
  const reuse = {
    ...store.stats('lazy:reuse_ms'),
    last: lastDurationByEvent[EVENT_NAMES.MODULE_LAZY_REUSED] != null
      ? lastDurationByEvent[EVENT_NAMES.MODULE_LAZY_REUSED]
      : null
  };

  return {
    versao_schema: 'obs.v1',
    gerado_em: new Date().toISOString(),
    boot: domainSummary('boot', [...BOOT_EVENTS]),
    login: {
      ...domainSummary('login', [EVENT_NAMES.AUTH_LOGIN_DURATION]),
      duration_ms: loginDuration
    },
    lazy: {
      ...domainSummary('lazy', [...LAZY_BACKEND, ...LAZY_FRONTEND]),
      first_open_ms: firstOpen,
      reuse_ms: reuse,
      created: store.count('lazy:created'),
      reused: store.count('lazy:reused'),
      errors: store.count('lazy:error')
    },
    miip: domainSummary('miip', [...MIIP_EVENTS]),
    central: domainSummary('central', [...CENTRAL_EVENTS]),
    nfe: domainSummary('nfe', [...NFE_EVENTS]),
    background: domainSummary('background', [...BACKGROUND_EVENTS]),
    recursos: {
      ultimo: lastResource,
      heap_rss_mb: {
        ...store.stats('resource:heap_rss_mb'),
        last: lastResource && lastResource.heap_rss_mb != null ? lastResource.heap_rss_mb : null
      },
      heap_used_mb: {
        ...store.stats('resource:heap_used_mb'),
        last: lastResource && lastResource.heap_used_mb != null ? lastResource.heap_used_mb : null
      },
      cpu_percent: {
        ...store.stats('resource:cpu_percent'),
        last: lastResource && lastResource.cpu_percent != null ? lastResource.cpu_percent : null
      },
      event_loop_delay_ms: {
        ...store.stats('resource:event_loop_delay_ms'),
        last: lastResource && lastResource.event_loop_delay_ms != null
          ? lastResource.event_loop_delay_ms
          : null
      },
      uptime_s: {
        ...store.stats('resource:uptime_s'),
        last: lastResource && lastResource.uptime_s != null ? lastResource.uptime_s : null
      },
      samples: store.count(`event:${EVENT_NAMES.RESOURCE_SAMPLE}`)
    },
    bus: eventBus.getStats ? eventBus.getStats() : null
  };
}

function _resetForTests() {
  stop();
  store.clear();
  lastResource = null;
  Object.keys(lastDurationByDomain).forEach((k) => { delete lastDurationByDomain[k]; });
  Object.keys(lastDurationByEvent).forEach((k) => { delete lastDurationByEvent[k]; });
  started = false;
}

module.exports = {
  start,
  stop,
  getSummary,
  onEvent,
  _resetForTests,
  _store: store
};
