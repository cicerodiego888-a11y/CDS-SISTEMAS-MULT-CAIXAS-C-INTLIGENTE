/**
 * Sprint 14.7 — ToledoPluRepository
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
    CREATE TABLE IF NOT EXISTS equipamentos_plu_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER,
      plu TEXT,
      status TEXT,
      enviado_em DATETIME,
      confirmado_em DATETIME,
      tentativas INTEGER DEFAULT 0,
      erro TEXT,
      host TEXT,
      porta INTEGER
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_plu_sync_plu ON equipamentos_plu_sync(plu)`);
  tabelaPronta = true;
}

class ToledoPluRepository {
  async registrarInicio({ produto_id, plu, host, porta }) {
    await garantirTabela();
    const r = await run(`
      INSERT INTO equipamentos_plu_sync (
        produto_id, plu, status, enviado_em, tentativas, host, porta
      ) VALUES (?, ?, 'ENVIANDO', CURRENT_TIMESTAMP, 1, ?, ?)
    `, [
      produto_id != null ? produto_id : null,
      String(plu),
      host || null,
      porta != null ? Number(porta) : null
    ]);
    return r.lastID;
  }

  async confirmar(id) {
    await garantirTabela();
    await run(`
      UPDATE equipamentos_plu_sync
      SET status = 'CONFIRMADO', confirmado_em = CURRENT_TIMESTAMP, erro = NULL
      WHERE id = ?
    `, [id]);
  }

  async falhar(id, erro) {
    await garantirTabela();
    await run(`
      UPDATE equipamentos_plu_sync
      SET status = 'ERRO', erro = ?
      WHERE id = ?
    `, [String(erro || 'ERRO'), id]);
  }

  async incrementarTentativa(id) {
    await garantirTabela();
    await run(`
      UPDATE equipamentos_plu_sync
      SET tentativas = tentativas + 1, status = 'ENVIANDO', enviado_em = CURRENT_TIMESTAMP, erro = NULL
      WHERE id = ?
    `, [id]);
  }

  async historico({ limite = 50, host, porta, plu, produto_id } = {}) {
    await garantirTabela();
    const params = [];
    const where = [];
    if (host) { where.push('host = ?'); params.push(String(host)); }
    if (porta != null) { where.push('porta = ?'); params.push(Number(porta)); }
    if (plu) { where.push('plu = ?'); params.push(String(plu)); }
    if (produto_id != null) { where.push('produto_id = ?'); params.push(Number(produto_id)); }
    params.push(Math.max(1, Math.min(500, Number(limite) || 50)));
    const sql = `
      SELECT * FROM equipamentos_plu_sync
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC
      LIMIT ?
    `;
    return all(sql, params);
  }

  /** RC15.3 — última sincronização confirmada do produto. */
  async ultimaConfirmada(produtoId) {
    await garantirTabela();
    if (produtoId == null) return null;
    return get(`
      SELECT * FROM equipamentos_plu_sync
      WHERE produto_id = ? AND status = 'CONFIRMADO'
      ORDER BY id DESC
      LIMIT 1
    `, [Number(produtoId)]);
  }

  async buscarPorId(id) {
    await garantirTabela();
    return get(`SELECT * FROM equipamentos_plu_sync WHERE id = ?`, [id]);
  }
}

module.exports = ToledoPluRepository;
module.exports.ToledoPluRepository = ToledoPluRepository;
module.exports.garantirTabela = garantirTabela;
