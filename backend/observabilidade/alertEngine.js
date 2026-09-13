'use strict';

/**
 * RC12.4 — Alert Engine (observe-only).
 * Consome o Event Bus; regras técnicas; dedupe em memória; sem persistência/DB.
 * @module observabilidade/alertEngine
 */

const crypto = require('crypto');
const eventBus = require('./eventBus');
const { EVENT_NAMES, CRITICIDADES } = require('./eventTypes');

const SEVERIDADE = Object.freeze({
  BAIXA: 'baixa',
  MEDIA: 'media',
  ALTA: 'alta',
  CRITICA: 'critica'
});

/** Limiares calibráveis via env (fallback seguro). */
const RULES = Object.freeze({
  BOOT_LENTO: {
    code: 'BOOT_LENTO',
    threshold_ms: Number(process.env.CDS_OBS_ALERT_BOOT_MS) || 5000,
    severidade: SEVERIDADE.ALTA,
    dedupe_ms: 5 * 60 * 1000
  },
  LOGIN_LENTO: {
    code: 'LOGIN_LENTO',
    threshold_ms: Number(process.env.CDS_OBS_ALERT_LOGIN_MS) || 4000,
    severidade: SEVERIDADE.MEDIA,
    dedupe_ms: 5 * 60 * 1000
  },
  MODULE_LENTO: {
    code: 'MODULE_LENTO',
    threshold_ms: Number(process.env.CDS_OBS_ALERT_MODULE_MS) || 5000,
    severidade: SEVERIDADE.MEDIA,
    dedupe_ms: 5 * 60 * 1000
  },
  MIIP_LENTO: {
    code: 'MIIP_LENTO',
    threshold_ms: Number(process.env.CDS_OBS_ALERT_MIIP_MS) || 2000,
    severidade: SEVERIDADE.MEDIA,
    dedupe_ms: 10 * 60 * 1000
  },
  CENTRAL_PARADA: {
    code: 'CENTRAL_PARADA',
    gap_ms: Number(process.env.CDS_OBS_ALERT_CENTRAL_GAP_MS) || 15 * 60 * 1000,
    severidade: SEVERIDADE.ALTA,
    dedupe_ms: 10 * 60 * 1000
  },
  SOAP_TIMEOUT: {
    code: 'SOAP_TIMEOUT',
    window_ms: 5 * 60 * 1000,
    min_count: Number(process.env.CDS_OBS_ALERT_SOAP_TIMEOUT_N) || 1,
    severidade: SEVERIDADE.ALTA,
    dedupe_ms: 5 * 60 * 1000
  },
  NFE_FILA_ALTA: {
    code: 'NFE_FILA_ALTA',
    in_flight: Number(process.env.CDS_OBS_ALERT_NFE_INFLIGHT) || 8,
    severidade: SEVERIDADE.ALTA,
    dedupe_ms: 5 * 60 * 1000
  },
  RESOURCE_MEMORY_HIGH: {
    code: 'RESOURCE_MEMORY_HIGH',
    rss_mb: Number(process.env.CDS_OBS_ALERT_RSS_MB) || 1024,
    severidade: SEVERIDADE.MEDIA,
    dedupe_ms: 10 * 60 * 1000
  },
  RESOURCE_CPU_HIGH: {
    code: 'RESOURCE_CPU_HIGH',
    cpu_percent: Number(process.env.CDS_OBS_ALERT_CPU_PCT) || 80,
    severidade: SEVERIDADE.MEDIA,
    dedupe_ms: 10 * 60 * 1000
  },
  EVENT_LOOP_HIGH: {
    code: 'EVENT_LOOP_HIGH',
    delay_ms: Number(process.env.CDS_OBS_ALERT_EL_MS) || 200,
    severidade: SEVERIDADE.ALTA,
    dedupe_ms: 5 * 60 * 1000
  }
});

const MAX_HISTORY = 200;
const MAX_ACTIVE = 100;

let started = false;
let unsub = null;
let watchdog = null;
let seq = 0;

/** @type {Map<string, object>} fingerprint → alerta ativo */
const active = new Map();
/** @type {Map<string, number>} fingerprint → lastFiredAt */
const lastFired = new Map();
/** @type {object[]} */
const history = [];

