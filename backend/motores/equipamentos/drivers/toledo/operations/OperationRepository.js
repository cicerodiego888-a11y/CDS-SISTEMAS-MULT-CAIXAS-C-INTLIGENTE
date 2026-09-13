/**
 * Sprint 14.6 — OperationRepository
 */

'use strict';

const db = require('../../../../../database');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

let tabelaPronta = false;

async function garantirTabela() {
  if (tabelaPronta) return;
  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_operacoes (
      id TEXT PRIMARY KEY,
      operation TEXT,
      status TEXT,
      started_at DATETIME,
      finished_at DATETIME,
      duration INTEGER,
      bytes_sent INTEGER DEFAULT 0,
      bytes_received INTEGER DEFAULT 0,
      error TEXT,
      host TEXT,
      porta INTEGER,
      data_json TEXT
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_ops_started ON equipamentos_operacoes(started_at DESC)`);
  tabelaPronta = true;
}

class OperationRepository {
  async salvar(result, meta = {}) {
    await garantirTabela();
    const id = result.operationId || meta.id;
    if (!id) return null;
    await run(`
      INSERT INTO equipamentos_operacoes (
        id, operation, status, started_at, finished_at, duration,
        bytes_sent, bytes_received, error, host, porta, data_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        finished_at = excluded.finished_at,
        duration = excluded.duration,
        bytes_sent = excluded.bytes_sent,
        bytes_received = excluded.bytes_received,
        error = excluded.error,
        data_json = excluded.data_json
    `, [
      id,
      result.operation || meta.operation || null,
      result.status || null,
      meta.startedAt || null,
      meta.finishedAt || new Date().toISOString(),
      result.duration || 0,
      result.bytesSent || 0,
      result.bytesReceived || 0,
      result.error || null,
      meta.host || null,
      meta.porta != null ? meta.porta : null,
      result.data != null ? JSON.stringify(result.data) : null
    ]);
    return id;
  }

  async historico({ limite = 50, host, porta } = {}) {
    await garantirTabela();
    const params = [];
    let where = '';
    if (host) {
      where += ' WHERE host = ?';
      params.push(String(host));
      if (porta != null) {
        where += ' AND porta = ?';
        params.push(Number(porta));
      }
    }
    params.push(Math.max(1, Math.min(500, Number(limite) || 50)));
    return all(`
      SELECT * FROM equipamentos_operacoes
      ${where}
      ORDER BY datetime(COALESCE(finished_at, started_at)) DESC
      LIMIT ?
    `, params);
  }
}

module.exports = OperationRepository;
module.exports.OperationRepository = OperationRepository;
module.exports.garantirTabela = garantirTabela;
