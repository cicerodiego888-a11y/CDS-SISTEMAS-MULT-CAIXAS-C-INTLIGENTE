'use strict';

/**
 * Telemetria Enterprise Search — tempo, cache, provider, operador, filial.
 */
class SearchTelemetry {
  /**
   * @param {import('sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this._mem = [];
    this._maxMem = 500;
  }

  async garantirTabela() {
    return new Promise((resolve) => {
      this.db.run(
        `CREATE TABLE IF NOT EXISTS mib_search_telemetry (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity TEXT,
          query TEXT,
          provider TEXT,
          tempo_ms REAL,
          cache_hit INTEGER DEFAULT 0,
          resultados INTEGER DEFAULT 0,
          operador_id INTEGER,
          filial_id INTEGER,
          origem TEXT,
          ranking_top REAL,
          cpu_ms REAL,
          ram_mb REAL,
          ok INTEGER DEFAULT 1,
          criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        () => {
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_mib_tel_entity ON mib_search_telemetry(entity)`,
            () => resolve()
          );
        }
      );
    });
  }

  /**
   * @param {object} evt
   */
  registrar(evt = {}) {
    const row = {
      entity: evt.entity || null,
      query: String(evt.query || '').slice(0, 200),
      provider: evt.provider || evt.entity || null,
      tempo_ms: Number(evt.tempo_ms) || 0,
      cache_hit: evt.cache_hit ? 1 : 0,
      resultados: Number(evt.resultados) || 0,
      operador_id: evt.operador_id != null ? Number(evt.operador_id) : null,
      filial_id: evt.filial_id != null ? Number(evt.filial_id) : null,
      origem: evt.origem || null,
      ranking_top: evt.ranking_top != null ? Number(evt.ranking_top) : null,
      cpu_ms: evt.cpu_ms != null ? Number(evt.cpu_ms) : null,
      ram_mb: evt.ram_mb != null ? Number(evt.ram_mb) : null,
      ok: evt.ok === false ? 0 : 1
    };

    this._mem.unshift(row);
    if (this._mem.length > this._maxMem) this._mem.length = this._maxMem;

    if (!this.db) return;
    this.db.run(
      `INSERT INTO mib_search_telemetry (
        entity, query, provider, tempo_ms, cache_hit, resultados,
        operador_id, filial_id, origem, ranking_top, cpu_ms, ram_mb, ok
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.entity, row.query, row.provider, row.tempo_ms, row.cache_hit, row.resultados,
        row.operador_id, row.filial_id, row.origem, row.ranking_top, row.cpu_ms, row.ram_mb, row.ok
      ],
      () => {}
    );
  }

  snapshot() {
    const ultimas = this._mem.slice(0, 100);
    const tempos = ultimas.map((r) => r.tempo_ms).filter((n) => n >= 0);
    const avg = tempos.length
      ? Number((tempos.reduce((a, b) => a + b, 0) / tempos.length).toFixed(3))
      : 0;
    const cacheHits = ultimas.filter((r) => r.cache_hit).length;
    const porEntidade = {};
    for (const r of ultimas) {
      const e = r.entity || 'desconhecida';
      porEntidade[e] = (porEntidade[e] || 0) + 1;
    }
    const janelaMin = Math.max(1, (Date.now() - (this._inicio || Date.now())) / 60000);
    return {
      pesquisasRecentes: ultimas.length,
      tempoMedio: avg,
      cacheHits,
      cacheMiss: ultimas.length - cacheHits,
      porEntidade,
      pesquisasPorMinuto: Number((ultimas.length / janelaMin).toFixed(2)),
      amostra: ultimas.slice(0, 20)
    };
  }

  start() {
    this._inicio = Date.now();
  }

  async historico(limite = 50) {
    return new Promise((resolve) => {
      this.db.all(
        `SELECT * FROM mib_search_telemetry ORDER BY id DESC LIMIT ?`,
        [limite],
        (err, rows) => resolve(err ? this._mem.slice(0, limite) : (rows || []))
      );
    });
  }
}

module.exports = SearchTelemetry;