/** Estado auxiliar para regras compostas */
const state = {
  lastCentralOkAt: null,
  lastCentralEventAt: null,
  centralSeen: false,
  soapTimeoutTs: [],
  soapIniciado: 0,
  soapEncerrado: 0
};

function nowMs() {
  return Date.now();
}

function fingerprint(ruleCode, parts = []) {
  const raw = [ruleCode, ...parts.map((p) => String(p == null ? '' : p))].join('|');
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

function pushHistory(alert) {
  history.push(alert);
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

function obsLog(evento, extra = {}) {
  console.log(JSON.stringify({
    tag: 'OBS',
    evento,
    ts: new Date().toISOString(),
    ...extra
  }));
}

/**
 * @param {object} opts
 * @returns {{ fired: boolean, alert?: object, reason?: string }}
 */
function raiseAlert(opts) {
  const rule = opts.rule;
  const fp = opts.fingerprint || fingerprint(rule.code, opts.fpParts || []);
  const ts = nowMs();
  const dedupeMs = Number(rule.dedupe_ms) || 300000;
  const prev = lastFired.get(fp);
  if (prev != null && (ts - prev) < dedupeMs) {
    const existing = active.get(fp);
    if (existing) {
      existing.occurrences = (existing.occurrences || 1) + 1;
      existing.last_seen_at = new Date(ts).toISOString();
      existing.metric_value = opts.metric_value != null ? opts.metric_value : existing.metric_value;
    }
    return { fired: false, reason: 'dedupe', fingerprint: fp };
  }

  seq += 1;
  const alert = {
    id: `obs-alert-${seq}`,
    rule: rule.code,
    event_name: opts.event_name || rule.code,
    fingerprint: fp,
    severidade: rule.severidade || SEVERIDADE.MEDIA,
    criticidade: rule.severidade || CRITICIDADES.MEDIA,
    titulo: opts.titulo || rule.code,
    mensagem: opts.mensagem || '',
    metric_value: opts.metric_value != null ? opts.metric_value : null,
    threshold: opts.threshold != null ? opts.threshold : null,
    origem_evento: opts.origem || null,
    status: 'ativo',
    created_at: new Date(ts).toISOString(),
    last_seen_at: new Date(ts).toISOString(),
    occurrences: 1,
    payload: opts.payload && typeof opts.payload === 'object' ? opts.payload : {}
  };

  lastFired.set(fp, ts);
  active.set(fp, alert);
  if (active.size > MAX_ACTIVE) {
    const oldest = [...active.entries()].sort(
      (a, b) => String(a[1].created_at).localeCompare(String(b[1].created_at))
    )[0];
    if (oldest) active.delete(oldest[0]);
  }
  pushHistory({ ...alert });
  obsLog('OBS ALERT', {
    rule: alert.rule,
    fingerprint: alert.fingerprint,
    severidade: alert.severidade,
    metric_value: alert.metric_value
  });
  return { fired: true, alert };
}

function resolveAlert(fp, reason = 'recovered') {
  const existing = active.get(fp);
  if (!existing) return false;
  active.delete(fp);
  pushHistory({
    ...existing,
    status: 'resolvido',
    resolved_at: new Date().toISOString(),
    resolve_reason: reason
  });
  return true;
}

function pruneSoapTimeouts(ts) {
  const windowMs = RULES.SOAP_TIMEOUT.window_ms;
  state.soapTimeoutTs = state.soapTimeoutTs.filter((t) => (ts - t) <= windowMs);
}

function evaluateEnvelope(envelope) {
  if (!envelope || !envelope.event_name) return;
  const name = envelope.event_name;
  const dur = Number(envelope.duracao_ms);
  const ts = nowMs();
  const origem = envelope.origem || null;
  const payload = envelope.payload || {};

  // --- BOOT_LENTO ---
  if (name === EVENT_NAMES.BOOT_HTTP_LISTENING && Number.isFinite(dur) && dur >= RULES.BOOT_LENTO.threshold_ms) {
    raiseAlert({
      rule: RULES.BOOT_LENTO,
      event_name: name,
      fpParts: ['boot'],
      titulo: 'Boot lento',
      mensagem: `HTTP listening em ${dur} ms (limiar ${RULES.BOOT_LENTO.threshold_ms} ms)`,
      metric_value: dur,
      threshold: RULES.BOOT_LENTO.threshold_ms,
      origem,
      payload: { fase: 'boot' }
    });
  }

  // --- LOGIN_LENTO ---
  if (name === EVENT_NAMES.AUTH_LOGIN_DURATION && Number.isFinite(dur) && dur >= RULES.LOGIN_LENTO.threshold_ms) {
    raiseAlert({
      rule: RULES.LOGIN_LENTO,
      event_name: name,
      fpParts: ['login'],
      titulo: 'Login lento',
      mensagem: `Login em ${dur} ms (limiar ${RULES.LOGIN_LENTO.threshold_ms} ms)`,
      metric_value: dur,
      threshold: RULES.LOGIN_LENTO.threshold_ms,
      origem,
      payload: { phase: 'auth_login' }
    });
  }

  // --- MODULE_LENTO ---
  if (
    (name === EVENT_NAMES.MODULE_LAZY_CREATED || name === EVENT_NAMES.MODULE_OPEN)
    && Number.isFinite(dur)
    && dur >= RULES.MODULE_LENTO.threshold_ms
  ) {
    const page = payload.page || payload.module || 'unknown';
    raiseAlert({
      rule: RULES.MODULE_LENTO,
      event_name: name,
      fpParts: ['module', page],
      titulo: 'Módulo lento',
      mensagem: `Módulo ${page} em ${dur} ms (limiar ${RULES.MODULE_LENTO.threshold_ms} ms)`,
      metric_value: dur,
      threshold: RULES.MODULE_LENTO.threshold_ms,
      origem,
      payload: { page: String(page).slice(0, 80) }
    });
  }

  // --- MIIP_LENTO ---
  if (name === EVENT_NAMES.MIIP_IDENTIFY_FINISHED && Number.isFinite(dur) && dur >= RULES.MIIP_LENTO.threshold_ms) {
    raiseAlert({
      rule: RULES.MIIP_LENTO,
      event_name: name,
      fpParts: ['miip'],
      titulo: 'MIIP lento',
      mensagem: `Identify em ${dur} ms (limiar ${RULES.MIIP_LENTO.threshold_ms} ms)`,
      metric_value: dur,
      threshold: RULES.MIIP_LENTO.threshold_ms,
      origem
    });
  }

  // --- CENTRAL ---
  if (name.startsWith('CENTRAL_')) {
    state.centralSeen = true;
    state.lastCentralEventAt = ts;
    if (name === EVENT_NAMES.CENTRAL_SYNC_CONCLUIDA) {
      state.lastCentralOkAt = ts;
      resolveAlert(fingerprint(RULES.CENTRAL_PARADA.code, ['central']), 'sync_ok');
    }
    if (name === EVENT_NAMES.CENTRAL_SYNC_ERRO || name === EVENT_NAMES.CENTRAL_ERRO) {
      raiseAlert({
        rule: RULES.CENTRAL_PARADA,
        event_name: name,
        fpParts: ['central'],
        titulo: 'Central parada / erro',
        mensagem: `Evento ${name} indica falha na Central`,
        metric_value: 1,
        threshold: 0,
        origem,
        payload: { trigger: name }
      });
    }
  }

  // --- SOAP_TIMEOUT ---
  if (name === EVENT_NAMES.SOAP_TIMEOUT) {
    state.soapTimeoutTs.push(ts);
    pruneSoapTimeouts(ts);
    if (state.soapTimeoutTs.length >= RULES.SOAP_TIMEOUT.min_count) {
      raiseAlert({
        rule: RULES.SOAP_TIMEOUT,
        event_name: name,
        fpParts: ['soap_timeout'],
        titulo: 'SOAP timeout',
        mensagem: `${state.soapTimeoutTs.length} timeout(s) em ${Math.round(RULES.SOAP_TIMEOUT.window_ms / 60000)} min`,
        metric_value: state.soapTimeoutTs.length,
        threshold: RULES.SOAP_TIMEOUT.min_count,
        origem
      });
    }
  }

  // --- NFE_FILA_ALTA (proxy observabilidade: SOAP in-flight) ---
  if (name === EVENT_NAMES.SOAP_INICIADO) {
    state.soapIniciado += 1;
  }
  if (
    name === EVENT_NAMES.SOAP_FINALIZADO
    || name === EVENT_NAMES.SOAP_FALHA
    || name === EVENT_NAMES.SOAP_TIMEOUT
    || name === EVENT_NAMES.SOAP_HTTP_ERROR
  ) {
    state.soapEncerrado += 1;
  }
  const inFlight = Math.max(0, state.soapIniciado - state.soapEncerrado);
  if (inFlight >= RULES.NFE_FILA_ALTA.in_flight) {
    raiseAlert({
      rule: RULES.NFE_FILA_ALTA,
      event_name: name,
      fpParts: ['nfe_fila'],
      titulo: 'Fila NF-e alta',
      mensagem: `SOAP in-flight ≈ ${inFlight} (limiar ${RULES.NFE_FILA_ALTA.in_flight})`,
      metric_value: inFlight,
      threshold: RULES.NFE_FILA_ALTA.in_flight,
      origem,
      payload: { soap_iniciado: state.soapIniciado, soap_encerrado: state.soapEncerrado }
    });
  } else if (inFlight < Math.max(1, RULES.NFE_FILA_ALTA.in_flight / 2)) {
    resolveAlert(fingerprint(RULES.NFE_FILA_ALTA.code, ['nfe_fila']), 'fila_ok');
  }

  // --- RESOURCE_* ---
  if (name === EVENT_NAMES.RESOURCE_SAMPLE) {
    const rss = Number(payload.heap_rss_mb);
    const cpu = Number(payload.cpu_percent);
    const el = Number(payload.event_loop_delay_ms != null ? payload.event_loop_delay_ms : envelope.duracao_ms);

    if (Number.isFinite(rss) && rss >= RULES.RESOURCE_MEMORY_HIGH.rss_mb) {
      raiseAlert({
        rule: RULES.RESOURCE_MEMORY_HIGH,
        event_name: name,
        fpParts: ['rss'],
        titulo: 'Memória alta',
        mensagem: `RSS ${rss} MB (limiar ${RULES.RESOURCE_MEMORY_HIGH.rss_mb} MB)`,
        metric_value: rss,
        threshold: RULES.RESOURCE_MEMORY_HIGH.rss_mb,
        origem
      });
    } else if (Number.isFinite(rss) && rss < RULES.RESOURCE_MEMORY_HIGH.rss_mb * 0.85) {
      resolveAlert(fingerprint(RULES.RESOURCE_MEMORY_HIGH.code, ['rss']), 'memory_ok');
    }

    if (Number.isFinite(cpu) && cpu >= RULES.RESOURCE_CPU_HIGH.cpu_percent) {
      raiseAlert({
        rule: RULES.RESOURCE_CPU_HIGH,
        event_name: name,
        fpParts: ['cpu'],
        titulo: 'CPU alta',
        mensagem: `CPU ${cpu}% (limiar ${RULES.RESOURCE_CPU_HIGH.cpu_percent}%)`,
        metric_value: cpu,
        threshold: RULES.RESOURCE_CPU_HIGH.cpu_percent,
        origem
      });
    } else if (Number.isFinite(cpu) && cpu < RULES.RESOURCE_CPU_HIGH.cpu_percent * 0.7) {
      resolveAlert(fingerprint(RULES.RESOURCE_CPU_HIGH.code, ['cpu']), 'cpu_ok');
    }

    if (Number.isFinite(el) && el >= RULES.EVENT_LOOP_HIGH.delay_ms) {
      raiseAlert({
        rule: RULES.EVENT_LOOP_HIGH,
        event_name: name,
        fpParts: ['event_loop'],
        titulo: 'Event loop alto',
        mensagem: `Delay ${el} ms (limiar ${RULES.EVENT_LOOP_HIGH.delay_ms} ms)`,
        metric_value: el,
        threshold: RULES.EVENT_LOOP_HIGH.delay_ms,
        origem
      });
    } else if (Number.isFinite(el) && el < RULES.EVENT_LOOP_HIGH.delay_ms * 0.5) {
      resolveAlert(fingerprint(RULES.EVENT_LOOP_HIGH.code, ['event_loop']), 'el_ok');
    }

    // Watchdog Central: sem sucesso recente após atividade
    checkCentralWatchdog(ts);
  }
}

function checkCentralWatchdog(ts = nowMs()) {
  if (!state.centralSeen) return;
  const gap = RULES.CENTRAL_PARADA.gap_ms;
  const lastOk = state.lastCentralOkAt;
  const lastEv = state.lastCentralEventAt;
  if (lastOk == null && lastEv != null && (ts - lastEv) >= gap) {
    raiseAlert({
      rule: RULES.CENTRAL_PARADA,
      event_name: 'CENTRAL_PARADA',
      fpParts: ['central'],
      titulo: 'Central parada',
      mensagem: `Sem sincronização bem-sucedida há ${Math.round((ts - lastEv) / 60000)} min`,
      metric_value: ts - lastEv,
      threshold: gap,
      payload: { trigger: 'watchdog_no_ok' }
    });
    return;
  }
  if (lastOk != null && (ts - lastOk) >= gap) {
    raiseAlert({
      rule: RULES.CENTRAL_PARADA,
      event_name: 'CENTRAL_PARADA',
      fpParts: ['central'],
      titulo: 'Central parada',
      mensagem: `Última sync OK há ${Math.round((ts - lastOk) / 60000)} min`,
      metric_value: ts - lastOk,
      threshold: gap,
      payload: { trigger: 'watchdog_stale' }
    });
  }
}

function listAlerts(opts = {}) {
  const severidade = opts.severidade ? String(opts.severidade).toLowerCase() : null;
  const status = opts.status ? String(opts.status).toLowerCase() : 'ativo';
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50));

  let rows;
  if (status === 'historico' || status === 'all' || status === 'todos') {
    rows = [...history].reverse();
  } else if (status === 'resolvido') {
    rows = history.filter((a) => a.status === 'resolvido').reverse();
  } else {
    rows = [...active.values()].sort(
      (a, b) => String(b.last_seen_at || b.created_at).localeCompare(String(a.last_seen_at || a.created_at))
    );
  }

  if (severidade) {
    rows = rows.filter((a) => String(a.severidade).toLowerCase() === severidade);
  }

  return rows.slice(0, limit);
}

