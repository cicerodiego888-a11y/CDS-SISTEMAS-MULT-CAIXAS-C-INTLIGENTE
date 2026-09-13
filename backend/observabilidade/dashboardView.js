'use strict';

/**
 * RC12.3 — Visão read-only do dashboard (status + recentes + KPIs).
 * Somente métricas; nenhuma regra comercial.
 * @module observabilidade/dashboardView
 */

const eventBus = require('./eventBus');
const { EVENT_NAMES } = require('./eventTypes');

const STATUS = Object.freeze({
  SAUDAVEL: 'saudavel',
  ATENCAO: 'atencao',
  CRITICO: 'critico'
});

/** Limiares puramente técnicos (ms / % / MB). */
const THRESHOLDS = Object.freeze({
  boot_p95_ms: { ok: 3000, warn: 8000 },
  login_p95_ms: { ok: 1500, warn: 4000 },
  lazy_first_p95_ms: { ok: 2000, warn: 5000 },
  miip_p95_ms: { ok: 2000, warn: 6000 },
  nfe_p95_ms: { ok: 5000, warn: 15000 },
  central_p95_ms: { ok: 5000, warn: 15000 },
  event_loop_ms: { ok: 50, warn: 200 },
  cpu_percent: { ok: 50, warn: 80 },
  heap_rss_mb: { ok: 512, warn: 1024 }
});

function worst(a, b) {
  const rank = { [STATUS.SAUDAVEL]: 0, [STATUS.ATENCAO]: 1, [STATUS.CRITICO]: 2 };
  return (rank[a] || 0) >= (rank[b] || 0) ? a : b;
}

function levelFromValue(value, thr, higherIsWorse = true) {
  if (value == null || !Number.isFinite(Number(value))) return STATUS.SAUDAVEL;
  const v = Number(value);
  if (higherIsWorse) {
    if (v >= thr.warn) return STATUS.CRITICO;
    if (v >= thr.ok) return STATUS.ATENCAO;
    return STATUS.SAUDAVEL;
  }
  return STATUS.SAUDAVEL;
}

function pickStats(block) {
  const s = block && (block.duration_ms || block) || {};
  return {
    atual: s.last != null ? s.last : (s.max != null ? s.max : null),
    media: s.avg != null ? s.avg : null,
    p50: s.p50 != null ? s.p50 : null,
    p95: s.p95 != null ? s.p95 : null,
    maximo: s.max != null ? s.max : null,
    minimo: s.min != null ? s.min : null,
    count: s.count != null ? s.count : 0
  };
}

/**
 * @param {object} summary
 * @returns {object}
 */
function buildKpis(summary = {}) {
  const lazyFirst = summary.lazy && summary.lazy.first_open_ms
    ? summary.lazy.first_open_ms
    : {};
  const recursos = summary.recursos || {};
  const ultimo = recursos.ultimo || {};

  return {
    boot: pickStats(summary.boot),
    login: pickStats(summary.login),
    erp: {
      ...pickStats({ duration_ms: lazyFirst }),
      created: summary.lazy ? summary.lazy.created : 0,
      reused: summary.lazy ? summary.lazy.reused : 0,
      errors: summary.lazy ? summary.lazy.errors : 0
    },
    miip: pickStats(summary.miip),
    nfe: pickStats(summary.nfe),
    central: pickStats(summary.central),
    recursos: {
      atual_rss_mb: ultimo.heap_rss_mb != null ? ultimo.heap_rss_mb : null,
      atual_heap_mb: ultimo.heap_used_mb != null ? ultimo.heap_used_mb : null,
      atual_cpu: ultimo.cpu_percent != null ? ultimo.cpu_percent : null,
      atual_event_loop_ms: ultimo.event_loop_delay_ms != null ? ultimo.event_loop_delay_ms : null,
      rss: pickStats({ duration_ms: recursos.heap_rss_mb }),
      heap: pickStats({ duration_ms: recursos.heap_used_mb }),
      cpu: pickStats({ duration_ms: recursos.cpu_percent }),
      event_loop: pickStats({ duration_ms: recursos.event_loop_delay_ms }),
      uptime_s: ultimo.uptime_s != null ? ultimo.uptime_s : null
    }
  };
}

/**
 * @param {object} summary
 * @returns {{ geral: string, por_dominio: object }}
 */
