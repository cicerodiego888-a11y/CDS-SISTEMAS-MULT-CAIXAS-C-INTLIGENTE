'use strict';

/**
 * RC12.5 — Serviço de histórico: snapshots, agregação e retenção.
 * Observe-only; nunca bloqueia regras de negócio.
 * @module observabilidade/historyService
 */

const { aggregate } = require('./metricsAggregator');
const { NIVEIS } = require('./eventTypes');
const {
  ensureHistorySchema,
  retencaoParaNivel,
  nivelParaSeveridade,
  retencaoParaPeriodo
} = require('./historySchema');
const { createHistoryRepository } = require('./historyRepository');
const telemetryCollector = require('./telemetryCollector');
const alertEngine = require('./alertEngine');
const { enrichSummaryForDashboard } = require('./dashboardView');

const DEFAULT_SNAPSHOT_MS = 5 * 60 * 1000;
const DEFAULT_RETENTION_MS = 60 * 60 * 1000;
const DEFAULT_AGGREGATE_MS = 15 * 60 * 1000;

const METRIC_COLUMNS = Object.freeze([
  'boot_ms',
  'login_ms',
  'lazy_first_ms',
  'lazy_reuse_ms',
  'recursos_rss_mb',
  'recursos_heap_mb',
  'recursos_cpu',
  'recursos_el_ms',
  'miip_ms',
  'central_ms',
  'nfe_ms',
  'background_ms',
  'alerts_ativos'
]);

const DOMAIN_FOR_METRIC = Object.freeze({
  boot_ms: 'boot',
  login_ms: 'login',
  lazy_first_ms: 'lazy',
  lazy_reuse_ms: 'lazy',
  recursos_rss_mb: 'recursos',
  recursos_heap_mb: 'recursos',
  recursos_cpu: 'recursos',
  recursos_el_ms: 'recursos',
  miip_ms: 'miip',
  central_ms: 'central',
  nfe_ms: 'nfe',
  background_ms: 'background',
  alerts_ativos: 'alertas'
});

let started = false;
let repo = null;
let timers = [];
let lastAlertFingerprints = new Set();

function pickMs(block) {
  if (!block) return null;
  const d = block.duration_ms || block;
  if (d && d.last != null && Number.isFinite(Number(d.last))) return Number(d.last);
  if (d && d.avg != null && Number.isFinite(Number(d.avg))) return Number(d.avg);
  return null;
}

function isoNow() {
  return new Date().toISOString();
}

function floorPeriod(date, tipo) {
  const d = new Date(date);
  if (tipo === 'hora') {
    d.setUTCMinutes(0, 0, 0);
  } else if (tipo === 'dia') {
    d.setUTCHours(0, 0, 0, 0);
  } else if (tipo === 'semana') {
    const day = d.getUTCDay();
    const diff = (day + 6) % 7; // Monday start
    d.setUTCDate(d.getUTCDate() - diff);
    d.setUTCHours(0, 0, 0, 0);
  } else if (tipo === 'mes') {
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
  }
  return d;
}

