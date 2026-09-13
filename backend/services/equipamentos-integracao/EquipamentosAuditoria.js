'use strict';

/**
 * Auditoria da integração corporativa — RC5.0
 */

const db = require('../../database');

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
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function whenReady() {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('Database não disponível'));
    if (typeof db.serialize === 'function') db.serialize(() => resolve());
    else resolve();
  });
}

let pronto = false;

async function garantirSchema() {
  if (pronto) return;
  await whenReady();
  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_integracao_auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      modulo TEXT NOT NULL,
      acao TEXT NOT NULL,
      usuario_id INTEGER,
      usuario_nome TEXT,
      equipamento_id INTEGER,
      resultado TEXT,
      sucesso INTEGER DEFAULT 1,
      tempo_ms INTEGER,
      detalhe TEXT,
      criado_em TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS idx_eq_int_aud_mod
    ON equipamentos_integracao_auditoria(modulo, criado_em)
  `);
  pronto = true;
}

/**
 * @param {Object} registro
 */
async function registrar(registro = {}) {
  await garantirSchema();
  const agora = new Date().toISOString();
  const result = await run(`
    INSERT INTO equipamentos_integracao_auditoria (
      modulo, acao, usuario_id, usuario_nome, equipamento_id,
      resultado, sucesso, tempo_ms, detalhe, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    registro.modulo || 'DESCONHECIDO',
    registro.acao || 'acao',
    registro.usuario_id || null,
    registro.usuario_nome || null,
    registro.equipamento_id || null,
    registro.resultado || null,
    registro.sucesso === false ? 0 : 1,
    registro.tempo_ms != null ? Number(registro.tempo_ms) : null,
    registro.detalhe ? JSON.stringify(registro.detalhe) : null,
    agora
  ]);
  return { id: result.lastID, em: agora };
}

async function listar(filtros = {}) {
  await garantirSchema();
  let sql = 'SELECT * FROM equipamentos_integracao_auditoria WHERE 1=1';
  const params = [];
  if (filtros.modulo) {
    sql += ' AND modulo = ?';
    params.push(String(filtros.modulo).toUpperCase());
  }
  if (filtros.equipamento_id) {
    sql += ' AND equipamento_id = ?';
    params.push(Number(filtros.equipamento_id));
  }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(Math.max(1, Math.min(200, Number(filtros.limite) || 50)));
  const rows = await all(sql, params);
  return rows.map((r) => {
    let detalhe = null;
    try { detalhe = r.detalhe ? JSON.parse(r.detalhe) : null; } catch (_) { detalhe = r.detalhe; }
    return {
      id: r.id,
      modulo: r.modulo,
      acao: r.acao,
      usuario_id: r.usuario_id,
      usuario_nome: r.usuario_nome,
      equipamento_id: r.equipamento_id,
      resultado: r.resultado,
      sucesso: r.sucesso === 1,
      tempo_ms: r.tempo_ms,
      detalhe,
      em: r.criado_em
    };
  });
}

module.exports = {
  garantirSchema,
  registrar,
  listar
};
