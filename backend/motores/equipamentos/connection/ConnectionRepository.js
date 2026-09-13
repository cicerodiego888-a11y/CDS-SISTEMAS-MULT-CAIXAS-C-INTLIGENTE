/**
 * Sprint 14.3 — ConnectionRepository
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

async function garantirTabela() {
  if (tabelaPronta) return;
  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_conexoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host TEXT NOT NULL,
      porta INTEGER NOT NULL,
      status TEXT,
      latencia INTEGER,
      conectado_em DATETIME,
      desconectado_em DATETIME,
      ultima_atividade DATETIME,
      reconexoes INTEGER DEFAULT 0,
      UNIQUE(host, porta)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_conexoes_host ON equipamentos_conexoes(host)`);
  tabelaPronta = true;
}

class ConnectionRepository {
  async salvar(registro) {
    await garantirTabela();
    const host = String(registro.host || '');
    const porta = Number(registro.porta) || 0;
    if (!host || !porta) {
      // Serial/USB sem host:porta — persiste com placeholder
      if (!registro.equipamento_id && !registro.porta_com) return null;
    }

    const hostFinal = host || `eq-${registro.equipamento_id || 'x'}`;
    const portaFinal = porta || 0;

    try {
      await run(`ALTER TABLE equipamentos_conexoes ADD COLUMN equipamento_id INTEGER`);
    } catch (_) { /* coluna já existe */ }
    try {
      await run(`ALTER TABLE equipamentos_conexoes ADD COLUMN transporte TEXT`);
    } catch (_) { /* coluna já existe */ }

    await run(`
      INSERT INTO equipamentos_conexoes (
        host, porta, status, latencia, conectado_em, desconectado_em, ultima_atividade, reconexoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host, porta) DO UPDATE SET
        status = excluded.status,
        latencia = excluded.latencia,
        conectado_em = excluded.conectado_em,
        desconectado_em = excluded.desconectado_em,
        ultima_atividade = excluded.ultima_atividade,
        reconexoes = excluded.reconexoes
    `, [
      hostFinal,
      portaFinal,
      registro.status || null,
      registro.latencia != null ? Number(registro.latencia) : null,
      registro.conectado_em || registro.conectadoEm || null,
      registro.desconectado_em || registro.desconectadoEm || null,
      registro.ultima_atividade || registro.ultimaAtividade || null,
      Number(registro.reconexoes) || 0
    ]);

    if (registro.equipamento_id != null) {
      try {
        await run(
          `UPDATE equipamentos_conexoes SET equipamento_id = ?, transporte = ? WHERE host = ? AND porta = ?`,
          [Number(registro.equipamento_id), registro.transporte || null, hostFinal, portaFinal]
        );
      } catch (_) { /* ignore */ }
    }

    return { host: hostFinal, porta: portaFinal, equipamento_id: registro.equipamento_id || null };
  }

  async buscarPorEquipamentoId(equipamentoId) {
    await garantirTabela();
    try {
      return get(`
        SELECT * FROM equipamentos_conexoes
        WHERE equipamento_id = ?
        ORDER BY datetime(COALESCE(ultima_atividade, conectado_em)) DESC
        LIMIT 1
      `, [Number(equipamentoId)]);
    } catch (_) {
      return null;
    }
  }

  async buscarPorHostPorta(host, porta) {
    await garantirTabela();
    return get(`
      SELECT * FROM equipamentos_conexoes
      WHERE host = ? AND porta = ?
      LIMIT 1
    `, [String(host), Number(porta)]);
  }

  async listar({ limite = 100 } = {}) {
    await garantirTabela();
    return all(`
      SELECT * FROM equipamentos_conexoes
      ORDER BY datetime(COALESCE(ultima_atividade, conectado_em)) DESC
      LIMIT ?
    `, [Math.max(1, Math.min(500, Number(limite) || 100))]);
  }
}

module.exports = ConnectionRepository;
module.exports.ConnectionRepository = ConnectionRepository;
module.exports.garantirTabela = garantirTabela;
