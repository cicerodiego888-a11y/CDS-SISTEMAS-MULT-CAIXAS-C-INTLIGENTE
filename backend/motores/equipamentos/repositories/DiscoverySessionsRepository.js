'use strict';

/**
 * Persistência opcional de sessões de Discovery (RC2).
 * Não altera cadastro de equipamentos.
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
    if (typeof db.serialize === 'function') {
      db.serialize(() => resolve());
    } else {
      resolve();
    }
  });
}

let tabelaPronta = false;

async function garantirTabela() {
  if (tabelaPronta) return;
  await whenReady();
  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_discovery_sessoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iniciado_em TEXT,
      finalizado_em TEXT,
      duracao_ms INTEGER DEFAULT 0,
      transportes TEXT,
      probes_total INTEGER DEFAULT 0,
      probes_ok INTEGER DEFAULT 0,
      candidatos_total INTEGER DEFAULT 0,
      assinaturas TEXT,
      payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  tabelaPronta = true;
}

/**
 * @param {Object} resultado DiscoveryResult
 * @returns {Promise<Object>}
 */
async function salvarSessao(resultado = {}) {
  await garantirTabela();
  const meta = resultado.meta || {};
  const candidatos = Array.isArray(resultado.candidatos) ? resultado.candidatos : [];
  const assinaturas = candidatos.map((c) => c.assinatura).filter(Boolean);
  const transportes = Array.isArray(meta.transportes_executados)
    ? meta.transportes_executados
    : [];

  const payload = JSON.stringify({
    sucesso: resultado.sucesso,
    erros: resultado.erros || [],
    meta,
    candidatos: candidatos.map((c) => ({
      assinatura: c.assinatura,
      transporte: c.transporte,
      driver_codigo: c.driver_codigo,
      confianca: c.confianca,
      ip: c.ip,
      porta: c.porta,
      porta_com: c.porta_com,
      vid: c.vid,
      pid: c.pid,
      caminho_dispositivo: c.caminho_dispositivo
    }))
  });

  const info = await run(
    `INSERT INTO equipamentos_discovery_sessoes (
      iniciado_em, finalizado_em, duracao_ms, transportes,
      probes_total, probes_ok, candidatos_total, assinaturas, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      meta.iniciado_em || null,
      meta.finalizado_em || null,
      Number(meta.duracao_ms || 0),
      JSON.stringify(transportes),
      Number(meta.probes_total || 0),
      Number(meta.probes_ok || 0),
      candidatos.length,
      JSON.stringify(assinaturas),
      payload
    ]
  );

  return { id: info?.lastID || null };
}

async function listarSessoes(limite = 20) {
  await garantirTabela();
  const rows = await all(
    `SELECT id, iniciado_em, finalizado_em, duracao_ms, transportes,
            probes_total, probes_ok, candidatos_total, assinaturas, created_at
     FROM equipamentos_discovery_sessoes
     ORDER BY id DESC
     LIMIT ?`,
    [Math.max(1, Math.min(100, Number(limite) || 20))]
  );
  return (rows || []).map((r) => ({
    ...r,
    transportes: safeJson(r.transportes, []),
    assinaturas: safeJson(r.assinaturas, [])
  }));
}

async function buscarSessao(id) {
  await garantirTabela();
  const row = await get(
    `SELECT * FROM equipamentos_discovery_sessoes WHERE id = ?`,
    [id]
  );
  if (!row) return null;
  return {
    ...row,
    transportes: safeJson(row.transportes, []),
    assinaturas: safeJson(row.assinaturas, []),
    payload: safeJson(row.payload, null)
  };
}

function safeJson(texto, fallback) {
  try {
    return JSON.parse(texto || 'null') ?? fallback;
  } catch (_) {
    return fallback;
  }
}

module.exports = {
  garantirTabela,
  salvarSessao,
  listarSessoes,
  buscarSessao
};
