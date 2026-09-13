/**
 * Sprint 14.5 — FrameRepository
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

async function garantirTabelas() {
  if (tabelaPronta) return;
  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_capturas (
      id TEXT PRIMARY KEY,
      iniciado_em DATETIME,
      finalizado_em DATETIME,
      equipamento TEXT,
      driver TEXT,
      frames INTEGER DEFAULT 0,
      status TEXT,
      host TEXT,
      porta INTEGER,
      total_tx INTEGER DEFAULT 0,
      total_rx INTEGER DEFAULT 0
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_frames (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp DATETIME,
      direction TEXT,
      host TEXT,
      porta INTEGER,
      frame_hex TEXT,
      frame_ascii TEXT,
      checksum TEXT,
      size INTEGER,
      FOREIGN KEY(session_id) REFERENCES equipamentos_capturas(id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_frames_session ON equipamentos_frames(session_id)`);
  tabelaPronta = true;
}

class FrameRepository {
  async salvarSessao(session) {
    await garantirTabelas();
    const s = typeof session.paraApi === 'function' ? session.paraApi() : session;
    await run(`
      INSERT INTO equipamentos_capturas (
        id, iniciado_em, finalizado_em, equipamento, driver, frames, status, host, porta, total_tx, total_rx
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        finalizado_em = excluded.finalizado_em,
        frames = excluded.frames,
        status = excluded.status,
        total_tx = excluded.total_tx,
        total_rx = excluded.total_rx
    `, [
      s.id,
      s.iniciadoEm || s.iniciado_em || null,
      s.finalizadoEm || s.finalizado_em || null,
      s.equipamento || null,
      s.driver || null,
      s.totalFrames != null ? s.totalFrames : (s.frames || 0),
      s.status || null,
      s.host || null,
      s.porta != null ? s.porta : null,
      s.totalTX != null ? s.totalTX : (s.total_tx || 0),
      s.totalRX != null ? s.totalRX : (s.total_rx || 0)
    ]);
    return s.id;
  }

  async salvarFrame(frame) {
    await garantirTabelas();
    const r = await run(`
      INSERT INTO equipamentos_frames (
        session_id, timestamp, direction, host, porta, frame_hex, frame_ascii, checksum, size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      frame.sessionId || frame.session_id,
      frame.timestamp,
      frame.direction,
      frame.host || null,
      frame.porta != null ? frame.porta : null,
      frame.frame_hex,
      frame.frame_ascii,
      frame.checksum,
      frame.tamanho != null ? frame.tamanho : frame.size
    ]);
    return r.lastID;
  }

  async buscarSessao(id) {
    await garantirTabelas();
    return get(`SELECT * FROM equipamentos_capturas WHERE id = ? LIMIT 1`, [String(id)]);
  }

  async listarFrames(sessionId, { limite = 500 } = {}) {
    await garantirTabelas();
    return all(`
      SELECT * FROM equipamentos_frames
      WHERE session_id = ?
      ORDER BY id ASC
      LIMIT ?
    `, [String(sessionId), Math.max(1, Math.min(5000, Number(limite) || 500))]);
  }
}

module.exports = FrameRepository;
module.exports.FrameRepository = FrameRepository;
module.exports.garantirTabelas = garantirTabelas;
