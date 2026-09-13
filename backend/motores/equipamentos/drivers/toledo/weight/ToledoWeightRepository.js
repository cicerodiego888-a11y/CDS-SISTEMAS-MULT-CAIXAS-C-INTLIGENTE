/**
 * Sprint 14.9 — ToledoWeightRepository
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

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

let tabelaPronta = false;

async function garantirTabela() {
  if (tabelaPronta) return;
  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_pesagens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipamento_id INTEGER,
      peso REAL,
      unidade TEXT,
      estavel INTEGER DEFAULT 0,
      lido_em DATETIME,
      duracao_ms INTEGER,
      host TEXT,
      porta INTEGER,
      erro TEXT
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_pesagens_lido ON equipamentos_pesagens(lido_em DESC)`);
  tabelaPronta = true;
}

class ToledoWeightRepository {
  async registrar({
    equipamento_id,
    peso,
    unidade,
    estavel,
    duracao_ms,
    host,
    porta,
    erro
  } = {}) {
    await garantirTabela();
    const r = await run(`
      INSERT INTO equipamentos_pesagens (
        equipamento_id, peso, unidade, estavel, lido_em, duracao_ms, host, porta, erro
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
    `, [
      equipamento_id != null ? equipamento_id : null,
      peso != null ? Number(peso) : null,
      unidade || 'kg',
      estavel ? 1 : 0,
      duracao_ms != null ? Number(duracao_ms) : null,
      host || null,
      porta != null ? Number(porta) : null,
      erro || null
    ]);
    return r.lastID;
  }

  async historico({ limite = 50, host, porta, equipamento_id } = {}) {
    await garantirTabela();
    const where = [];
    const params = [];
    if (host) { where.push('host = ?'); params.push(String(host)); }
    if (porta != null) { where.push('porta = ?'); params.push(Number(porta)); }
    if (equipamento_id != null) {
      where.push('equipamento_id = ?');
      params.push(Number(equipamento_id));
    }
    params.push(Math.max(1, Math.min(500, Number(limite) || 50)));
    return all(`
      SELECT * FROM equipamentos_pesagens
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC
      LIMIT ?
    `, params);
  }

  async buscarPorId(id) {
    await garantirTabela();
    return get(`SELECT * FROM equipamentos_pesagens WHERE id = ?`, [id]);
  }
}

module.exports = ToledoWeightRepository;
module.exports.ToledoWeightRepository = ToledoWeightRepository;
module.exports.garantirTabela = garantirTabela;
