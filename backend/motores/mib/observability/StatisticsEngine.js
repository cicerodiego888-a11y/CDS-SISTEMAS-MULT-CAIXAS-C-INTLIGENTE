'use strict';

/**
 * Estatísticas persistidas do MIB.
 */
class StatisticsEngine {
  /**
   * @param {import('sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this._mem = {
      pesquisas: 0,
      tempoSoma: 0,
      tempoMin: null,
      tempoMax: 0,
      cacheHits: 0,
      cacheMiss: 0,
      hotHits: 0,
      sqlTempoSoma: 0,
      sqlCount: 0,
      cacheTempoSoma: 0,
      cacheCount: 0,
      catalogoTempoSoma: 0,
      catalogoCount: 0,
      swaps: 0,
      atualizacoesCatalogo: 0,
      tempoReconstrucaoSoma: 0,
      tempoReconstrucaoCount: 0,
      produtoMaisPesquisado: null,
      produtoMaisPesquisadoCount: 0,
      pesquisaMaisLentaMs: 0,
      pesquisaMaisRapidaMs: null,
      /** @type {Map<number, number>} */
      contagemProduto: new Map(),
      lastBenchmark: null
    };
    this._persistTimer = null;
  }

  registrarBusca({ tempoMs, fonte, produtoIds = [] } = {}) {
    const ms = Number(tempoMs) || 0;
    this._mem.pesquisas += 1;
    this._mem.tempoSoma += ms;
    if (this._mem.tempoMin == null || ms < this._mem.tempoMin) this._mem.tempoMin = ms;
    if (ms > this._mem.tempoMax) this._mem.tempoMax = ms;
    if (this._mem.pesquisaMaisRapidaMs == null || ms < this._mem.pesquisaMaisRapidaMs) {
      this._mem.pesquisaMaisRapidaMs = ms;
    }
    if (ms > this._mem.pesquisaMaisLentaMs) this._mem.pesquisaMaisLentaMs = ms;

    if (fonte === 'cache') {
      this._mem.cacheHits += 1;
      this._mem.cacheTempoSoma += ms;
      this._mem.cacheCount += 1;
    } else if (fonte === 'hotcache') {
      this._mem.hotHits += 1;
      this._mem.cacheHits += 1;
    } else if (fonte === 'sql') {
      this._mem.cacheMiss += 1;
      this._mem.sqlTempoSoma += ms;
      this._mem.sqlCount += 1;
    } else if (fonte === 'memoria' || fonte === 'incremental') {
      this._mem.cacheMiss += 1;
      this._mem.catalogoTempoSoma += ms;
      this._mem.catalogoCount += 1;
    } else {
      this._mem.cacheMiss += 1;
    }

    for (const id of produtoIds) {
      const n = Number(id);
      if (!n) continue;
      const c = (this._mem.contagemProduto.get(n) || 0) + 1;
      this._mem.contagemProduto.set(n, c);
      if (c > this._mem.produtoMaisPesquisadoCount) {
        this._mem.produtoMaisPesquisadoCount = c;
        this._mem.produtoMaisPesquisado = n;
      }
    }

    this._agendarPersistencia();
  }

  registrarSwap({ tempoMs } = {}) {
    this._mem.swaps += 1;
    this._mem.atualizacoesCatalogo += 1;
    if (tempoMs != null) {
      this._mem.tempoReconstrucaoSoma += Number(tempoMs) || 0;
      this._mem.tempoReconstrucaoCount += 1;
    }
    this._agendarPersistencia();
  }

  registrarBenchmark(resultado) {
    this._mem.lastBenchmark = {
      em: new Date().toISOString(),
      resumo: resultado
    };
    this._persistirBenchmark(resultado);
  }

  _agendarPersistencia() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this.persistir().catch(() => {});
    }, 5000);
  }

  snapshot() {
    const m = this._mem;
    const avg = m.pesquisas > 0 ? m.tempoSoma / m.pesquisas : 0;
    return {
      pesquisas: m.pesquisas,
      tempoMedioMs: Number(avg.toFixed(3)),
      tempoMaxMs: Number((m.tempoMax || 0).toFixed(3)),
      tempoMinMs: m.tempoMin == null ? 0 : Number(m.tempoMin.toFixed(3)),
      pesquisaMaisLentaMs: Number((m.pesquisaMaisLentaMs || 0).toFixed(3)),
      pesquisaMaisRapidaMs: m.pesquisaMaisRapidaMs == null
        ? 0
        : Number(m.pesquisaMaisRapidaMs.toFixed(3)),
      cacheHit: m.cacheHits,
      cacheMiss: m.cacheMiss,
      hotHits: m.hotHits,
      tempoMedioSqlMs: m.sqlCount ? Number((m.sqlTempoSoma / m.sqlCount).toFixed(3)) : 0,
      tempoMedioCacheMs: m.cacheCount ? Number((m.cacheTempoSoma / m.cacheCount).toFixed(3)) : 0,
      tempoMedioCatalogoMs: m.catalogoCount
        ? Number((m.catalogoTempoSoma / m.catalogoCount).toFixed(3))
        : 0,
      swaps: m.swaps,
      atualizacoesCatalogo: m.atualizacoesCatalogo,
      tempoMedioReconstrucaoMs: m.tempoReconstrucaoCount
        ? Number((m.tempoReconstrucaoSoma / m.tempoReconstrucaoCount).toFixed(3))
        : 0,
      produtoMaisPesquisado: m.produtoMaisPesquisado,
      produtoMaisPesquisadoCount: m.produtoMaisPesquisadoCount,
      lastBenchmark: m.lastBenchmark
    };
  }

  persistir() {
    const s = this.snapshot();
    const json = JSON.stringify(s);
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO mib_estatisticas (id, payload, atualizado_em)
         VALUES (1, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, atualizado_em = CURRENT_TIMESTAMP`,
        [json],
        (err) => (err ? reject(err) : resolve(s))
      );
    });
  }

  carregar() {
    return new Promise((resolve) => {
      this.db.get(`SELECT payload FROM mib_estatisticas WHERE id = 1`, [], (err, row) => {
        if (err || !row?.payload) return resolve(this.snapshot());
        try {
          const s = JSON.parse(row.payload);
          if (s.pesquisas) this._mem.pesquisas = Number(s.pesquisas) || 0;
          if (s.cacheHit) this._mem.cacheHits = Number(s.cacheHit) || 0;
          if (s.cacheMiss) this._mem.cacheMiss = Number(s.cacheMiss) || 0;
          if (s.swaps) this._mem.swaps = Number(s.swaps) || 0;
          if (s.atualizacoesCatalogo) {
            this._mem.atualizacoesCatalogo = Number(s.atualizacoesCatalogo) || 0;
          }
          if (s.lastBenchmark) this._mem.lastBenchmark = s.lastBenchmark;
        } catch (_) { /* ignore */ }
        resolve(this.snapshot());
      });
    });
  }

  _persistirBenchmark(resultado) {
    const json = JSON.stringify(resultado || {});
    this.db.run(
      `INSERT INTO mib_benchmark_historico (payload, criado_em) VALUES (?, CURRENT_TIMESTAMP)`,
      [json],
      () => {}
    );
  }

  historicoBenchmark(limite = 30) {
    return new Promise((resolve) => {
      this.db.all(
        `SELECT id, payload, criado_em FROM mib_benchmark_historico
         ORDER BY id DESC LIMIT ?`,
        [Math.min(Number(limite) || 30, 100)],
        (err, rows) => {
          if (err || !rows) return resolve([]);
          resolve(rows.map((r) => {
            let payload = {};
            try { payload = JSON.parse(r.payload); } catch (_) { /* ignore */ }
            return { id: r.id, criado_em: r.criado_em, ...payload };
          }));
        }
      );
    });
  }
}

module.exports = StatisticsEngine;
