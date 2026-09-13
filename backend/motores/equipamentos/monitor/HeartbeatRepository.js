'use strict';

/**
 * Persistência Heartbeat — RC3.1
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
    CREATE TABLE IF NOT EXISTS equipamentos_heartbeat (
      equipamento_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'SEM_COMUNICACAO',
      latencia_ms INTEGER,
      falhas_consecutivas INTEGER DEFAULT 0,
      total_sucessos INTEGER DEFAULT 0,
      total_falhas INTEGER DEFAULT 0,
      historico_recente TEXT,
      ultima_comunicacao TEXT,
      online_desde TEXT,
      offline_desde TEXT,
      tempo_online_ms INTEGER DEFAULT 0,
      tempo_offline_ms INTEGER DEFAULT 0,
      intervalo_ms INTEGER,
      timeout_ms INTEGER,
      tipo_teste TEXT,
      proxima_verificacao TEXT,
      backoff_ate TEXT,
      ultimo_ip TEXT,
      ultimo_firmware TEXT,
      ultima_porta TEXT,
      mudancas_24h INTEGER DEFAULT 0,
      health_score INTEGER DEFAULT 0,
      health_rotulo TEXT,
      atualizado_em TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_heartbeat_eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipamento_id INTEGER NOT NULL,
      evento TEXT NOT NULL,
      payload TEXT,
      criado_em TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_hb_eventos_eq
    ON equipamentos_heartbeat_eventos(equipamento_id, criado_em)
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_heartbeat_fila (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipamento_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente',
      agendado_para TEXT NOT NULL,
      tentativas INTEGER DEFAULT 0,
      erro_mensagem TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_hb_fila_status_agendado
    ON equipamentos_heartbeat_fila(status, agendado_para)
  `);

  pronto = true;
}

function mapRow(row) {
  if (!row) return null;
  let historico = [];
  try {
    historico = row.historico_recente ? JSON.parse(row.historico_recente) : [];
  } catch (_) {
    historico = [];
  }
  return {
    equipamento_id: row.equipamento_id,
    status: row.status,
    latencia_ms: row.latencia_ms,
    falhas_consecutivas: row.falhas_consecutivas || 0,
    total_sucessos: row.total_sucessos || 0,
    total_falhas: row.total_falhas || 0,
    historico_recente: historico,
    ultima_comunicacao: row.ultima_comunicacao,
    online_desde: row.online_desde,
    offline_desde: row.offline_desde,
    tempo_online_ms: row.tempo_online_ms || 0,
    tempo_offline_ms: row.tempo_offline_ms || 0,
    intervalo_ms: row.intervalo_ms,
    timeout_ms: row.timeout_ms,
    tipo_teste: row.tipo_teste,
    proxima_verificacao: row.proxima_verificacao,
    backoff_ate: row.backoff_ate,
    ultimo_ip: row.ultimo_ip,
    ultimo_firmware: row.ultimo_firmware,
    ultima_porta: row.ultima_porta,
    mudancas_24h: row.mudancas_24h || 0,
    health_score: row.health_score || 0,
    health_rotulo: row.health_rotulo,
    atualizado_em: row.atualizado_em
  };
}

async function buscarPorEquipamento(equipamentoId) {
  await garantirSchema();
  const row = await get(
    'SELECT * FROM equipamentos_heartbeat WHERE equipamento_id = ?',
    [equipamentoId]
  );
  return mapRow(row);
}

async function listarTodos() {
  await garantirSchema();
  const rows = await all('SELECT * FROM equipamentos_heartbeat ORDER BY equipamento_id');
  return rows.map(mapRow);
}

async function upsertEstado(equipamentoId, dados = {}) {
  await garantirSchema();
  const agora = new Date().toISOString();
  const existente = await buscarPorEquipamento(equipamentoId);
  const histJson = JSON.stringify(dados.historico_recente || existente?.historico_recente || []);

  if (!existente) {
    await run(`
      INSERT INTO equipamentos_heartbeat (
        equipamento_id, status, latencia_ms, falhas_consecutivas, total_sucessos, total_falhas,
        historico_recente, ultima_comunicacao, online_desde, offline_desde,
        tempo_online_ms, tempo_offline_ms, intervalo_ms, timeout_ms, tipo_teste,
        proxima_verificacao, backoff_ate, ultimo_ip, ultimo_firmware, ultima_porta,
        mudancas_24h, health_score, health_rotulo, atualizado_em, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      equipamentoId,
      dados.status || 'SEM_COMUNICACAO',
      dados.latencia_ms ?? null,
      dados.falhas_consecutivas ?? 0,
      dados.total_sucessos ?? 0,
      dados.total_falhas ?? 0,
      histJson,
      dados.ultima_comunicacao || null,
      dados.online_desde || null,
      dados.offline_desde || null,
      dados.tempo_online_ms ?? 0,
      dados.tempo_offline_ms ?? 0,
      dados.intervalo_ms ?? null,
      dados.timeout_ms ?? null,
      dados.tipo_teste || null,
      dados.proxima_verificacao || null,
      dados.backoff_ate || null,
      dados.ultimo_ip || null,
      dados.ultimo_firmware || null,
      dados.ultima_porta || null,
      dados.mudancas_24h ?? 0,
      dados.health_score ?? 0,
      dados.health_rotulo || null,
      agora
    ]);
  } else {
    await run(`
      UPDATE equipamentos_heartbeat SET
        status = COALESCE(?, status),
        latencia_ms = COALESCE(?, latencia_ms),
        falhas_consecutivas = COALESCE(?, falhas_consecutivas),
        total_sucessos = COALESCE(?, total_sucessos),
        total_falhas = COALESCE(?, total_falhas),
        historico_recente = ?,
        ultima_comunicacao = COALESCE(?, ultima_comunicacao),
        online_desde = ?,
        offline_desde = ?,
        tempo_online_ms = COALESCE(?, tempo_online_ms),
        tempo_offline_ms = COALESCE(?, tempo_offline_ms),
        intervalo_ms = COALESCE(?, intervalo_ms),
        timeout_ms = COALESCE(?, timeout_ms),
        tipo_teste = COALESCE(?, tipo_teste),
        proxima_verificacao = COALESCE(?, proxima_verificacao),
        backoff_ate = ?,
        ultimo_ip = COALESCE(?, ultimo_ip),
        ultimo_firmware = COALESCE(?, ultimo_firmware),
        ultima_porta = COALESCE(?, ultima_porta),
        mudancas_24h = COALESCE(?, mudancas_24h),
        health_score = COALESCE(?, health_score),
        health_rotulo = COALESCE(?, health_rotulo),
        atualizado_em = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE equipamento_id = ?
    `, [
      dados.status ?? null,
      dados.latencia_ms !== undefined ? dados.latencia_ms : null,
      dados.falhas_consecutivas !== undefined ? dados.falhas_consecutivas : null,
      dados.total_sucessos !== undefined ? dados.total_sucessos : null,
      dados.total_falhas !== undefined ? dados.total_falhas : null,
      histJson,
      dados.ultima_comunicacao ?? null,
      dados.online_desde !== undefined ? dados.online_desde : existente.online_desde,
      dados.offline_desde !== undefined ? dados.offline_desde : existente.offline_desde,
      dados.tempo_online_ms !== undefined ? dados.tempo_online_ms : null,
      dados.tempo_offline_ms !== undefined ? dados.tempo_offline_ms : null,
      dados.intervalo_ms ?? null,
      dados.timeout_ms ?? null,
      dados.tipo_teste ?? null,
      dados.proxima_verificacao ?? null,
      dados.backoff_ate !== undefined ? dados.backoff_ate : existente.backoff_ate,
      dados.ultimo_ip ?? null,
      dados.ultimo_firmware ?? null,
      dados.ultima_porta ?? null,
      dados.mudancas_24h !== undefined ? dados.mudancas_24h : null,
      dados.health_score !== undefined ? dados.health_score : null,
      dados.health_rotulo ?? null,
      agora,
      equipamentoId
    ]);
  }

  return buscarPorEquipamento(equipamentoId);
}

async function registrarEvento(equipamentoId, evento, payload = {}) {
  await garantirSchema();
  const agora = new Date().toISOString();
  const result = await run(`
    INSERT INTO equipamentos_heartbeat_eventos (equipamento_id, evento, payload, criado_em)
    VALUES (?, ?, ?, ?)
  `, [equipamentoId, evento, JSON.stringify(payload || {}), agora]);
  return { id: result.lastID, equipamento_id: equipamentoId, evento, payload, em: agora };
}

async function listarEventos(equipamentoId, limite = 50) {
  await garantirSchema();
  const rows = await all(`
    SELECT * FROM equipamentos_heartbeat_eventos
    WHERE equipamento_id = ?
    ORDER BY id DESC
    LIMIT ?
  `, [equipamentoId, Math.max(1, Math.min(200, Number(limite) || 50))]);
  return rows.map((r) => {
    let payload = {};
    try { payload = r.payload ? JSON.parse(r.payload) : {}; } catch (_) { payload = {}; }
    return {
      id: r.id,
      equipamento_id: r.equipamento_id,
      evento: r.evento,
      payload,
      em: r.criado_em
    };
  });
}

async function contarMudancasRecentes(equipamentoId, horas = 24) {
  await garantirSchema();
  const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();
  const row = await get(`
    SELECT COUNT(*) AS n FROM equipamentos_heartbeat_eventos
    WHERE equipamento_id = ?
      AND criado_em >= ?
      AND evento IN ('MUDOU_IP','MUDOU_FIRMWARE','MUDOU_PORTA','STATUS_ALTERADO','EQUIPAMENTO_CAIU','EQUIPAMENTO_VOLTOU')
  `, [equipamentoId, desde]);
  return Number(row?.n || 0);
}

async function enfileirar(equipamentoId, agendadoParaIso) {
  await garantirSchema();
  const pendente = await get(`
    SELECT id FROM equipamentos_heartbeat_fila
    WHERE equipamento_id = ? AND status = 'pendente'
    LIMIT 1
  `, [equipamentoId]);
  if (pendente) {
    await run(`
      UPDATE equipamentos_heartbeat_fila
      SET agendado_para = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [agendadoParaIso, pendente.id]);
    return { id: pendente.id, atualizado: true };
  }
  const result = await run(`
    INSERT INTO equipamentos_heartbeat_fila (equipamento_id, status, agendado_para)
    VALUES (?, 'pendente', ?)
  `, [equipamentoId, agendadoParaIso]);
  return { id: result.lastID, atualizado: false };
}

async function obterProximoFila(agoraIso = new Date().toISOString()) {
  await garantirSchema();
  const row = await get(`
    SELECT * FROM equipamentos_heartbeat_fila
    WHERE status = 'pendente' AND agendado_para <= ?
    ORDER BY agendado_para ASC, id ASC
    LIMIT 1
  `, [agoraIso]);
  return row || null;
}

async function marcarFila(id, status, extra = {}) {
  await garantirSchema();
  await run(`
    UPDATE equipamentos_heartbeat_fila
    SET status = ?,
        tentativas = COALESCE(?, tentativas),
        erro_mensagem = COALESCE(?, erro_mensagem),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    status,
    extra.tentativas !== undefined ? extra.tentativas : null,
    extra.erro_mensagem || null,
    id
  ]);
}

async function limparFilaAntiga(dias = 7) {
  await garantirSchema();
  const corte = new Date(Date.now() - dias * 24 * 3600 * 1000).toISOString();
  await run(`
    DELETE FROM equipamentos_heartbeat_fila
    WHERE status IN ('concluido','erro') AND created_at < ?
  `, [corte]);
}

async function obterResumoDashboard() {
  await garantirSchema();
  const rows = await all('SELECT status, health_score FROM equipamentos_heartbeat');
  const resumo = {
    total: rows.length,
    online: 0,
    offline: 0,
    instavel: 0,
    sem_resposta: 0,
    sem_comunicacao: 0,
    health_medio: 0
  };
  let soma = 0;
  for (const r of rows) {
    const s = String(r.status || '').toUpperCase();
    if (s === 'ONLINE') resumo.online += 1;
    else if (s === 'INSTAVEL') resumo.instavel += 1;
    else if (s === 'SEM_RESPOSTA') resumo.sem_resposta += 1;
    else if (s === 'SEM_COMUNICACAO') resumo.sem_comunicacao += 1;
    else resumo.offline += 1;
    soma += Number(r.health_score || 0);
  }
  resumo.health_medio = rows.length ? Math.round(soma / rows.length) : 0;
  return resumo;
}

module.exports = {
  garantirSchema,
  buscarPorEquipamento,
  listarTodos,
  upsertEstado,
  registrarEvento,
  listarEventos,
  contarMudancasRecentes,
  enfileirar,
  obterProximoFila,
  marcarFila,
  limparFilaAntiga,
  obterResumoDashboard
};
