/**
 * Sprint 14.1 — DiscoveryRepository
 * Persiste candidatos encontrados em equipamentos_descobertos.
 */

'use strict';

const db = require('../../../database');

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
    CREATE TABLE IF NOT EXISTS equipamentos_descobertos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host TEXT NOT NULL,
      porta INTEGER NOT NULL,
      transporte TEXT DEFAULT 'TCP',
      status TEXT DEFAULT 'ONLINE',
      latencia INTEGER,
      ultima_descoberta DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(host, porta)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_descobertos_host ON equipamentos_descobertos(host)`);
  tabelaPronta = true;
}

class DiscoveryRepository {
  async salvarCandidato(candidato) {
    await garantirTabela();
    const host = String(candidato.host || '');
    const porta = Number(candidato.porta) || 0;
    if (!host || !porta) return null;

    await run(`
      INSERT INTO equipamentos_descobertos (host, porta, transporte, status, latencia, ultima_descoberta)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(host, porta) DO UPDATE SET
        transporte = excluded.transporte,
        status = excluded.status,
        latencia = excluded.latencia,
        ultima_descoberta = CURRENT_TIMESTAMP
    `, [
      host,
      porta,
      candidato.transporte || 'TCP',
      candidato.status || 'ONLINE',
      candidato.latencia != null ? Number(candidato.latencia) : null
    ]);

    return { host, porta };
  }

  async salvarCandidatos(lista = []) {
    const salvos = [];
    for (const c of lista) {
      const row = await this.salvarCandidato(c);
      if (row) salvos.push(row);
    }
    return salvos;
  }

  async listar({ limite = 100 } = {}) {
    await garantirTabela();
    return all(`
      SELECT id, host, porta, transporte, status, latencia, ultima_descoberta
      FROM equipamentos_descobertos
      ORDER BY datetime(ultima_descoberta) DESC
      LIMIT ?
    `, [Math.max(1, Math.min(500, Number(limite) || 100))]);
  }

  async limparAntigos(dias = 30) {
    await garantirTabela();
    return run(`
      DELETE FROM equipamentos_descobertos
      WHERE datetime(ultima_descoberta) < datetime('now', ?)
    `, [`-${Number(dias) || 30} days`]);
  }
}

module.exports = DiscoveryRepository;
module.exports.DiscoveryRepository = DiscoveryRepository;
module.exports.garantirTabela = garantirTabela;
