'use strict';

const DEFAULTS = Object.freeze({
  tempoRefreshMs: 400,
  limiteCache: 300,
  limiteRamMb: 512,
  hotCacheSize: 100,
  ativarAtualizacaoAutomatica: true,
  ativarEstatisticas: true,
  ativarBenchmark: true,
  modoDesenvolvimento: false,
  benchmarkIntervaloHoras: 24,
  // RC2.0 — cognitivo
  ativarAprendizado: true,
  ativarFuzzy: true,
  ativarSinonimos: true,
  ativarAutoCorrecao: true,
  sensibilidadeLevenshtein: 2,
  limiteHistorico: 5000,
  tempoRetencaoDias: 180,
  limitePreferencia: 3
});

/**
 * Configurações MIB (persistidas em mib_config).
 */
class MibConfig {
  /**
   * @param {import('sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this._valores = { ...DEFAULTS };
  }

  get(chave) {
    return this._valores[chave] !== undefined ? this._valores[chave] : DEFAULTS[chave];
  }

  snapshot() {
    return { ...this._valores };
  }

  /**
   * @returns {Promise<object>}
   */
  carregar() {
    return new Promise((resolve) => {
      this.db.all(`SELECT chave, valor FROM mib_config`, [], (err, rows) => {
        if (err || !rows) {
          resolve(this.snapshot());
          return;
        }
        for (const row of rows) {
          const def = DEFAULTS[row.chave];
          if (def === undefined) continue;
          let valor = row.valor;
          if (typeof def === 'boolean') valor = valor === '1' || valor === 'true';
          else if (typeof def === 'number') valor = Number(valor);
          this._valores[row.chave] = valor;
        }
        resolve(this.snapshot());
      });
    });
  }

  /**
   * @param {object} patch
   * @returns {Promise<object>}
   */
  salvar(patch = {}) {
    const entradas = Object.entries(patch).filter(([k]) => DEFAULTS[k] !== undefined);
    return new Promise((resolve, reject) => {
      if (!entradas.length) return resolve(this.snapshot());
      let pendentes = entradas.length;
      for (const [chave, valor] of entradas) {
        this._valores[chave] = valor;
        const texto = typeof valor === 'boolean' ? (valor ? '1' : '0') : String(valor);
        this.db.run(
          `INSERT INTO mib_config (chave, valor, atualizado_em)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = CURRENT_TIMESTAMP`,
          [chave, texto],
          (err) => {
            if (err) return reject(err);
            pendentes -= 1;
            if (pendentes === 0) resolve(this.snapshot());
          }
        );
      }
    });
  }
}

MibConfig.DEFAULTS = DEFAULTS;

module.exports = MibConfig;
