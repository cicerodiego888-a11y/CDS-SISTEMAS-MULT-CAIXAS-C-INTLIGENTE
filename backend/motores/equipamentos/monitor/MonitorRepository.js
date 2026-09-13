/**
 * Sprint 14.10 — MonitorRepository
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
    CREATE TABLE IF NOT EXISTS equipamentos_monitor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipamento_id INTEGER,
      status TEXT,
      heartbeat TEXT,
      ultima_verificacao DATETIME,
      latencia INTEGER,
      evento TEXT,
      registrado_em DATETIME,
      host TEXT,
      porta INTEGER,
      session_id TEXT
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_monitor_reg ON equipamentos_monitor(registrado_em DESC)`);
  tabelaPronta = true;
}

const CONFIG_KEYS = Object.freeze({
  monitorEnabled: 'monitorEnabled',
  monitorIntervalMs: 'monitorIntervalMs',
  heartbeatTimeoutMs: 'heartbeatTimeoutMs'
});

class MonitorRepository {
  async registrar({
    equipamento_id,
    status,
    heartbeat,
    latencia,
    evento,
    host,
    porta,
    session_id
  } = {}) {
    await garantirTabela();
    const r = await run(`
      INSERT INTO equipamentos_monitor (
        equipamento_id, status, heartbeat, ultima_verificacao,
        latencia, evento, registrado_em, host, porta, session_id
      ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
    `, [
      equipamento_id != null ? equipamento_id : null,
      status || null,
      heartbeat || null,
      latencia != null ? Number(latencia) : null,
      evento || null,
      host || null,
      porta != null ? Number(porta) : null,
      session_id || null
    ]);
    return r.lastID;
  }

  async historico({ limite = 50, host, porta, equipamento_id, session_id } = {}) {
    await garantirTabela();
    const where = [];
    const params = [];
    if (host) { where.push('host = ?'); params.push(String(host)); }
    if (porta != null) { where.push('porta = ?'); params.push(Number(porta)); }
    if (equipamento_id != null) {
      where.push('equipamento_id = ?');
      params.push(Number(equipamento_id));
    }
    if (session_id) { where.push('session_id = ?'); params.push(String(session_id)); }
    params.push(Math.max(1, Math.min(500, Number(limite) || 50)));
    return all(`
      SELECT * FROM equipamentos_monitor
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC
      LIMIT ?
    `, params);
  }

  /**
   * Configuração do equipamento (chave/valor em equipamentos_configuracoes).
   */
  async obterConfig(equipamentoId) {
    if (equipamentoId == null) {
      return {
        monitorEnabled: true,
        monitorIntervalMs: 5000,
        heartbeatTimeoutMs: 2000
      };
    }
    const rows = await all(`
      SELECT chave, valor FROM equipamentos_configuracoes
      WHERE equipamento_id = ? AND chave IN (?, ?, ?)
    `, [
      Number(equipamentoId),
      CONFIG_KEYS.monitorEnabled,
      CONFIG_KEYS.monitorIntervalMs,
      CONFIG_KEYS.heartbeatTimeoutMs
    ]);
    const map = Object.fromEntries((rows || []).map((r) => [r.chave, r.valor]));
    return {
      monitorEnabled: map.monitorEnabled == null
        ? true
        : String(map.monitorEnabled).toLowerCase() === 'true' || map.monitorEnabled === '1',
      monitorIntervalMs: map.monitorIntervalMs != null
        ? Number(map.monitorIntervalMs)
        : 5000,
      heartbeatTimeoutMs: map.heartbeatTimeoutMs != null
        ? Number(map.heartbeatTimeoutMs)
        : 2000
    };
  }

  async salvarConfig(equipamentoId, config = {}) {
    if (equipamentoId == null) return null;
    await this._upsertConfig(equipamentoId, CONFIG_KEYS.monitorEnabled,
      config.monitorEnabled != null ? String(!!config.monitorEnabled) : 'true');
    if (config.monitorIntervalMs != null) {
      await this._upsertConfig(equipamentoId, CONFIG_KEYS.monitorIntervalMs,
        String(Number(config.monitorIntervalMs)));
    }
    if (config.heartbeatTimeoutMs != null) {
      await this._upsertConfig(equipamentoId, CONFIG_KEYS.heartbeatTimeoutMs,
        String(Number(config.heartbeatTimeoutMs)));
    }
    return this.obterConfig(equipamentoId);
  }

  async _upsertConfig(equipamentoId, chave, valor) {
    const existing = await get(`
      SELECT id FROM equipamentos_configuracoes
      WHERE equipamento_id = ? AND chave = ?
    `, [equipamentoId, chave]);
    if (existing) {
      await run(`
        UPDATE equipamentos_configuracoes SET valor = ? WHERE id = ?
      `, [String(valor), existing.id]);
    } else {
      await run(`
        INSERT INTO equipamentos_configuracoes (equipamento_id, chave, valor, descricao)
        VALUES (?, ?, ?, ?)
      `, [equipamentoId, chave, String(valor), `Monitor V1.0 — ${chave}`]);
    }
  }
}

module.exports = MonitorRepository;
module.exports.MonitorRepository = MonitorRepository;
module.exports.garantirTabela = garantirTabela;
module.exports.CONFIG_KEYS = CONFIG_KEYS;