function endPeriod(inicio, tipo) {
  const d = new Date(inicio);
  if (tipo === 'hora') d.setUTCHours(d.getUTCHours() + 1);
  else if (tipo === 'dia') d.setUTCDate(d.getUTCDate() + 1);
  else if (tipo === 'semana') d.setUTCDate(d.getUTCDate() + 7);
  else if (tipo === 'mes') d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

function obsLog(evento, extra = {}) {
  console.log(JSON.stringify({
    tag: 'OBS',
    evento,
    ts: new Date().toISOString(),
    ...extra
  }));
}

function buildSnapshotRow(summary, alertsSummary) {
  const kpis = summary.kpis || {};
  const nivel = NIVEIS.INFO;
  const row = {
    created_at: isoNow(),
    nivel,
    retencao_dias: retencaoParaNivel(nivel),
    boot_ms: pickMs(summary.boot) || (kpis.boot && kpis.boot.atual),
    login_ms: pickMs(summary.login) || (kpis.login && kpis.login.atual),
    lazy_first_ms: summary.lazy && summary.lazy.first_open_ms
      ? (summary.lazy.first_open_ms.last != null ? summary.lazy.first_open_ms.last : summary.lazy.first_open_ms.avg)
      : null,
    lazy_reuse_ms: summary.lazy && summary.lazy.reuse_ms
      ? (summary.lazy.reuse_ms.last != null ? summary.lazy.reuse_ms.last : summary.lazy.reuse_ms.avg)
      : null,
    lazy_created: summary.lazy ? summary.lazy.created : 0,
    lazy_reused: summary.lazy ? summary.lazy.reused : 0,
    recursos_rss_mb: summary.recursos && summary.recursos.ultimo
      ? summary.recursos.ultimo.heap_rss_mb
      : null,
    recursos_heap_mb: summary.recursos && summary.recursos.ultimo
      ? summary.recursos.ultimo.heap_used_mb
      : null,
    recursos_cpu: summary.recursos && summary.recursos.ultimo
      ? summary.recursos.ultimo.cpu_percent
      : null,
    recursos_el_ms: summary.recursos && summary.recursos.ultimo
      ? summary.recursos.ultimo.event_loop_delay_ms
      : null,
    recursos_uptime_s: summary.recursos && summary.recursos.ultimo
      ? summary.recursos.ultimo.uptime_s
      : null,
    miip_ms: pickMs(summary.miip),
    central_ms: pickMs(summary.central),
    nfe_ms: pickMs(summary.nfe),
    background_ms: pickMs(summary.background),
    alerts_ativos: alertsSummary && alertsSummary.ativos != null ? alertsSummary.ativos : 0,
    payload_json: JSON.stringify({
      kpis,
      status: summary.status || null,
      alerts: {
        ativos: alertsSummary ? alertsSummary.ativos : 0,
        por_severidade: alertsSummary ? alertsSummary.por_severidade : {}
      }
    })
  };
  return row;
}

async function persistActiveAlerts() {
  if (!repo) return 0;
  const ativos = alertEngine.listAlerts({ status: 'ativo', limit: 100 });
  let inserted = 0;
  const current = new Set();
  for (const a of ativos) {
    const fp = a.fingerprint || `${a.rule}:${a.id}`;
    current.add(fp);
    if (lastAlertFingerprints.has(fp)) continue;
    const nivel = nivelParaSeveridade(a.severidade);
    await repo.insertAlert({
      created_at: a.created_at || isoNow(),
      resolved_at: null,
      nivel,
      retencao_dias: retencaoParaNivel(nivel),
      rule: a.rule,
      fingerprint: a.fingerprint,
      severidade: a.severidade,
      status: a.status || 'ativo',
      titulo: a.titulo,
      mensagem: a.mensagem,
      metric_value: a.metric_value,
      threshold: a.threshold,
      occurrences: a.occurrences || 1,
      payload_json: JSON.stringify(a.payload || {})
    });
    inserted += 1;
  }
  lastAlertFingerprints = current;
  return inserted;
}

async function takeSnapshot() {
  if (!repo) return null;
  try {
    const raw = telemetryCollector.getSummary();
    const summary = enrichSummaryForDashboard(raw);
    const alertsSummary = alertEngine.getAlertsSummary();
    const row = buildSnapshotRow(summary, alertsSummary);
    const result = await repo.insertSnapshot(row);
    const alertsInserted = await persistActiveAlerts();
    obsLog('OBS HISTORY SNAPSHOT', {
      id: result.id,
      alerts_ativos: row.alerts_ativos,
      alerts_inserted: alertsInserted
    });
    return { id: result.id, row };
  } catch (err) {
    obsLog('OBS ERROR', {
      fase: 'history.snapshot',
      erro: err && err.message ? err.message : String(err)
    });
    return null;
  }
}

async function rebuildAggregatesFor(tipo, lookbackDays) {
  if (!repo) return 0;
  const from = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const rows = await repo.listSnapshots({ from, limit: 5000 });
  if (!rows.length) return 0;

  /** @type {Map<string, number[]>} */
  const buckets = new Map();

  for (const row of rows) {
    const inicio = floorPeriod(row.created_at, tipo);
    const keyBase = inicio.toISOString();
    for (const col of METRIC_COLUMNS) {
      const val = Number(row[col]);
      if (!Number.isFinite(val)) continue;
      const bucketKey = `${keyBase}|${DOMAIN_FOR_METRIC[col]}|${col}`;
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey).push(val);
    }
  }

  const ret = retencaoParaPeriodo(tipo);
  let upserts = 0;
  for (const [bucketKey, values] of buckets.entries()) {
    const [periodoInicio, dominio, metricKey] = bucketKey.split('|');
    const stats = aggregate(values);
    const fim = endPeriod(periodoInicio, tipo).toISOString();
    await repo.upsertAggregate({
      created_at: isoNow(),
      periodo_tipo: tipo,
      periodo_inicio: periodoInicio,
      periodo_fim: fim,
      dominio,
      metric_key: metricKey,
      nivel: ret.nivel,
      retencao_dias: ret.dias,
      sample_count: stats.count,
      avg_value: stats.avg,
      min_value: stats.min,
      max_value: stats.max,
      p50_value: stats.p50,
      p95_value: stats.p95
    });
    upserts += 1;
  }
  return upserts;
}

