'use strict';

/**
 * Persistência do Motor de Identidade (MIE) — RC2.1
 */

const db = require('../../../database');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
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
    CREATE TABLE IF NOT EXISTS equipamentos_identidades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chave TEXT UNIQUE NOT NULL,
      nivel_chave TEXT,
      serial_number TEXT,
      mac TEXT,
      modelo TEXT,
      firmware TEXT,
      vid TEXT,
      pid TEXT,
      driver_codigo TEXT,
      assinatura_ref TEXT,
      transporte TEXT,
      ip_atual TEXT,
      ip_anterior TEXT,
      porta_atual INTEGER,
      porta_com_atual TEXT,
      caminho_dispositivo TEXT,
      vezes_visto INTEGER DEFAULT 1,
      primeira_vez_em TEXT,
      ultimo_visto_em TEXT,
      ultima_mudanca_ip_em TEXT,
      ultima_sessao_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_identidades_historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identidade_id INTEGER NOT NULL,
      evento TEXT NOT NULL,
      de_valor TEXT,
      para_valor TEXT,
      sessao_id INTEGER,
      score REAL,
      snapshot TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (identidade_id) REFERENCES equipamentos_identidades(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_identidades_sessoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identidade_id INTEGER NOT NULL,
      sessao_id INTEGER,
      score REAL,
      status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (identidade_id) REFERENCES equipamentos_identidades(id)
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_mie_chave ON equipamentos_identidades(chave)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_mie_serial ON equipamentos_identidades(serial_number)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_mie_mac ON equipamentos_identidades(mac)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_mie_vid_pid ON equipamentos_identidades(vid, pid)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_mie_assinatura ON equipamentos_identidades(assinatura_ref)`);

  pronto = true;
}

function mapRow(row) {
  if (!row) return null;
  return { ...row };
}

async function buscarPorChave(chave) {
  await garantirSchema();
  return mapRow(await get('SELECT * FROM equipamentos_identidades WHERE chave = ?', [chave]));
}

async function buscarPorId(id) {
  await garantirSchema();
  return mapRow(await get('SELECT * FROM equipamentos_identidades WHERE id = ?', [id]));
}

async function listarCandidatosMatch(sinais = {}) {
  await garantirSchema();
  const clauses = [];
  const params = [];

  if (sinais.serial_number) {
    clauses.push('serial_number = ?');
    params.push(String(sinais.serial_number));
  }
  if (sinais.mac) {
    clauses.push('mac = ?');
    params.push(String(sinais.mac));
  }
  if (sinais.modelo && sinais.firmware) {
    clauses.push('(modelo = ? AND firmware = ?)');
    params.push(String(sinais.modelo), String(sinais.firmware));
  }
  if (sinais.vid && sinais.pid) {
    clauses.push('(vid = ? AND pid = ?)');
    params.push(String(sinais.vid), String(sinais.pid));
  }
  if (sinais.assinatura) {
    clauses.push('assinatura_ref = ?');
    params.push(String(sinais.assinatura));
  }
  // driver_codigo sozinho é amplo demais — só combina com transporte + endpoint fraco via assinatura/chave

  if (!clauses.length) {
    return [];
  }

  return all(
    `SELECT * FROM equipamentos_identidades WHERE ${clauses.join(' OR ')} ORDER BY ultimo_visto_em DESC LIMIT 50`,
    params
  );
}

async function criar(dados) {
  await garantirSchema();
  const agora = new Date().toISOString();
  const info = await run(
    `INSERT INTO equipamentos_identidades (
      chave, nivel_chave, serial_number, mac, modelo, firmware, vid, pid,
      driver_codigo, assinatura_ref, transporte, ip_atual, ip_anterior,
      porta_atual, porta_com_atual, caminho_dispositivo, vezes_visto,
      primeira_vez_em, ultimo_visto_em, ultima_sessao_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    [
      dados.chave,
      dados.nivel_chave || null,
      dados.serial_number || null,
      dados.mac || null,
      dados.modelo || null,
      dados.firmware || null,
      dados.vid || null,
      dados.pid || null,
      dados.driver_codigo || null,
      dados.assinatura_ref || null,
      dados.transporte || null,
      dados.ip_atual || null,
      null,
      dados.porta_atual != null ? dados.porta_atual : null,
      dados.porta_com_atual || null,
      dados.caminho_dispositivo || null,
      agora,
      agora,
      dados.ultima_sessao_id || null,
      agora,
      agora
    ]
  );
  return buscarPorId(info.lastID);
}

