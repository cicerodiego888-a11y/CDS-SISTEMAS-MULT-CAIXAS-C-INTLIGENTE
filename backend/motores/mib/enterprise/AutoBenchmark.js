'use strict';

/**
 * Benchmark automático por entidade (RC3.0).
 */
class AutoBenchmark {
  /**
   * @param {import('./SearchService')} searchService
   * @param {import('sqlite3').Database} db
   */
  constructor(searchService, db) {
    this.search = searchService;
    this.db = db;
    this._timer = null;
  }

  async garantirTabela() {
    return new Promise((resolve) => {
      this.db.run(
        `CREATE TABLE IF NOT EXISTS mib_search_benchmark (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity TEXT,
          amostras INTEGER,
          tempo_medio_ms REAL,
          tempo_p95_ms REAL,
          ok INTEGER DEFAULT 1,
          payload TEXT,
          criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        () => resolve()
      );
    });
  }

  /**
   * @param {string[]} [entities]
   */
  async executar(entities) {
    const alvos = entities || ['produto', 'cliente', 'fornecedor', 'financeiro', 'fiscal', 'categoria', 'marca'];
    const termos = {
      produto: ['coca', 'arroz', '10'],
      cliente: ['a', 'silva', '1'],
      fornecedor: ['a', 'ltda'],
      financeiro: ['pendente', '1'],
      fiscal: ['10', '22'],
      categoria: ['a'],
      marca: ['a']
    };
    const resultados = [];

    for (const entity of alvos) {
      const queries = termos[entity] || ['a'];
      const tempos = [];
      for (const q of queries) {
        const inicio = process.hrtime.bigint();
        try {
          await this.search.search({
            entity,
            query: q,
            limite: 10,
            origem: 'benchmark',
            skipAuth: true
          });
          const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
          tempos.push(ms);
        } catch (_) {
          tempos.push(-1);
        }
      }
      const validos = tempos.filter((t) => t >= 0);
      validos.sort((a, b) => a - b);
      const avg = validos.length
        ? Number((validos.reduce((a, b) => a + b, 0) / validos.length).toFixed(3))
        : null;
      const p95 = validos.length
        ? validos[Math.min(validos.length - 1, Math.floor(validos.length * 0.95))]
        : null;
      const row = {
        entity,
        amostras: validos.length,
        tempo_medio_ms: avg,
        tempo_p95_ms: p95 != null ? Number(p95.toFixed(3)) : null,
        ok: validos.length > 0 ? 1 : 0
      };
      resultados.push(row);
      await this._persist(row, tempos);
    }
    return { ok: true, resultados, em: new Date().toISOString() };
  }

  agendarDiario() {
    if (this._timer) clearInterval(this._timer);
    const ms = 24 * 3600 * 1000;
    this._timer = setInterval(() => {
      this.executar().catch(() => {});
    }, ms);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _persist(row, tempos) {
    return new Promise((resolve) => {
      this.db.run(
        `INSERT INTO mib_search_benchmark (entity, amostras, tempo_medio_ms, tempo_p95_ms, ok, payload)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          row.entity,
          row.amostras,
          row.tempo_medio_ms,
          row.tempo_p95_ms,
          row.ok,
          JSON.stringify({ tempos })
        ],
        () => resolve()
      );
    });
  }

  async historico(limite = 30) {
    return new Promise((resolve) => {
      this.db.all(
        `SELECT id, entity, amostras, tempo_medio_ms, tempo_p95_ms, ok, criado_em
         FROM mib_search_benchmark ORDER BY id DESC LIMIT ?`,
        [limite],
        (err, rows) => resolve(err ? [] : (rows || []))
      );
    });
  }
}

module.exports = AutoBenchmark;
