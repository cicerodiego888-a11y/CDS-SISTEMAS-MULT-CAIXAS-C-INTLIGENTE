'use strict';

/**
 * RC12.5 — Repositório SQLite de histórico de observabilidade.
 * @module observabilidade/historyRepository
 */

function createHistoryRepository(db) {
  function run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, changes: this.changes });
      });
    });
  }

  function all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
  }

  function get(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });
  }

  async function insertSnapshot(row) {
    return run(
      `INSERT INTO obs_metric_snapshots (
        created_at, nivel, retencao_dias,
        boot_ms, login_ms, lazy_first_ms, lazy_reuse_ms, lazy_created, lazy_reused,
        recursos_rss_mb, recursos_heap_mb, recursos_cpu, recursos_el_ms, recursos_uptime_s,
        miip_ms, central_ms, nfe_ms, background_ms, alerts_ativos, payload_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        row.created_at,
        row.nivel,
        row.retencao_dias,
        row.boot_ms,
        row.login_ms,
        row.lazy_first_ms,
        row.lazy_reuse_ms,
        row.lazy_created,
        row.lazy_reused,
        row.recursos_rss_mb,
        row.recursos_heap_mb,
        row.recursos_cpu,
        row.recursos_el_ms,
        row.recursos_uptime_s,
        row.miip_ms,
        row.central_ms,
        row.nfe_ms,
        row.background_ms,
        row.alerts_ativos,
        row.payload_json
      ]
    );
  }

  async function insertAlert(row) {
    return run(
      `INSERT INTO obs_alert_history (
        created_at, resolved_at, nivel, retencao_dias, rule, fingerprint, severidade, status,
        titulo, mensagem, metric_value, threshold, occurrences, payload_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        row.created_at,
        row.resolved_at || null,
        row.nivel,
        row.retencao_dias,
        row.rule,
        row.fingerprint,
        row.severidade,
        row.status,
        row.titulo,
        row.mensagem,
        row.metric_value,
        row.threshold,
        row.occurrences,
        row.payload_json
      ]
    );
  }

  async function upsertAggregate(row) {
    return run(
      `INSERT INTO obs_aggregates (
        created_at, periodo_tipo, periodo_inicio, periodo_fim, dominio, metric_key,
        nivel, retencao_dias, sample_count, avg_value, min_value, max_value, p50_value, p95_value
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(periodo_tipo, periodo_inicio, dominio, metric_key) DO UPDATE SET
        periodo_fim=excluded.periodo_fim,
        sample_count=excluded.sample_count,
        avg_value=excluded.avg_value,
        min_value=excluded.min_value,
        max_value=excluded.max_value,
        p50_value=excluded.p50_value,
        p95_value=excluded.p95_value,
        created_at=excluded.created_at`,
      [
        row.created_at,
        row.periodo_tipo,
        row.periodo_inicio,
        row.periodo_fim,
        row.dominio,
        row.metric_key,
        row.nivel,
        row.retencao_dias,
        row.sample_count,
        row.avg_value,
        row.min_value,
        row.max_value,
        row.p50_value,
        row.p95_value
      ]
    );
  }

  async function listSnapshots({ from, to, limit = 500 } = {}) {
    const params = [];
    let sql = 'SELECT * FROM obs_metric_snapshots WHERE 1=1';
    if (from) {
      sql += ' AND created_at >= ?';
      params.push(from);
    }
    if (to) {
      sql += ' AND created_at <= ?';
      params.push(to);
    }
    sql += ' ORDER BY created_at ASC LIMIT ?';
    params.push(Math.max(1, Math.min(5000, Number(limit) || 500)));
    return all(sql, params);
  }

  async function listAlerts({ from, to, limit = 200 } = {}) {
    const params = [];
    let sql = 'SELECT * FROM obs_alert_history WHERE 1=1';
    if (from) {
      sql += ' AND created_at >= ?';
      params.push(from);
    }
    if (to) {
      sql += ' AND created_at <= ?';
      params.push(to);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Math.max(1, Math.min(2000, Number(limit) || 200)));
    return all(sql, params);
  }

  async function listAggregates({ periodo_tipo, from, to, dominio, limit = 500 } = {}) {
    const params = [];
    let sql = 'SELECT * FROM obs_aggregates WHERE 1=1';
    if (periodo_tipo) {
      sql += ' AND periodo_tipo = ?';
      params.push(periodo_tipo);
    }
    if (dominio) {
      sql += ' AND dominio = ?';
      params.push(dominio);
    }
    if (from) {
      sql += ' AND periodo_inicio >= ?';
      params.push(from);
    }
    if (to) {
      sql += ' AND periodo_inicio <= ?';
      params.push(to);
    }
    sql += ' ORDER BY periodo_inicio ASC LIMIT ?';
    params.push(Math.max(1, Math.min(5000, Number(limit) || 500)));
    return all(sql, params);
  }

  /**
   * Limpeza por política: remove linhas com created_at < now - retencao_dias
   * (usando o retencao_dias gravado na própria linha).
   */
  async function applyRetention() {
    const snap = await run(
      `DELETE FROM obs_metric_snapshots
       WHERE datetime(created_at) < datetime('now', '-' || retencao_dias || ' days')`
    );
    const alerts = await run(
      `DELETE FROM obs_alert_history
       WHERE datetime(created_at) < datetime('now', '-' || retencao_dias || ' days')`
    );
    const aggs = await run(
      `DELETE FROM obs_aggregates
       WHERE datetime(periodo_inicio) < datetime('now', '-' || retencao_dias || ' days')`
    );
    return {
      snapshots_removed: snap.changes || 0,
      alerts_removed: alerts.changes || 0,
      aggregates_removed: aggs.changes || 0
    };
  }

  async function countSnapshots() {
    const row = await get('SELECT COUNT(*) AS c FROM obs_metric_snapshots');
    return row ? Number(row.c) : 0;
  }

  return {
    insertSnapshot,
    insertAlert,
    upsertAggregate,
    listSnapshots,
    listAlerts,
    listAggregates,
    applyRetention,
    countSnapshots,
    run,
    all,
    get
  };
}

module.exports = {
  createHistoryRepository
};
