/**
 * Sprint 15.8 — Persistência de observabilidade
 * Tabelas: equipamentos_metrics | eventos | alerts | certification
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

let pronto = false;

async function garantirSchema() {
  if (pronto) return;

  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipamento_id INTEGER,
      driver_id TEXT,
      fabricante TEXT,
      protocolo TEXT,
      loja TEXT,
      metrica TEXT NOT NULL,
      valor REAL,
      unidade TEXT,
      tags TEXT,
      registrado_em TEXT NOT NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_metrics_em ON equipamentos_metrics(registrado_em DESC)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_metrics_nome ON equipamentos_metrics(metrica, registrado_em DESC)`);

  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      severidade TEXT,
      equipamento_id INTEGER,
      driver_id TEXT,
      mensagem TEXT,
      payload TEXT,
      registrado_em TEXT NOT NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_events_em ON equipamentos_events(registrado_em DESC)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_events_tipo ON equipamentos_events(tipo, registrado_em DESC)`);

  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL,
      severidade TEXT NOT NULL,
      titulo TEXT,
      mensagem TEXT,
      equipamento_id INTEGER,
      driver_id TEXT,
      ativo INTEGER DEFAULT 1,
      detalhes TEXT,
      aberto_em TEXT NOT NULL,
      resolvido_em TEXT
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_alerts_ativo ON equipamentos_alerts(ativo, aberto_em DESC)`);

  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_certification (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id TEXT NOT NULL,
      driver_versao TEXT,
      firmware TEXT,
      resultado TEXT NOT NULL,
      nota REAL,
      checklist TEXT,
      falhas TEXT,
      relatorio_json TEXT,
      relatorio_md TEXT,
      tempo_ms INTEGER,
      executado_por TEXT,
      observacoes TEXT,
      executado_em TEXT NOT NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_cert_driver ON equipamentos_certification(driver_id, executado_em DESC)`);

  pronto = true;
}

const ObservabilityRepository = {
  garantirSchema,

  async inserirMetrica(row) {
    await garantirSchema();
    const r = await run(`
      INSERT INTO equipamentos_metrics (
        equipamento_id, driver_id, fabricante, protocolo, loja,
        metrica, valor, unidade, tags, registrado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      row.equipamentoId ?? null,
      row.driverId || null,
      row.fabricante || null,
      row.protocolo || null,
      row.loja || null,
      row.metrica,
      row.valor != null ? Number(row.valor) : null,
      row.unidade || null,
      row.tags ? JSON.stringify(row.tags) : null,
      row.registradoEm || new Date().toISOString()
    ]);
    return r.lastID;
  },

  async listarMetricas({ limite = 200, metrica = null, desde = null } = {}) {
    await garantirSchema();
    const params = [];
    let sql = 'SELECT * FROM equipamentos_metrics WHERE 1=1';
    if (metrica) { sql += ' AND metrica = ?'; params.push(metrica); }
    if (desde) { sql += ' AND registrado_em >= ?'; params.push(desde); }
    sql += ' ORDER BY registrado_em DESC LIMIT ?';
    params.push(Math.min(Number(limite) || 200, 2000));
    return all(sql, params);
  },

  async inserirEvento(row) {
    await garantirSchema();
    const r = await run(`
      INSERT INTO equipamentos_events (
        tipo, severidade, equipamento_id, driver_id, mensagem, payload, registrado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      row.tipo,
      row.severidade || 'info',
      row.equipamentoId ?? null,
      row.driverId || null,
      row.mensagem || null,
      row.payload ? JSON.stringify(row.payload) : null,
      row.registradoEm || new Date().toISOString()
    ]);
    return r.lastID;
  },

  async listarEventos({ limite = 100, tipo = null } = {}) {
    await garantirSchema();
    const params = [];
    let sql = 'SELECT * FROM equipamentos_events WHERE 1=1';
    if (tipo) { sql += ' AND tipo = ?'; params.push(tipo); }
    sql += ' ORDER BY registrado_em DESC LIMIT ?';
    params.push(Math.min(Number(limite) || 100, 1000));
    return all(sql, params);
  },

  async upsertAlerta(row) {
    await garantirSchema();
    const existente = await get(`
      SELECT id FROM equipamentos_alerts
      WHERE codigo = ? AND ativo = 1
        AND IFNULL(equipamento_id, -1) = IFNULL(?, -1)
        AND IFNULL(driver_id, '') = IFNULL(?, '')
      ORDER BY id DESC LIMIT 1
    `, [row.codigo, row.equipamentoId ?? null, row.driverId || null]);

    if (existente) {
      await run(`
        UPDATE equipamentos_alerts
        SET mensagem = ?, detalhes = ?, severidade = ?, titulo = ?
        WHERE id = ?
      `, [
        row.mensagem || null,
        row.detalhes ? JSON.stringify(row.detalhes) : null,
        row.severidade || 'warning',
        row.titulo || null,
        existente.id
      ]);
      return existente.id;
    }

    const r = await run(`
      INSERT INTO equipamentos_alerts (
        codigo, severidade, titulo, mensagem, equipamento_id, driver_id,
        ativo, detalhes, aberto_em
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `, [
      row.codigo,
      row.severidade || 'warning',
      row.titulo || row.codigo,
      row.mensagem || null,
      row.equipamentoId ?? null,
      row.driverId || null,
      row.detalhes ? JSON.stringify(row.detalhes) : null,
      row.abertoEm || new Date().toISOString()
    ]);
    return r.lastID;
  },

  async listarAlertas({ ativos = true, limite = 100 } = {}) {
    await garantirSchema();
    const params = [];
    let sql = 'SELECT * FROM equipamentos_alerts WHERE 1=1';
    if (ativos) sql += ' AND ativo = 1';
    sql += ' ORDER BY aberto_em DESC LIMIT ?';
    params.push(Math.min(Number(limite) || 100, 500));
    return all(sql, params);
  },

  async resolverAlerta(id) {
    await garantirSchema();
    await run(`
      UPDATE equipamentos_alerts SET ativo = 0, resolvido_em = ? WHERE id = ?
    `, [new Date().toISOString(), id]);
  },

  async salvarCertificacao(row) {
    await garantirSchema();
    const r = await run(`
      INSERT INTO equipamentos_certification (
        driver_id, driver_versao, firmware, resultado, nota, checklist, falhas,
        relatorio_json, relatorio_md, tempo_ms, executado_por, observacoes, executado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      row.driverId,
      row.driverVersao || null,
      row.firmware || null,
      row.resultado,
      row.nota != null ? Number(row.nota) : null,
      row.checklist ? JSON.stringify(row.checklist) : null,
      row.falhas ? JSON.stringify(row.falhas) : null,
      row.relatorioJson ? JSON.stringify(row.relatorioJson) : null,
      row.relatorioMd || null,
      row.tempoMs != null ? Number(row.tempoMs) : null,
      row.executadoPor || 'sistema',
      row.observacoes || null,
      row.executadoEm || new Date().toISOString()
    ]);
    return r.lastID;
  },

  async ultimaCertificacao(driverId = null) {
    await garantirSchema();
    if (driverId) {
      return get(`
        SELECT * FROM equipamentos_certification
        WHERE driver_id = ?
        ORDER BY executado_em DESC LIMIT 1
      `, [driverId]);
    }
    return get(`
      SELECT * FROM equipamentos_certification
      ORDER BY executado_em DESC LIMIT 1
    `);
  },

  async listarCertificacoes({ limite = 50, driverId = null } = {}) {
    await garantirSchema();
    const params = [];
    let sql = 'SELECT * FROM equipamentos_certification WHERE 1=1';
    if (driverId) { sql += ' AND driver_id = ?'; params.push(driverId); }
    sql += ' ORDER BY executado_em DESC LIMIT ?';
    params.push(Math.min(Number(limite) || 50, 200));
    return all(sql, params);
  }
};

module.exports = ObservabilityRepository;
