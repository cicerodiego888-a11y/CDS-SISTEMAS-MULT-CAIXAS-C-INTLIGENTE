'use strict';

/**
 * Diagnóstico operacional do MIB.
 */
class Diagnostics {
  /**
   * @param {import('./SearchEngine')} searchEngine
   */
  constructor(searchEngine) {
    this.engine = searchEngine;
    this._inicio = Date.now();
    this._consultasJanela = [];
  }

  registrarConsulta() {
    const agora = Date.now();
    this._consultasJanela.push(agora);
    const corte = agora - 60000;
    this._consultasJanela = this._consultasJanela.filter((t) => t >= corte);
  }

  /**
   * @returns {object}
   */
  snapshot() {
    const m = this.engine.snapshotMetricas();
    const mem = process.memoryUsage();
    const uptimeSec = Math.round((Date.now() - this._inicio) / 1000);

    return {
      motor: 'MIB',
      versao: require('./version').MIB_VERSION,
      status: 'ok',
      uptimeSec,
      tempoMedioMs: m.tempoMedioMs,
      tempoMaxMs: m.tempoMaxMs,
      cacheHit: m.cache.hits,
      cacheMiss: m.cache.misses,
      cacheHitRate: m.cache.hitRate,
      produtosCarregados: m.catalogo.produtos,
      catalogoCarregadoEm: m.catalogo.carregadoEm,
      consultas: m.consultas,
      consultasSql: m.sql,
      consultasCache: m.cache.hits,
      consultasMemoria: m.memoria,
      consultasIncrementais: m.incremental,
      consultasCanceladas: m.canceladas,
      consultasPorMinuto: this._consultasJanela.length,
      usoRamMb: {
        rss: Number((mem.rss / 1024 / 1024).toFixed(1)),
        heapUsed: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
        heapTotal: Number((mem.heapTotal / 1024 / 1024).toFixed(1))
      },
      usoCpu: {
        nota: 'Node não expõe % CPU instantâneo; use heap/uptime e tempos de consulta',
        loadAvg: typeof process.loadavg === 'function' ? process.loadavg() : null
      },
      learning: m.learning
    };
  }
}

module.exports = Diagnostics;
