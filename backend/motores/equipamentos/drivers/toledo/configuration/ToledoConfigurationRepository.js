/**
 * Sprint 14.11 — ToledoConfigurationRepository
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

async function garantirTabelas() {
  if (tabelaPronta) return;
  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_config_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipamento_id INTEGER,
      nome TEXT,
      firmware TEXT,
      modelo TEXT,
      parametros_json TEXT,
      criado_em DATETIME,
      usuario TEXT,
      host TEXT,
      porta INTEGER
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_config_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER,
      parametro TEXT,
      valor_anterior TEXT,
      valor_novo TEXT,
      alterado_em DATETIME,
      host TEXT,
      porta INTEGER,
      usuario TEXT
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_cfg_prof ON equipamentos_config_profiles(equipamento_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_cfg_hist ON equipamentos_config_history(profile_id)`);
  tabelaPronta = true;
}

class ToledoConfigurationRepository {
  async salvarPerfil({
    equipamento_id,
    nome,
    firmware,
    modelo,
    parametros,
    usuario,
    host,
    porta
  } = {}) {
    await garantirTabelas();
    const r = await run(`
      INSERT INTO equipamentos_config_profiles (
        equipamento_id, nome, firmware, modelo, parametros_json, criado_em, usuario, host, porta
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
    `, [
      equipamento_id != null ? equipamento_id : null,
      nome || 'Perfil',
      firmware || null,
      modelo || null,
      JSON.stringify(parametros || {}),
      usuario || null,
      host || null,
      porta != null ? Number(porta) : null
    ]);
    return r.lastID;
  }

  async buscarPerfil(id) {
    await garantirTabelas();
    const row = await get(`SELECT * FROM equipamentos_config_profiles WHERE id = ?`, [id]);
    if (!row) return null;
    let parametros = {};
    try { parametros = JSON.parse(row.parametros_json || '{}'); } catch (_) { /* ignore */ }
    return { ...row, parametros };
  }

  async listarPerfis({ limite = 50, equipamento_id, host } = {}) {
    await garantirTabelas();
    const where = [];
    const params = [];
    if (equipamento_id != null) {
      where.push('equipamento_id = ?');
      params.push(Number(equipamento_id));
    }
    if (host) { where.push('host = ?'); params.push(String(host)); }
    params.push(Math.max(1, Math.min(200, Number(limite) || 50)));
    const rows = await all(`
      SELECT * FROM equipamentos_config_profiles
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC
      LIMIT ?
    `, params);
    return rows.map((row) => {
      let parametros = {};
      try { parametros = JSON.parse(row.parametros_json || '{}'); } catch (_) { /* ignore */ }
      return { ...row, parametros };
    });
  }

  async registrarHistorico({
    profile_id,
    parametro,
    valor_anterior,
    valor_novo,
    host,
    porta,
    usuario
  } = {}) {
    await garantirTabelas();
    const r = await run(`
      INSERT INTO equipamentos_config_history (
        profile_id, parametro, valor_anterior, valor_novo, alterado_em, host, porta, usuario
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
    `, [
      profile_id != null ? profile_id : null,
      parametro || null,
      valor_anterior != null ? String(valor_anterior) : null,
      valor_novo != null ? String(valor_novo) : null,
      host || null,
      porta != null ? Number(porta) : null,
      usuario || null
    ]);
    return r.lastID;
  }

  async historico({ limite = 50, profile_id, host, porta } = {}) {
    await garantirTabelas();
    const where = [];
    const params = [];
    if (profile_id != null) {
      where.push('profile_id = ?');
      params.push(Number(profile_id));
    }
    if (host) { where.push('host = ?'); params.push(String(host)); }
    if (porta != null) { where.push('porta = ?'); params.push(Number(porta)); }
    params.push(Math.max(1, Math.min(500, Number(limite) || 50)));
    return all(`
      SELECT * FROM equipamentos_config_history
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC
      LIMIT ?
    `, params);
  }
}

module.exports = ToledoConfigurationRepository;
module.exports.ToledoConfigurationRepository = ToledoConfigurationRepository;
module.exports.garantirTabelas = garantirTabelas;