async function runAggregation() {
  try {
    const h = await rebuildAggregatesFor('hora', 3);
    const d = await rebuildAggregatesFor('dia', 45);
    const w = await rebuildAggregatesFor('semana', 120);
    const m = await rebuildAggregatesFor('mes', 400);
    obsLog('OBS HISTORY AGGREGATE', { hora: h, dia: d, semana: w, mes: m });
    return { hora: h, dia: d, semana: w, mes: m };
  } catch (err) {
    obsLog('OBS ERROR', {
      fase: 'history.aggregate',
      erro: err && err.message ? err.message : String(err)
    });
    return null;
  }
}

async function runRetention() {
  if (!repo) return null;
  try {
    const result = await repo.applyRetention();
    obsLog('OBS HISTORY RETENTION', result);
    return result;
  } catch (err) {
    obsLog('OBS ERROR', {
      fase: 'history.retention',
      erro: err && err.message ? err.message : String(err)
    });
    return null;
  }
}

/**
 * Compara duas janelas (média das métricas).
 */
async function comparePeriods(periodoA, periodoB) {
  const [aRows, bRows] = await Promise.all([
    repo.listSnapshots({ from: periodoA.from, to: periodoA.to, limit: 2000 }),
    repo.listSnapshots({ from: periodoB.from, to: periodoB.to, limit: 2000 })
  ]);

  function statsFor(rows, col) {
    return aggregate(rows.map((r) => r[col]).filter((v) => Number.isFinite(Number(v))));
  }

  const domains = {};
  for (const col of METRIC_COLUMNS) {
    domains[col] = {
      a: statsFor(aRows, col),
      b: statsFor(bRows, col)
    };
  }
  return {
    periodo_a: periodoA,
    periodo_b: periodoB,
    samples_a: aRows.length,
    samples_b: bRows.length,
    metrics: domains
  };
}

function toCsv(rows, columns) {
  const header = columns.join(',');
  const lines = rows.map((r) => columns.map((c) => {
    const v = r[c];
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }).join(','));
  return [header, ...lines].join('\n');
}

async function exportHistory({ format = 'json', from, to, tipo = 'snapshots' } = {}) {
  if (tipo === 'aggregates') {
    const rows = await repo.listAggregates({ from, to, limit: 5000 });
    if (String(format).toLowerCase() === 'csv') {
      return {
        contentType: 'text/csv; charset=utf-8',
        body: toCsv(rows, [
          'periodo_tipo', 'periodo_inicio', 'periodo_fim', 'dominio', 'metric_key',
          'sample_count', 'avg_value', 'min_value', 'max_value', 'p50_value', 'p95_value'
        ]),
        filename: `obs-aggregates-${Date.now()}.csv`
      };
    }
    return {
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ ok: true, tipo: 'aggregates', total: rows.length, rows }, null, 2),
      filename: `obs-aggregates-${Date.now()}.json`
    };
  }

  if (tipo === 'alerts') {
    const rows = await repo.listAlerts({ from, to, limit: 2000 });
    if (String(format).toLowerCase() === 'csv') {
      return {
        contentType: 'text/csv; charset=utf-8',
        body: toCsv(rows, [
          'created_at', 'rule', 'severidade', 'status', 'titulo', 'metric_value', 'occurrences'
        ]),
        filename: `obs-alerts-${Date.now()}.csv`
      };
    }
    return {
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ ok: true, tipo: 'alerts', total: rows.length, rows }, null, 2),
      filename: `obs-alerts-${Date.now()}.json`
    };
  }

  const rows = await repo.listSnapshots({ from, to, limit: 5000 });
  if (String(format).toLowerCase() === 'csv') {
    return {
      contentType: 'text/csv; charset=utf-8',
      body: toCsv(rows, [
        'created_at', 'boot_ms', 'login_ms', 'lazy_first_ms', 'lazy_reuse_ms',
        'recursos_rss_mb', 'recursos_heap_mb', 'recursos_cpu', 'recursos_el_ms',
        'miip_ms', 'central_ms', 'nfe_ms', 'background_ms', 'alerts_ativos'
      ]),
      filename: `obs-snapshots-${Date.now()}.csv`
    };
  }
  return {
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ ok: true, tipo: 'snapshots', total: rows.length, rows }, null, 2),
    filename: `obs-snapshots-${Date.now()}.json`
  };
}

