'use strict';

/**
 * Analytics operacional do MIB RC2.0.
 */
class AnalyticsEngine {
  /**
   * @param {import('sqlite3').Database} db
   * @param {{
   *   learning: import('../core/LearningEngine'),
   *   sinonimos: import('../core/SinonimosService'),
   *   engine: import('../SearchEngine'),
   *   stats: import('./StatisticsEngine')
   * }} deps
   */
  constructor(db, deps) {
    this.db = db;
    this.learning = deps.learning;
    this.sinonimos = deps.sinonimos;
    this.engine = deps.engine;
    this.stats = deps.stats;
  }

  async analytics() {
    const m = this.engine.snapshotMetricas();
    const st = this.stats.snapshot();
    const learn = this.learning.stats();
    const top = await this.topSearches(10);
    const nf = await this.notFound(10);
    const sinonimos = await this.sinonimos.listar();

    const totalSel = await this._count(`SELECT COUNT(*) AS n FROM mib_learning WHERE encontrado = 1`);
    const totalBuscas = await this._count(`SELECT COUNT(*) AS n FROM mib_learning`);
    const taxaAcerto = totalBuscas > 0
      ? Number(((totalSel / totalBuscas) * 100).toFixed(1))
      : 0;

    return {
      topPesquisas: top,
      produtosNaoEncontrados: nf,
      tempoMedio: st.tempoMedioMs,
      taxaAcerto,
      rankingOperadores: await this._rankingOperadores(),
      rankingFiliais: await this._rankingFiliais(),
      cacheHit: m.cache.hits,
      cacheMiss: m.cache.misses,
      hotCacheHit: m.hotCache.hits,
      aprendizados: learn.aprendizados,
      preferencias: learn.preferencias,
      sinonimosCriados: sinonimos.length,
      correcoesAutomaticas: learn.correcoes,
      catalogVersion: this.engine.catalog.versao,
      catalogSize: this.engine.catalog.tamanho
    };
  }

  async topSearches(limite = 20) {
    const mem = this.learning.topSearches(limite);
    const dbRows = await new Promise((resolve) => {
      this.db.all(
        `SELECT texto_norm AS termo, COUNT(*) AS count
         FROM mib_learning
         GROUP BY texto_norm
         ORDER BY count DESC
         LIMIT ?`,
        [limite],
        (err, rows) => resolve(err ? [] : (rows || []))
      );
    });
    if (dbRows.length) return dbRows;
    return mem;
  }

  async notFound(limite = 20) {
    const dbRows = await new Promise((resolve) => {
      this.db.all(
        `SELECT texto_norm AS termo, COUNT(*) AS count
         FROM mib_learning
         WHERE encontrado = 0 OR produto_id IS NULL
         GROUP BY texto_norm
         ORDER BY count DESC
         LIMIT ?`,
        [limite],
        (err, rows) => resolve(err ? [] : (rows || []))
      );
    });
    if (dbRows.length) return dbRows;
    return this.learning.notFound(limite);
  }

  async learning(limite = 50) {
    return new Promise((resolve) => {
      this.db.all(
        `SELECT id, operador_id, filial_id, caixa_id, texto, texto_norm, produto_id,
                posicao, tempo_ms, encontrado, horario, criado_em
         FROM mib_learning
         ORDER BY id DESC
         LIMIT ?`,
        [limite],
        (err, rows) => resolve(err ? [] : (rows || []))
      );
    });
  }

  _rankingOperadores() {
    return new Promise((resolve) => {
      this.db.all(
        `SELECT operador_id, COUNT(*) AS pesquisas,
                SUM(CASE WHEN encontrado = 1 THEN 1 ELSE 0 END) AS acertos
         FROM mib_learning
         WHERE operador_id IS NOT NULL
         GROUP BY operador_id
         ORDER BY pesquisas DESC
         LIMIT 20`,
        [],
        (err, rows) => resolve(err ? [] : (rows || []))
      );
    });
  }

  _rankingFiliais() {
    return new Promise((resolve) => {
      this.db.all(
        `SELECT filial_id, COUNT(*) AS pesquisas,
                SUM(CASE WHEN encontrado = 1 THEN 1 ELSE 0 END) AS acertos
         FROM mib_learning
         WHERE filial_id IS NOT NULL
         GROUP BY filial_id
         ORDER BY pesquisas DESC
         LIMIT 20`,
        [],
        (err, rows) => resolve(err ? [] : (rows || []))
      );
    });
  }

  _count(sql) {
    return new Promise((resolve) => {
      this.db.get(sql, [], (err, row) => resolve(err ? 0 : Number(row?.n || 0)));
    });
  }
}

module.exports = AnalyticsEngine;
