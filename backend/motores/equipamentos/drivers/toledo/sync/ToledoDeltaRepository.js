/**
 * Sprint 15.5 — ToledoDeltaRepository
 * Persistência de versões, snapshots e auditoria.
 */

'use strict';

const crypto = require('crypto');

function createMemoryStore() {
  return {
    versions: [],
    audit: [],
    nextVersionId: 1,
    nextAuditId: 1
  };
}

function tryDb() {
  try {
    return require('../../../../../database');
  } catch (_) {
    return null;
  }
}

function runDb(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function allDb(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function getDb(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

class ToledoDeltaRepository {
  /**
   * @param {{memory?:boolean, store?:object, db?:object}} [deps]
   */
  constructor(deps = {}) {
    this.memory = deps.memory === true || !tryDb();
    this.store = deps.store || (this.memory ? createMemoryStore() : null);
    this.db = deps.db || (!this.memory ? tryDb() : null);
    this._ready = false;
  }

  async garantirTabelas() {
    if (this.memory || this._ready) {
      this._ready = true;
      return;
    }
    await runDb(this.db, `
      CREATE TABLE IF NOT EXISTS equipamentos_sync_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        equipamento_id INTEGER,
        host TEXT,
        porta INTEGER,
        versao INTEGER NOT NULL,
        hash TEXT,
        inicio DATETIME,
        fim DATETIME,
        usuario_id INTEGER,
        usuario TEXT,
        status TEXT,
        snapshot TEXT,
        sync_id INTEGER,
        tempo_ms INTEGER,
        itens INTEGER DEFAULT 0,
        falhas INTEGER DEFAULT 0,
        observacoes TEXT
      )
    `);
    await runDb(this.db, `
      CREATE TABLE IF NOT EXISTS equipamentos_sync_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id INTEGER,
        equipamento_id INTEGER,
        produto_id INTEGER,
        plu TEXT,
        campo TEXT,
        valor_anterior TEXT,
        valor_novo TEXT,
        tipo TEXT,
        usuario_id INTEGER,
        usuario TEXT,
        data DATETIME DEFAULT CURRENT_TIMESTAMP,
        resultado TEXT,
        FOREIGN KEY (version_id) REFERENCES equipamentos_sync_versions(id)
      )
    `);
    await runDb(this.db, `CREATE INDEX IF NOT EXISTS idx_eq_sync_ver_eq ON equipamentos_sync_versions(equipamento_id)`);
    await runDb(this.db, `CREATE INDEX IF NOT EXISTS idx_eq_sync_audit_ver ON equipamentos_sync_audit(version_id)`);
    this._ready = true;
  }

  async proximaVersao(equipamentoKey) {
    await this.garantirTabelas();
    if (this.memory) {
      const list = this.store.versions.filter((v) => matchKey(v, equipamentoKey));
      const max = list.reduce((m, v) => Math.max(m, Number(v.versao) || 0), 0);
      return max + 1;
    }
    const row = await getDb(this.db, `
      SELECT MAX(versao) AS maxv FROM equipamentos_sync_versions
      WHERE ${equipamentoKey.equipamento_id != null ? 'equipamento_id = ?' : 'host = ? AND porta = ?'}
    `, equipamentoKey.equipamento_id != null
      ? [equipamentoKey.equipamento_id]
      : [equipamentoKey.host, equipamentoKey.porta]);
    return (Number(row?.maxv) || 0) + 1;
  }

  async salvarVersao(dados = {}) {
    await this.garantirTabelas();
    const snapshotStr = typeof dados.snapshot === 'string'
      ? dados.snapshot
      : JSON.stringify(dados.snapshot || null);

    if (this.memory) {
      const id = this.store.nextVersionId++;
      const row = {
        id,
        equipamento_id: dados.equipamento_id ?? null,
        host: dados.host || null,
        porta: dados.porta != null ? Number(dados.porta) : null,
        versao: Number(dados.versao),
        hash: dados.hash || null,
        inicio: dados.inicio || new Date().toISOString(),
        fim: dados.fim || null,
        usuario_id: dados.usuario_id ?? null,
        usuario: dados.usuario || null,
        status: dados.status || 'INICIADO',
        snapshot: snapshotStr,
        sync_id: dados.sync_id ?? null,
        tempo_ms: dados.tempo_ms ?? null,
        itens: dados.itens ?? 0,
        falhas: dados.falhas ?? 0,
        observacoes: dados.observacoes || null
      };
      this.store.versions.push(row);
      return id;
    }

    const r = await runDb(this.db, `
      INSERT INTO equipamentos_sync_versions (
        equipamento_id, host, porta, versao, hash, inicio, fim, usuario_id, usuario,
        status, snapshot, sync_id, tempo_ms, itens, falhas, observacoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      dados.equipamento_id ?? null,
      dados.host || null,
      dados.porta != null ? Number(dados.porta) : null,
      Number(dados.versao),
      dados.hash || null,
      dados.inicio || new Date().toISOString(),
      dados.fim || null,
      dados.usuario_id ?? null,
      dados.usuario || null,
      dados.status || 'INICIADO',
      snapshotStr,
      dados.sync_id ?? null,
      dados.tempo_ms ?? null,
      dados.itens ?? 0,
      dados.falhas ?? 0,
      dados.observacoes || null
    ]);
    return r.lastID;
  }

  async atualizarVersao(id, campos = {}) {
    await this.garantirTabelas();
    if (this.memory) {
      const row = this.store.versions.find((v) => v.id === id);
      if (!row) return;
      Object.assign(row, {
        status: campos.status !== undefined ? campos.status : row.status,
        fim: campos.fim !== undefined ? campos.fim : row.fim,
        hash: campos.hash !== undefined ? campos.hash : row.hash,
        snapshot: campos.snapshot !== undefined
          ? (typeof campos.snapshot === 'string' ? campos.snapshot : JSON.stringify(campos.snapshot))
          : row.snapshot,
        tempo_ms: campos.tempo_ms !== undefined ? campos.tempo_ms : row.tempo_ms,
        itens: campos.itens !== undefined ? campos.itens : row.itens,
        falhas: campos.falhas !== undefined ? campos.falhas : row.falhas,
        observacoes: campos.observacoes !== undefined ? campos.observacoes : row.observacoes
      });
      return;
    }
    const map = {
      status: 'status',
      fim: 'fim',
      hash: 'hash',
      snapshot: 'snapshot',
      tempo_ms: 'tempo_ms',
      itens: 'itens',
      falhas: 'falhas',
      observacoes: 'observacoes'
    };
    const sets = [];
    const params = [];
    for (const [k, col] of Object.entries(map)) {
      if (campos[k] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(k === 'snapshot' && typeof campos[k] !== 'string'
          ? JSON.stringify(campos[k])
          : campos[k]);
      }
    }
    if (!sets.length) return;
    params.push(id);
    await runDb(this.db, `UPDATE equipamentos_sync_versions SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async listarVersoes(filtros = {}) {
    await this.garantirTabelas();
    const limite = Math.max(1, Math.min(200, Number(filtros.limite) || 50));
    if (this.memory) {
      return this.store.versions
        .filter((v) => matchKey(v, filtros))
        .sort((a, b) => b.versao - a.versao)
        .slice(0, limite)
        .map(parseVersion);
    }
    const where = [];
    const params = [];
    if (filtros.equipamento_id != null) {
      where.push('equipamento_id = ?');
      params.push(Number(filtros.equipamento_id));
    }
    if (filtros.host) {
      where.push('host = ?');
      params.push(String(filtros.host));
    }
    if (filtros.porta != null) {
      where.push('porta = ?');
      params.push(Number(filtros.porta));
    }
    params.push(limite);
    const rows = await allDb(this.db, `
      SELECT * FROM equipamentos_sync_versions
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY versao DESC
      LIMIT ?
    `, params);
    return rows.map(parseVersion);
  }

  async obterVersao(equipamentoKey, versao) {
    await this.garantirTabelas();
    if (this.memory) {
      const row = this.store.versions.find((v) =>
        matchKey(v, equipamentoKey) && Number(v.versao) === Number(versao));
      return row ? parseVersion(row) : null;
    }
    const where = ['versao = ?'];
    const params = [Number(versao)];
    if (equipamentoKey.equipamento_id != null) {
      where.push('equipamento_id = ?');
      params.push(Number(equipamentoKey.equipamento_id));
    } else {
      where.push('host = ?');
      where.push('porta = ?');
      params.push(equipamentoKey.host, Number(equipamentoKey.porta));
    }
    const row = await getDb(this.db, `
      SELECT * FROM equipamentos_sync_versions WHERE ${where.join(' AND ')} LIMIT 1
    `, params);
    return row ? parseVersion(row) : null;
  }

  async obterPorId(id) {
    await this.garantirTabelas();
    if (this.memory) {
      const row = this.store.versions.find((v) => v.id === Number(id));
      return row ? parseVersion(row) : null;
    }
    const row = await getDb(this.db, `SELECT * FROM equipamentos_sync_versions WHERE id = ?`, [id]);
    return row ? parseVersion(row) : null;
  }

  async ultimaBemSucedida(equipamentoKey) {
    const list = await this.listarVersoes({ ...equipamentoKey, limite: 50 });
    return list.find((v) => v.status === 'SUCESSO' || v.status === 'CONCLUIDO') || null;
  }

  async ultimaFalha(equipamentoKey) {
    const list = await this.listarVersoes({ ...equipamentoKey, limite: 50 });
    return list.find((v) => v.status === 'FALHA' || v.status === 'ERRO' || v.status === 'ROLLBACK') || null;
  }

  async salvarAudit(entradas = []) {
    await this.garantirTabelas();
    const lista = Array.isArray(entradas) ? entradas : [entradas];
    const ids = [];
    for (const e of lista) {
      if (this.memory) {
        const id = this.store.nextAuditId++;
        this.store.audit.push({
          id,
          version_id: e.version_id ?? null,
          equipamento_id: e.equipamento_id ?? null,
          produto_id: e.produto_id ?? null,
          plu: e.plu != null ? String(e.plu) : null,
          campo: e.campo || null,
          valor_anterior: stringify(e.valor_anterior),
          valor_novo: stringify(e.valor_novo),
          tipo: e.tipo || null,
          usuario_id: e.usuario_id ?? null,
          usuario: e.usuario || null,
          data: e.data || new Date().toISOString(),
          resultado: e.resultado || null
        });
        ids.push(id);
      } else {
        const r = await runDb(this.db, `
          INSERT INTO equipamentos_sync_audit (
            version_id, equipamento_id, produto_id, plu, campo,
            valor_anterior, valor_novo, tipo, usuario_id, usuario, data, resultado
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          e.version_id ?? null,
          e.equipamento_id ?? null,
          e.produto_id ?? null,
          e.plu != null ? String(e.plu) : null,
          e.campo || null,
          stringify(e.valor_anterior),
          stringify(e.valor_novo),
          e.tipo || null,
          e.usuario_id ?? null,
          e.usuario || null,
          e.data || new Date().toISOString(),
          e.resultado || null
        ]);
        ids.push(r.lastID);
      }
    }
    return ids;
  }

  async listarAudit(filtros = {}) {
    await this.garantirTabelas();
    const limite = Math.max(1, Math.min(500, Number(filtros.limite) || 100));
    if (this.memory) {
      return this.store.audit
        .filter((a) => {
          if (filtros.version_id != null && a.version_id !== Number(filtros.version_id)) return false;
          if (filtros.equipamento_id != null && a.equipamento_id !== Number(filtros.equipamento_id)) return false;
          return true;
        })
        .sort((a, b) => b.id - a.id)
        .slice(0, limite);
    }
    const where = [];
    const params = [];
    if (filtros.version_id != null) {
      where.push('version_id = ?');
      params.push(Number(filtros.version_id));
    }
    if (filtros.equipamento_id != null) {
      where.push('equipamento_id = ?');
      params.push(Number(filtros.equipamento_id));
    }
    params.push(limite);
    return allDb(this.db, `
      SELECT * FROM equipamentos_sync_audit
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC
      LIMIT ?
    `, params);
  }
}

function matchKey(row, key = {}) {
  if (key.equipamento_id != null || key.equipamentoId != null) {
    return Number(row.equipamento_id) === Number(key.equipamento_id ?? key.equipamentoId);
  }
  if (key.host) {
    if (String(row.host) !== String(key.host)) return false;
    if (key.porta != null && Number(row.porta) !== Number(key.porta)) return false;
  }
  return true;
}

function parseVersion(row) {
  if (!row) return null;
  let snapshot = row.snapshot;
  if (typeof snapshot === 'string') {
    try { snapshot = JSON.parse(snapshot); } catch (_) { /* keep string */ }
  }
  return { ...row, snapshot };
}

function stringify(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

module.exports = ToledoDeltaRepository;
module.exports.ToledoDeltaRepository = ToledoDeltaRepository;
module.exports.createMemoryStore = createMemoryStore;
module.exports.hashPayload = (obj) => crypto.createHash('sha256')
  .update(typeof obj === 'string' ? obj : JSON.stringify(obj || {}))
  .digest('hex');
