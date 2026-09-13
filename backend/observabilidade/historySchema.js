'use strict';

/**
 * RC12.5 — Schema isolado de observabilidade (CREATE IF NOT EXISTS).
 * Não altera tabelas de negócio existentes.
 * @module observabilidade/historySchema
 */

const { RETENCAO_POR_NIVEL } = require('./eventPolicies');
const { NIVEIS } = require('./eventTypes');

const DDL = [
  `CREATE TABLE IF NOT EXISTS obs_metric_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    nivel TEXT NOT NULL DEFAULT 'INFO',
    retencao_dias INTEGER NOT NULL DEFAULT 30,
    boot_ms REAL,
    login_ms REAL,
    lazy_first_ms REAL,
    lazy_reuse_ms REAL,
    lazy_created INTEGER,
    lazy_reused INTEGER,
    recursos_rss_mb REAL,
    recursos_heap_mb REAL,
    recursos_cpu REAL,
    recursos_el_ms REAL,
    recursos_uptime_s REAL,
    miip_ms REAL,
    central_ms REAL,
    nfe_ms REAL,
    background_ms REAL,
    alerts_ativos INTEGER,
    payload_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_obs_snap_created ON obs_metric_snapshots(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_obs_snap_nivel ON obs_metric_snapshots(nivel)`,

  `CREATE TABLE IF NOT EXISTS obs_alert_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    nivel TEXT NOT NULL DEFAULT 'WARN',
    retencao_dias INTEGER NOT NULL DEFAULT 90,
    rule TEXT NOT NULL,
    fingerprint TEXT,
    severidade TEXT,
    status TEXT,
    titulo TEXT,
    mensagem TEXT,
    metric_value REAL,
    threshold REAL,
    occurrences INTEGER,
    payload_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_obs_alert_created ON obs_alert_history(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_obs_alert_rule ON obs_alert_history(rule)`,

  `CREATE TABLE IF NOT EXISTS obs_aggregates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    periodo_tipo TEXT NOT NULL,
    periodo_inicio TEXT NOT NULL,
    periodo_fim TEXT NOT NULL,
    dominio TEXT NOT NULL,
    metric_key TEXT NOT NULL,
    nivel TEXT NOT NULL DEFAULT 'INFO',
    retencao_dias INTEGER NOT NULL DEFAULT 30,
    sample_count INTEGER,
    avg_value REAL,
    min_value REAL,
    max_value REAL,
    p50_value REAL,
    p95_value REAL,
    UNIQUE(periodo_tipo, periodo_inicio, dominio, metric_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_obs_agg_periodo ON obs_aggregates(periodo_tipo, periodo_inicio)`
];

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * @param {import('sqlite3').Database} db
 * @returns {Promise<{ ok: boolean }>}
 */
async function ensureHistorySchema(db) {
  if (!db) return { ok: false };
  for (const sql of DDL) {
    await run(db, sql);
  }
  return { ok: true };
}

function retencaoParaNivel(nivel) {
  return RETENCAO_POR_NIVEL[nivel] || RETENCAO_POR_NIVEL[NIVEIS.INFO];
}

/** Mapeia severidade de alerta → nível de retenção */
function nivelParaSeveridade(sev) {
  const s = String(sev || '').toLowerCase();
  if (s === 'critica') return NIVEIS.CRITICAL;
  if (s === 'alta') return NIVEIS.ERROR;
  if (s === 'media') return NIVEIS.WARN;
  if (s === 'baixa') return NIVEIS.INFO;
  return NIVEIS.WARN;
}

/** Retenção agregados por tipo de período */
function retencaoParaPeriodo(tipo) {
  const t = String(tipo || '').toLowerCase();
  if (t === 'hora') return { nivel: NIVEIS.DEBUG, dias: RETENCAO_POR_NIVEL[NIVEIS.DEBUG] };
  if (t === 'dia') return { nivel: NIVEIS.INFO, dias: RETENCAO_POR_NIVEL[NIVEIS.INFO] };
  if (t === 'semana') return { nivel: NIVEIS.WARN, dias: RETENCAO_POR_NIVEL[NIVEIS.WARN] };
  if (t === 'mes') return { nivel: NIVEIS.ERROR, dias: RETENCAO_POR_NIVEL[NIVEIS.ERROR] };
  return { nivel: NIVEIS.INFO, dias: RETENCAO_POR_NIVEL[NIVEIS.INFO] };
}

module.exports = {
  ensureHistorySchema,
  retencaoParaNivel,
  nivelParaSeveridade,
  retencaoParaPeriodo,
  DDL
};
