/**
 * Sprint 14.2 — FingerprintRepository
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

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

let tabelaPronta = false;

async function garantirTabela() {
  if (tabelaPronta) return;
  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_identificados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host TEXT NOT NULL,
      porta INTEGER NOT NULL,
      protocolo TEXT,
      fabricante TEXT,
      modelo TEXT,
      driver TEXT,
      confidence INTEGER DEFAULT 0,
      fingerprint TEXT,
      ultima_identificacao DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(host, porta)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_ident_host ON equipamentos_identificados(host)`);
  tabelaPronta = true;
}

class FingerprintRepository {
  async salvar(candidato) {
    await garantirTabela();
    const host = String(candidato.host || '');
    const porta = Number(candidato.porta) || 0;
    if (!host || !porta) return null;

    await run(`
      INSERT INTO equipamentos_identificados (
        host, porta, protocolo, fabricante, modelo, driver, confidence, fingerprint, ultima_identificacao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(host, porta) DO UPDATE SET
        protocolo = excluded.protocolo,
        fabricante = excluded.fabricante,
        modelo = excluded.modelo,
        driver = excluded.driver,
        confidence = excluded.confidence,
        fingerprint = excluded.fingerprint,
        ultima_identificacao = CURRENT_TIMESTAMP
    `, [
      host,
      porta,
      candidato.protocolo || null,
      candidato.fabricante || null,
      candidato.modelo || null,
      candidato.driver || null,
      Number(candidato.confidence) || 0,
      candidato.fingerprint || null
    ]);
    return { host, porta };
  }

  async buscarPorHostPorta(host, porta) {
    await garantirTabela();
    return get(`
      SELECT * FROM equipamentos_identificados
      WHERE host = ? AND porta = ?
      LIMIT 1
    `, [String(host), Number(porta)]);
  }

  async listar({ limite = 100 } = {}) {
    await garantirTabela();
    return all(`
      SELECT * FROM equipamentos_identificados
      ORDER BY datetime(ultima_identificacao) DESC
      LIMIT ?
    `, [Math.max(1, Math.min(500, Number(limite) || 100))]);
  }
}

module.exports = FingerprintRepository;
module.exports.FingerprintRepository = FingerprintRepository;
module.exports.garantirTabela = garantirTabela;
