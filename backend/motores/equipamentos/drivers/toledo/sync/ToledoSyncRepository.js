/**
 * Sprint 14.8 / 15.4 — ToledoSyncRepository
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

async function garantirColuna(tabela, coluna, ddl) {
  const cols = await all(`PRAGMA table_info(${tabela})`);
  if (!(cols || []).some((c) => c.name === coluna)) {
    await run(`ALTER TABLE ${tabela} ADD COLUMN ${ddl}`);
  }
}

async function garantirTabelas() {
  if (tabelaPronta) return;
  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT,
      status TEXT,
      iniciado_em DATETIME,
      finalizado_em DATETIME,
      produtos_lidos INTEGER DEFAULT 0,
      produtos_enviados INTEGER DEFAULT 0,
      produtos_atualizados INTEGER DEFAULT 0,
      produtos_ignorados INTEGER DEFAULT 0,
      erros INTEGER DEFAULT 0,
      host TEXT,
      porta INTEGER,
      relatorio_json TEXT
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS equipamentos_sync_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id INTEGER NOT NULL,
      produto_id INTEGER,
      plu TEXT,
      acao TEXT,
      status TEXT,
      erro TEXT,
      FOREIGN KEY (sync_id) REFERENCES equipamentos_sync(id)
    )
  `);

  // Sprint 15.4 — colunas extras
  await garantirColuna('equipamentos_sync', 'modo', 'modo TEXT');
  await garantirColuna('equipamentos_sync', 'equipamento_id', 'equipamento_id INTEGER');
  await garantirColuna('equipamentos_sync', 'usuario_id', 'usuario_id INTEGER');
  await garantirColuna('equipamentos_sync', 'tempo_ms', 'tempo_ms INTEGER');
  await garantirColuna('equipamentos_sync', 'observacoes', 'observacoes TEXT');
  await garantirColuna('equipamentos_sync', 'versao_carga', 'versao_carga TEXT');
  await garantirColuna('equipamentos_sync_itens', 'tentativas', 'tentativas INTEGER DEFAULT 0');
  await garantirColuna('equipamentos_sync_itens', 'tempo_ms', 'tempo_ms INTEGER');

  await run(`CREATE INDEX IF NOT EXISTS idx_eq_sync_status ON equipamentos_sync(status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_sync_itens_sync ON equipamentos_sync_itens(sync_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_eq_sync_equip ON equipamentos_sync(equipamento_id)`);
  tabelaPronta = true;
}

class ToledoSyncRepository {
  async criarSync({
    tipo = 'PLU',
    host,
    porta,
    modo = null,
    equipamento_id = null,
    usuario_id = null,
    versao_carga = null
  } = {}) {
    await garantirTabelas();
    const r = await run(`
      INSERT INTO equipamentos_sync (
        tipo, status, iniciado_em, host, porta, modo, equipamento_id, usuario_id, versao_carga
      ) VALUES (?, 'INICIADO', CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?)
    `, [
      tipo,
      host || null,
      porta != null ? Number(porta) : null,
      modo || null,
      equipamento_id != null ? Number(equipamento_id) : null,
      usuario_id != null ? Number(usuario_id) : null,
      versao_carga || null
    ]);
    return r.lastID;
  }

  async atualizarSync(id, campos = {}) {
    await garantirTabelas();
    const map = {
      status: 'status',
      produtos_lidos: 'produtos_lidos',
      produtos_enviados: 'produtos_enviados',
      produtos_atualizados: 'produtos_atualizados',
      produtos_ignorados: 'produtos_ignorados',
      erros: 'erros',
      relatorio_json: 'relatorio_json',
      modo: 'modo',
      tempo_ms: 'tempo_ms',
      observacoes: 'observacoes',
      versao_carga: 'versao_carga'
    };
    const sets = [];
    const params = [];
    for (const [k, col] of Object.entries(map)) {
      if (campos[k] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(campos[k]);
      }
    }
    if (campos.finalizar) {
      sets.push('finalizado_em = CURRENT_TIMESTAMP');
    }
    if (!sets.length) return;
    params.push(id);
    await run(`UPDATE equipamentos_sync SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async inserirItem({ sync_id, produto_id, plu, acao, status, erro, tentativas, tempo_ms }) {
    await garantirTabelas();
    const r = await run(`
      INSERT INTO equipamentos_sync_itens (
        sync_id, produto_id, plu, acao, status, erro, tentativas, tempo_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      sync_id,
      produto_id != null ? produto_id : null,
      plu != null ? String(plu) : null,
      acao || null,
      status || null,
      erro || null,
      tentativas != null ? Number(tentativas) : 0,
      tempo_ms != null ? Number(tempo_ms) : null
    ]);
    return r.lastID;
  }

  async atualizarItem(id, { status, erro, tentativas, tempo_ms } = {}) {
    await garantirTabelas();
    await run(`
      UPDATE equipamentos_sync_itens
      SET status = COALESCE(?, status),
          erro = ?,
          tentativas = COALESCE(?, tentativas),
          tempo_ms = COALESCE(?, tempo_ms)
      WHERE id = ?
    `, [
      status || null,
      erro != null ? String(erro) : null,
      tentativas != null ? Number(tentativas) : null,
      tempo_ms != null ? Number(tempo_ms) : null,
      id
    ]);
  }

  async historico({ limite = 50, host, porta, equipamento_id, modo } = {}) {
    await garantirTabelas();
    const where = [];
    const params = [];
    if (host) { where.push('host = ?'); params.push(String(host)); }
    if (porta != null) { where.push('porta = ?'); params.push(Number(porta)); }
    if (equipamento_id != null) { where.push('equipamento_id = ?'); params.push(Number(equipamento_id)); }
    if (modo) { where.push('modo = ?'); params.push(String(modo)); }
    params.push(Math.max(1, Math.min(500, Number(limite) || 50)));
    return all(`
      SELECT * FROM equipamentos_sync
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC
      LIMIT ?
    `, params);
  }

  async buscarPorId(id) {
    await garantirTabelas();
    const sync = await get(`SELECT * FROM equipamentos_sync WHERE id = ?`, [id]);
    if (!sync) return null;
    const itens = await all(`
      SELECT * FROM equipamentos_sync_itens WHERE sync_id = ? ORDER BY id ASC
    `, [id]);
    let relatorio = null;
    if (sync.relatorio_json) {
      try { relatorio = JSON.parse(sync.relatorio_json); } catch (_) { relatorio = sync.relatorio_json; }
    }
    return { ...sync, itens, relatorio };
  }
}

module.exports = ToledoSyncRepository;
module.exports.ToledoSyncRepository = ToledoSyncRepository;
module.exports.garantirTabelas = garantirTabelas;