function buildStatus(summary = {}) {
  const kpis = buildKpis(summary);
  const por = {
    boot: levelFromValue(kpis.boot.p95, THRESHOLDS.boot_p95_ms),
    login: levelFromValue(kpis.login.p95, THRESHOLDS.login_p95_ms),
    erp: levelFromValue(kpis.erp.p95, THRESHOLDS.lazy_first_p95_ms),
    miip: levelFromValue(kpis.miip.p95, THRESHOLDS.miip_p95_ms),
    nfe: levelFromValue(kpis.nfe.p95, THRESHOLDS.nfe_p95_ms),
    central: levelFromValue(kpis.central.p95, THRESHOLDS.central_p95_ms),
    recursos: worst(
      levelFromValue(kpis.recursos.atual_event_loop_ms, THRESHOLDS.event_loop_ms),
      worst(
        levelFromValue(kpis.recursos.atual_cpu, THRESHOLDS.cpu_percent),
        levelFromValue(kpis.recursos.atual_rss_mb, THRESHOLDS.heap_rss_mb)
      )
    )
  };

  if ((summary.lazy && summary.lazy.errors) > 0) {
    por.erp = worst(por.erp, STATUS.ATENCAO);
  }
  if ((summary.lazy && summary.lazy.errors) >= 5) {
    por.erp = worst(por.erp, STATUS.CRITICO);
  }

  let geral = STATUS.SAUDAVEL;
  for (const st of Object.values(por)) {
    geral = worst(geral, st);
  }

  return {
    geral,
    por_dominio: por,
    limiares: THRESHOLDS,
    labels: {
      [STATUS.SAUDAVEL]: 'Saudável',
      [STATUS.ATENCAO]: 'Atenção',
      [STATUS.CRITICO]: 'Crítico'
    }
  };
}

function groupForEvent(eventName) {
  const n = String(eventName || '');
  if (n === EVENT_NAMES.RESOURCE_SAMPLE || n.startsWith('RESOURCE_')) return 'RESOURCE_SAMPLE';
  if (n.startsWith('BOOT_BACKGROUND') || n === EVENT_NAMES.BOOT_BACKGROUND_START
    || n === EVENT_NAMES.BOOT_BACKGROUND_STEP
    || n === EVENT_NAMES.BOOT_BACKGROUND_READY
    || n === EVENT_NAMES.BOOT_BACKGROUND_ERROR) return 'BACKGROUND';
  if (n.startsWith('BOOT_')) return 'BOOT';
  if (n === EVENT_NAMES.AUTH_LOGIN_DURATION || n.startsWith('AUTH_')) return 'LOGIN';
  if (n.startsWith('MODULE_') || n.startsWith('LAZY_')) return 'MODULE';
  if (n.startsWith('MIIP_')) return 'MIIP';
  if (n.startsWith('SOAP_')) return 'SOAP';
  if (n.startsWith('CENTRAL_')) return 'CENTRAL';
  return null;
}

const HISTORY_GROUPS = new Set([
  'BOOT', 'LOGIN', 'MODULE', 'MIIP', 'SOAP', 'CENTRAL', 'BACKGROUND', 'RESOURCE_SAMPLE'
]);

/**
 * @param {number} [limit]
 * @returns {object[]}
 */
function buildRecent(limit = 80) {
  const rows = eventBus.getRecent(Math.max(20, Math.min(200, Number(limit) || 80)));
  const out = [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const env = rows[i];
    if (!env || !env.event_name) continue;
    const grupo = groupForEvent(env.event_name);
    if (!grupo || !HISTORY_GROUPS.has(grupo)) continue;
    out.push({
      timestamp: env.timestamp,
      event_name: env.event_name,
      grupo,
      categoria: env.categoria,
      nivel: env.nivel,
      origem: env.origem,
      duracao_ms: env.duracao_ms != null ? env.duracao_ms : null,
      resultado: env.resultado || null
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * @param {object} summary
 * @returns {object}
 */
function enrichSummaryForDashboard(summary) {
  const base = summary || {};
  let alerts = null;
  try {
    const alertEngine = require('./alertEngine');
    alerts = {
      ...alertEngine.getAlertsSummary(),
      ativos_lista: alertEngine.listAlerts({ status: 'ativo', limit: 20 })
    };
  } catch (_) {
    alerts = { ativos: 0, ativos_lista: [], por_severidade: {} };
  }
  return {
    ...base,
    kpis: buildKpis(base),
    status: buildStatus(base),
    recent: buildRecent(80),
    alerts,
    read_only: true
  };
}

module.exports = {
  STATUS,
  THRESHOLDS,
  buildKpis,
  buildStatus,
  buildRecent,
  enrichSummaryForDashboard,
  groupForEvent
};