function getAlertsSummary() {
  const ativos = [...active.values()];
  const bySev = {
    baixa: 0,
    media: 0,
    alta: 0,
    critica: 0
  };
  for (const a of ativos) {
    const k = String(a.severidade || 'media').toLowerCase();
    if (bySev[k] != null) bySev[k] += 1;
    else bySev.media += 1;
  }
  const byRule = {};
  for (const a of ativos) {
    byRule[a.rule] = (byRule[a.rule] || 0) + 1;
  }
  return {
    versao_schema: 'obs.v1',
    gerado_em: new Date().toISOString(),
    read_only: true,
    ativos: ativos.length,
    historico_total: history.length,
    por_severidade: bySev,
    por_regra: byRule,
    regras: Object.keys(RULES),
    recentes: listAlerts({ status: 'historico', limit: 10 })
  };
}

function start() {
  if (started) return { ok: true, reason: 'already' };
  unsub = eventBus.subscribe('*', (envelope) => {
    try {
      evaluateEnvelope(envelope);
    } catch (err) {
      obsLog('OBS ERROR', {
        fase: 'alertEngine',
        erro: err && err.message ? err.message : String(err)
      });
    }
  });
  watchdog = setInterval(() => {
    try {
      checkCentralWatchdog();
    } catch (_) { /* ignore */ }
  }, 60 * 1000);
  if (typeof watchdog.unref === 'function') watchdog.unref();
  started = true;
  return { ok: true };
}

function stop() {
  if (unsub) {
    try { unsub(); } catch (_) { /* ignore */ }
    unsub = null;
  }
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
  started = false;
}

function _resetForTests() {
  stop();
  active.clear();
  lastFired.clear();
  history.length = 0;
  seq = 0;
  state.lastCentralOkAt = null;
  state.lastCentralEventAt = null;
  state.centralSeen = false;
  state.soapTimeoutTs = [];
  state.soapIniciado = 0;
  state.soapEncerrado = 0;
  started = false;
}

module.exports = {
  RULES,
  SEVERIDADE,
  start,
  stop,
  evaluateEnvelope,
  raiseAlert,
  resolveAlert,
  listAlerts,
  getAlertsSummary,
  fingerprint,
  checkCentralWatchdog,
  _resetForTests,
  _state: state,
  _active: active
};
