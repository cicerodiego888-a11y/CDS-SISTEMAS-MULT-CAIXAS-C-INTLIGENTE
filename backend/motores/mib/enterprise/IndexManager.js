'use strict';

/**
 * IndexManager Enterprise — cria, valida e diagnostica índices de pesquisa.
 */
class IndexManager {
  /**
   * @param {import('sqlite3').Database} db
   * @param {Map<string, import('./providers/ISearchProvider')>} providers
   */
  constructor(db, providers) {
    this.db = db;
    this.providers = providers;
  }

  /**
   * Garante índices de todos os providers.
   */
  async rebuild() {
    const specs = new Map();
    for (const p of new Set(this.providers.values())) {
      const spec = p.indexSpec ? p.indexSpec() : null;
      if (!spec?.tabela || !spec.indices?.length) continue;
      for (const sql of spec.indices) {
        specs.set(sql, true);
      }
    }
    let criados = 0;
    let erros = 0;
    for (const sql of specs.keys()) {
      try {
        await this._run(sql);
        criados += 1;
      } catch (_) {
        erros += 1;
      }
    }
    return { ok: true, indices: criados, erros };
  }

  async validar() {
    const rows = await this._all(
      `SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name`
    );
    const fragmentacao = await this._pragmaFragmentacao();
    return {
      ok: true,
      indices: rows.length,
      lista: rows.slice(0, 100),
      fragmentacao
    };
  }

  async diagnosticar() {
    const validacao = await this.validar();
    const pages = await this._all(`PRAGMA page_count`);
    const free = await this._all(`PRAGMA freelist_count`);
    const pageCount = pages[0]?.page_count ?? pages[0]?.['page_count'] ?? 0;
    const freeCount = free[0]?.freelist_count ?? free[0]?.['freelist_count'] ?? 0;
    const fragPct = pageCount > 0 ? Number(((freeCount / pageCount) * 100).toFixed(2)) : 0;
    return {
      ...validacao,
      pageCount,
      freelistCount: freeCount,
      fragmentacaoPct: fragPct,
      desempenho: fragPct > 20 ? 'degradado' : fragPct > 10 ? 'atencao' : 'ok',
      recomendacao: fragPct > 20 ? 'Executar VACUUM' : null
    };
  }

  async _pragmaFragmentacao() {
    try {
      const free = await this._all(`PRAGMA freelist_count`);
      const pages = await this._all(`PRAGMA page_count`);
      const f = Number(Object.values(free[0] || {})[0]) || 0;
      const p = Number(Object.values(pages[0] || {})[0]) || 0;
      return p ? Number(((f / p) * 100).toFixed(2)) : 0;
    } catch (_) {
      return 0;
    }
  }

  _run(sql) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, (err) => (err ? reject(err) : resolve()));
    });
  }

  _all(sql) {
    return new Promise((resolve) => {
      this.db.all(sql, [], (err, rows) => resolve(err ? [] : (rows || [])));
    });
  }
}

module.exports = IndexManager;
