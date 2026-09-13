'use strict';

const ISearchProvider = require('./ISearchProvider');
const { normalizarNomeBusca } = require('../../core/normalizarNomeBusca');
const { tokenizar } = require('../../core/tokenizer');
const { levenshtein } = require('../../core/levenshtein');

/**
 * Provider SQL genérico com pipeline: tokens → LIKE → fuzzy em memória.
 */
class BaseSqlProvider extends ISearchProvider {
  /**
   * @param {import('sqlite3').Database} db
   * @param {{
   *   entity: string,
   *   aliases?: string[],
   *   permissao?: string,
   *   tabela: string,
   *   select: string,
   *   camposTexto: string[],
   *   camposNumero?: string[],
   *   whereBase?: string,
   *   orderBy?: string,
   *   mapRow?: (row: object) => object
   * }} spec
   */
  constructor(db, spec) {
    super();
    this.db = db;
    this._entity = spec.entity;
    this._aliases = spec.aliases || [];
    this._permissao = spec.permissao || null;
    this.tabela = spec.tabela;
    this.select = spec.select;
    this.camposTexto = spec.camposTexto || [];
    this.camposNumero = spec.camposNumero || [];
    this.whereBase = spec.whereBase || '1=1';
    this.orderBy = spec.orderBy || '1';
    this.mapRow = typeof spec.mapRow === 'function' ? spec.mapRow : (r) => r;
  }

  get entity() { return this._entity; }
  get aliases() { return this._aliases; }
  get permissao() { return this._permissao; }

  indexSpec() {
    const indices = this.camposTexto.slice(0, 3).map(
      (c) => `CREATE INDEX IF NOT EXISTS idx_mib3_${this.tabela}_${c} ON ${this.tabela}(${c})`
    );
    return { tabela: this.tabela, indices };
  }

  /**
   * @param {string} query
   * @param {object} ctx
   */
  async search(query, ctx = {}) {
    const limite = Math.min(Math.max(Number(ctx.limite) || 20, 1), 100);
    const termo = String(query || '').trim();
    if (!termo) return { itens: [], meta: { estrategia: 'vazio' } };

    const tok = tokenizar(termo);
    const termoNorm = tok.normalizado || normalizarNomeBusca(termo);
    const digitos = termo.replace(/\D/g, '');
    const like = `%${termo.replace(/%/g, '')}%`;

    const params = [];
    const clauses = [];
    for (const c of this.camposTexto) {
      clauses.push(`LOWER(COALESCE(${c}, '')) LIKE LOWER(?)`);
      params.push(like);
    }
    if (digitos.length >= 3) {
      for (const c of this.camposNumero) {
        clauses.push(`REPLACE(REPLACE(REPLACE(COALESCE(${c}, ''), '.', ''), '-', ''), '/', '') LIKE ?`);
        params.push(`%${digitos}%`);
      }
    }

    const whereLike = clauses.length ? `(${clauses.join(' OR ')})` : '1=0';
    const sql = `
      SELECT ${this.select}
      FROM ${this.tabela}
      WHERE (${this.whereBase}) AND ${whereLike}
      ORDER BY ${this.orderBy}
      LIMIT ?
    `;
    params.push(limite * 3);

    let rows = await this._all(sql, params);

    // Fuzzy fallback se poucos resultados
    if (rows.length < Math.min(5, limite) && termoNorm.length >= 3) {
      const fuzzy = await this._fuzzyScan(termoNorm, limite, ctx);
      const ids = new Set(rows.map((r) => r.id));
      for (const f of fuzzy) {
        if (!ids.has(f.id)) rows.push(f);
      }
    }

    const itens = rows.slice(0, limite).map((r) => {
      const mapped = this.mapRow(r);
      return {
        ...mapped,
        _entity: this.entity,
        _score: this._scoreRow(mapped, termoNorm, digitos)
      };
    });

    itens.sort((a, b) => (b._score || 0) - (a._score || 0));

    return {
      itens: itens.slice(0, limite),
      meta: {
        estrategia: 'sql+pipeline',
        tokens: tok.tokens,
        termoNorm
      }
    };
  }

  _scoreRow(row, termoNorm, digitos) {
    let score = 0;
    for (const c of this.camposTexto) {
      const v = normalizarNomeBusca(row[c]);
      if (!v) continue;
      if (v === termoNorm) score = Math.max(score, 100);
      else if (v.startsWith(termoNorm)) score = Math.max(score, 80);
      else if (v.includes(termoNorm)) score = Math.max(score, 40);
    }
    if (digitos) {
      for (const c of this.camposNumero) {
        const n = String(row[c] || '').replace(/\D/g, '');
        if (n && n.includes(digitos)) score = Math.max(score, 70);
      }
    }
    return score;
  }

  async _fuzzyScan(termoNorm, limite, ctx) {
    const maxDist = Math.max(1, Number(ctx.maxDistancia) || 2);
    const sql = `SELECT ${this.select} FROM ${this.tabela} WHERE (${this.whereBase}) ORDER BY ${this.orderBy} LIMIT 800`;
    const rows = await this._all(sql, []);
    const out = [];
    for (const row of rows) {
      let best = 99;
      for (const c of this.camposTexto) {
        const v = normalizarNomeBusca(row[c]);
        if (!v) continue;
        const trecho = v.slice(0, termoNorm.length + maxDist);
        best = Math.min(best, levenshtein(termoNorm, trecho));
        best = Math.min(best, levenshtein(termoNorm, v.slice(0, termoNorm.length)));
      }
      if (best <= maxDist) out.push(row);
      if (out.length >= limite) break;
    }
    return out;
  }

  _all(sql, params) {
    return new Promise((resolve) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          console.warn(`[SearchProvider:${this.entity}]`, err.message);
          resolve([]);
          return;
        }
        resolve(rows || []);
      });
    });
  }
}

module.exports = BaseSqlProvider;
