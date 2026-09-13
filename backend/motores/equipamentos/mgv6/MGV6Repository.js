/**
 * Sprint 14.15.1 — Persistência config + histórico MGV6.
 */

'use strict';

const db = require('../../../database');
const { CHAVE_CONFIG, normalizar, DEFAULTS } = require('./MGV6Configuration');
const { MGV6Error, CODES } = require('./MGV6Errors');

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
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function whenReady() {
  return new Promise((resolve, reject) => {
    if (typeof db.whenReady === 'function') {
      db.whenReady((err) => (err ? reject(err) : resolve()));
      return;
    }
    resolve();
  });
}

let schemaPronto = false;

async function garantirSchema() {
  if (schemaPronto) return;
  await whenReady();
  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_mgv6_exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipamento_id INTEGER,
      arquivo TEXT,
      pasta TEXT,
      quantidade_produtos INTEGER,
      status TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      finalizado_em DATETIME,
      erro TEXT,
      tamanho_bytes INTEGER,
      hash_arquivo TEXT,
      mgv6_iniciado INTEGER DEFAULT 0,
      mgv6_pid INTEGER
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_mgv6_exp_equip ON equipamentos_mgv6_exports(equipamento_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_mgv6_exp_criado ON equipamentos_mgv6_exports(criado_em)`);
  schemaPronto = true;
}

/**
 * @param {number} equipamentoId
 * @returns {Promise<object>}
 */
async function obterConfig(equipamentoId) {
  await garantirSchema();
  const id = Number(equipamentoId);
  if (!Number.isFinite(id) || id <= 0) {
    throw MGV6Error.fromCode(CODES.EQUIPAMENTO_INVALID, 'equipamentoId inválido');
  }
  const row = await get(
    `SELECT valor FROM equipamentos_configuracoes
     WHERE equipamento_id = ? AND chave = ? LIMIT 1`,
    [id, CHAVE_CONFIG]
  );
  if (!row?.valor) {
    return { ...normalizar(DEFAULTS), equipamentoId: id };
  }
  let parsed;
  try {
    parsed = typeof row.valor === 'object' ? row.valor : JSON.parse(String(row.valor));
  } catch (_) {
    parsed = {};
  }
  return { ...normalizar(parsed), equipamentoId: id };
}

/**
 * @param {number} equipamentoId
 * @param {object} configBruta
 * @returns {Promise<object>}
 */
async function salvarConfig(equipamentoId, configBruta) {
  await garantirSchema();
  const id = Number(equipamentoId);
  if (!Number.isFinite(id) || id <= 0) {
    throw MGV6Error.fromCode(CODES.EQUIPAMENTO_INVALID, 'equipamentoId inválido');
  }
  const eq = await get(`SELECT id FROM equipamentos WHERE id = ? LIMIT 1`, [id]);
  if (!eq) {
    throw MGV6Error.fromCode(CODES.EQUIPAMENTO_INVALID, 'Equipamento não encontrado', { statusCode: 404 });
  }

  const cfg = normalizar(configBruta);
  // nunca persistir campos sensíveis extras
  const payload = {
    enabled: cfg.enabled,
    exportFolder: cfg.exportFolder,
    mgv6Executable: cfg.mgv6Executable,
    fileName: cfg.fileName,
    encoding: cfg.encoding,
    lineEnding: cfg.lineEnding,
    autoLaunch: cfg.autoLaunch,
    modoVariavel: cfg.modoVariavel,
    digitosPlu: cfg.digitosPlu,
    prefixoEtiqueta: cfg.prefixoEtiqueta,
    diferenciarPesoUnidade: cfg.diferenciarPesoUnidade,
    tipoRegistro: cfg.tipoRegistro,
    descricaoMaxLength: cfg.descricaoMaxLength
  };
  const valorStr = JSON.stringify(payload);
  const existente = await get(
    `SELECT id FROM equipamentos_configuracoes
     WHERE equipamento_id = ? AND chave = ? LIMIT 1`,
    [id, CHAVE_CONFIG]
  );
  if (existente?.id) {
    await run(
      `UPDATE equipamentos_configuracoes
       SET valor = ?, descricao = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [valorStr, 'Compatibilidade MGV6 (exportação legada)', existente.id]
    );
  } else {
    await run(
      `INSERT INTO equipamentos_configuracoes (equipamento_id, chave, valor, descricao)
       VALUES (?, ?, ?, ?)`,
      [id, CHAVE_CONFIG, valorStr, 'Compatibilidade MGV6 (exportação legada)']
    );
  }
  return { ...cfg, equipamentoId: id };
}

/**
 * @param {object} entrada
 * @returns {Promise<number>}
 */
async function registrarExport(entrada = {}) {
  await garantirSchema();
  const r = await run(
    `INSERT INTO equipamentos_mgv6_exports (
      equipamento_id, arquivo, pasta, quantidade_produtos, status,
      criado_em, finalizado_em, erro, tamanho_bytes, hash_arquivo,
      mgv6_iniciado, mgv6_pid
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?)`,
    [
      entrada.equipamento_id != null ? Number(entrada.equipamento_id) : null,
      entrada.arquivo != null ? String(entrada.arquivo) : null,
      entrada.pasta != null ? String(entrada.pasta) : null,
      entrada.quantidade_produtos != null ? Number(entrada.quantidade_produtos) : 0,
      entrada.status != null ? String(entrada.status) : 'EXPORTADO',
      entrada.finalizado_em != null ? String(entrada.finalizado_em) : new Date().toISOString(),
      entrada.erro != null ? String(entrada.erro) : null,
      entrada.tamanho_bytes != null ? Number(entrada.tamanho_bytes) : null,
      entrada.hash_arquivo != null ? String(entrada.hash_arquivo) : null,
      entrada.mgv6_iniciado ? 1 : 0,
      entrada.mgv6_pid != null ? Number(entrada.mgv6_pid) : null
    ]
  );
  return r.lastID;
}

/**
 * @param {object} filtros
 * @returns {Promise<object[]>}
 */
async function listarHistorico(filtros = {}) {
  await garantirSchema();
  const limite = Math.min(500, Math.max(1, Number(filtros.limite) || 50));
  const params = [];
  let where = '1=1';
  if (filtros.equipamentoId != null && Number(filtros.equipamentoId) > 0) {
    where += ' AND equipamento_id = ?';
    params.push(Number(filtros.equipamentoId));
  }
  params.push(limite);
  return all(
    `SELECT * FROM equipamentos_mgv6_exports
     WHERE ${where}
     ORDER BY id DESC
     LIMIT ?`,
    params
  );
}

module.exports = {
  CHAVE_CONFIG,
  garantirSchema,
  obterConfig,
  salvarConfig,
  registrarExport,
  listarHistorico
};