async function atualizar(id, dados) {
  await garantirSchema();
  const atual = await buscarPorId(id);
  if (!atual) return null;
  const agora = new Date().toISOString();

  await run(
    `UPDATE equipamentos_identidades SET
      serial_number = ?, mac = ?, modelo = ?, firmware = ?, vid = ?, pid = ?,
      driver_codigo = ?, assinatura_ref = ?, transporte = ?,
      ip_atual = ?, ip_anterior = ?, porta_atual = ?, porta_com_atual = ?,
      caminho_dispositivo = ?, vezes_visto = ?, ultimo_visto_em = ?,
      ultima_mudanca_ip_em = ?, ultima_sessao_id = ?, updated_at = ?
     WHERE id = ?`,
    [
      dados.serial_number !== undefined ? dados.serial_number : atual.serial_number,
      dados.mac !== undefined ? dados.mac : atual.mac,
      dados.modelo !== undefined ? dados.modelo : atual.modelo,
      dados.firmware !== undefined ? dados.firmware : atual.firmware,
      dados.vid !== undefined ? dados.vid : atual.vid,
      dados.pid !== undefined ? dados.pid : atual.pid,
      dados.driver_codigo !== undefined ? dados.driver_codigo : atual.driver_codigo,
      dados.assinatura_ref !== undefined ? dados.assinatura_ref : atual.assinatura_ref,
      dados.transporte !== undefined ? dados.transporte : atual.transporte,
      dados.ip_atual !== undefined ? dados.ip_atual : atual.ip_atual,
      dados.ip_anterior !== undefined ? dados.ip_anterior : atual.ip_anterior,
      dados.porta_atual !== undefined ? dados.porta_atual : atual.porta_atual,
      dados.porta_com_atual !== undefined ? dados.porta_com_atual : atual.porta_com_atual,
      dados.caminho_dispositivo !== undefined ? dados.caminho_dispositivo : atual.caminho_dispositivo,
      dados.vezes_visto !== undefined ? dados.vezes_visto : atual.vezes_visto,
      dados.ultimo_visto_em || agora,
      dados.ultima_mudanca_ip_em !== undefined ? dados.ultima_mudanca_ip_em : atual.ultima_mudanca_ip_em,
      dados.ultima_sessao_id !== undefined ? dados.ultima_sessao_id : atual.ultima_sessao_id,
      agora,
      id
    ]
  );
  return buscarPorId(id);
}

async function registrarHistorico({ identidade_id, evento, de_valor, para_valor, sessao_id, score, snapshot }) {
  await garantirSchema();
  const info = await run(
    `INSERT INTO equipamentos_identidades_historico (
      identidade_id, evento, de_valor, para_valor, sessao_id, score, snapshot
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      identidade_id,
      evento,
      de_valor != null ? String(de_valor) : null,
      para_valor != null ? String(para_valor) : null,
      sessao_id || null,
      score != null ? Number(score) : null,
      snapshot ? JSON.stringify(snapshot) : null
    ]
  );
  return { id: info.lastID };
}

async function vincularSessao({ identidade_id, sessao_id, score, status }) {
  await garantirSchema();
  if (!sessao_id) return null;
  const info = await run(
    `INSERT INTO equipamentos_identidades_sessoes (identidade_id, sessao_id, score, status)
     VALUES (?, ?, ?, ?)`,
    [identidade_id, sessao_id, score != null ? Number(score) : null, status || null]
  );
  return { id: info.lastID };
}

async function listar(limite = 50) {
  await garantirSchema();
  const rows = await all(
    `SELECT * FROM equipamentos_identidades ORDER BY ultimo_visto_em DESC LIMIT ?`,
    [Math.max(1, Math.min(200, Number(limite) || 50))]
  );
  return rows.map(mapRow);
}

async function listarHistorico(identidadeId, limite = 50) {
  await garantirSchema();
  return all(
    `SELECT * FROM equipamentos_identidades_historico
     WHERE identidade_id = ?
     ORDER BY id DESC LIMIT ?`,
    [identidadeId, Math.max(1, Math.min(200, Number(limite) || 50))]
  );
}

async function listarSessoesDaIdentidade(identidadeId, limite = 50) {
  await garantirSchema();
  return all(
    `SELECT * FROM equipamentos_identidades_sessoes
     WHERE identidade_id = ?
     ORDER BY id DESC LIMIT ?`,
    [identidadeId, Math.max(1, Math.min(200, Number(limite) || 50))]
  );
}

module.exports = {
  garantirSchema,
  buscarPorChave,
  buscarPorId,
  listarCandidatosMatch,
  criar,
  atualizar,
  registrarHistorico,
  vincularSessao,
  listar,
  listarHistorico,
  listarSessoesDaIdentidade
};