async function getHistorySummary({ from, to, periodo_tipo = 'hora' } = {}) {
  const [snapshots, aggregates, alerts] = await Promise.all([
    repo.listSnapshots({ from, to, limit: 2000 }),
    repo.listAggregates({ periodo_tipo, from, to, limit: 2000 }),
    repo.listAlerts({ from, to, limit: 100 })
  ]);

  const series = {};
  for (const col of METRIC_COLUMNS) {
    series[col] = snapshots.map((r) => ({
      t: r.created_at,
      v: r[col] != null ? Number(r[col]) : null
    }));
  }

  return {
    versao_schema: 'obs.v1',
    gerado_em: isoNow(),
    read_only: true,
    from: from || null,
    to: to || null,
    periodo_tipo,
    snapshots_count: snapshots.length,
    aggregates_count: aggregates.length,
    alerts_count: alerts.length,
    series,
    aggregates,
    alerts_recent: alerts.slice(0, 20)
  };
}

/**
 * @param {{ db?: object, snapshotMs?: number, retentionMs?: number, aggregateMs?: number }} [opts]
 */
async function start(opts = {}) {
  if (started) return { ok: true, reason: 'already' };
  try {
    let db = opts.db;
    if (!db) {
      try {
        db = require('../database');
      } catch (err) {
        obsLog('OBS ERROR', { fase: 'history.start', erro: 'database unavailable' });
        return { ok: false };
      }
    }
    await ensureHistorySchema(db);
    repo = createHistoryRepository(db);

    const snapshotMs = Math.max(30000, Number(opts.snapshotMs) || Number(process.env.CDS_OBS_SNAPSHOT_MS) || DEFAULT_SNAPSHOT_MS);
    const retentionMs = Math.max(60000, Number(opts.retentionMs) || Number(process.env.CDS_OBS_RETENTION_MS) || DEFAULT_RETENTION_MS);
    const aggregateMs = Math.max(60000, Number(opts.aggregateMs) || Number(process.env.CDS_OBS_AGGREGATE_MS) || DEFAULT_AGGREGATE_MS);

    // Snapshot inicial adiado (não bloqueia boot)
    setTimeout(() => {
      takeSnapshot().catch(() => {});
    }, 5000);

    const tSnap = setInterval(() => { takeSnapshot().catch(() => {}); }, snapshotMs);
    const tAgg = setInterval(() => { runAggregation().catch(() => {}); }, aggregateMs);
    const tRet = setInterval(() => { runRetention().catch(() => {}); }, retentionMs);
    [tSnap, tAgg, tRet].forEach((t) => {
      if (typeof t.unref === 'function') t.unref();
      timers.push(t);
    });

    started = true;
    obsLog('OBS HISTORY START', { snapshotMs, retentionMs, aggregateMs });
    return { ok: true, snapshotMs, retentionMs, aggregateMs };
  } catch (err) {
    obsLog('OBS ERROR', {
      fase: 'history.start',
      erro: err && err.message ? err.message : String(err)
    });
    return { ok: false };
  }
}

function stop() {
  for (const t of timers) {
    try { clearInterval(t); } catch (_) { /* ignore */ }
  }
  timers = [];
  started = false;
}

function _resetForTests() {
  stop();
  repo = null;
  lastAlertFingerprints = new Set();
  started = false;
}

function _setRepoForTests(r) {
  repo = r;
  started = true;
}

module.exports = {
  start,
  stop,
  takeSnapshot,
  runAggregation,
  runRetention,
  getHistorySummary,
  comparePeriods,
  exportHistory,
  rebuildAggregatesFor,
  buildSnapshotRow,
  METRIC_COLUMNS,
  _resetForTests,
  _setRepoForTests,
  getRepository: () => repo
};
