'use strict';

const { normalizarNomeBusca } = require('./core/normalizarNomeBusca');

/**
 * Benchmark automático do MIB (tamanhos sintéticos + medição real).
 */
class BenchmarkEngine {
  /**
   * @param {import('./SearchEngine')} searchEngine
   * @param {import('sqlite3').Database} db
   */
  constructor(searchEngine, db) {
    this.engine = searchEngine;
    this.db = db;
  }

  /**
   * @param {{ tamanhos?: number[], termo?: string }} [opcoes]
   */
  async executar(opcoes = {}) {
    const tamanhos = Array.isArray(opcoes.tamanhos) && opcoes.tamanhos.length
      ? opcoes.tamanhos
      : [10, 100, 1000, 10000];
    const termo = String(opcoes.termo || 'arroz').trim();
    const termoNorm = normalizarNomeBusca(termo);

    const resultados = [];

    // Medições reais no banco atual
    const t0 = process.hrtime.bigint();
    this.engine.invalidarCache();
    const primeira = await this.engine.buscar(termo, { limite: 20 });
    const t1 = process.hrtime.bigint();
    const segunda = await this.engine.buscar(termo, { limite: 20 });
    const t2 = process.hrtime.bigint();

    const sqlMs = Number(t1 - t0) / 1e6;
    const cacheMs = Number(t2 - t1) / 1e6;

    resultados.push({
      tipo: 'real',
      produtosNoCatalogo: this.engine.catalog.tamanho,
      termo,
      tempoSqlMs: Number(sqlMs.toFixed(3)),
      tempoCacheMs: Number(cacheMs.toFixed(3)),
      tempoJsonMs: 0,
      tempoHttpMs: 0,
      tempoTotalMs: Number((sqlMs + cacheMs).toFixed(3)),
      primeiraFonte: primeira.meta?.fonte,
      segundaFonte: segunda.meta?.fonte,
      resultados: primeira.itens?.length || 0
    });

    // Simulações em memória para escalabilidade
    for (const n of tamanhos) {
      if (n > 50000) {
        // evita alocar 500k em ambientes pequenos — mede amostra
      }
      const amostra = this._gerarAmostra(Math.min(n, 20000), termoNorm);
      const tA = process.hrtime.bigint();
      const filtrados = amostra.filter((p) => p.nome_busca.includes(termoNorm));
      const tB = process.hrtime.bigint();
      const json = JSON.stringify(filtrados.slice(0, 20));
      const tC = process.hrtime.bigint();

      resultados.push({
        tipo: 'sintetico',
        produtos: n,
        amostraUsada: amostra.length,
        termo,
        tempoMemoriaMs: Number((Number(tB - tA) / 1e6).toFixed(3)),
        tempoJsonMs: Number((Number(tC - tB) / 1e6).toFixed(3)),
        tempoHttpMs: null,
        tempoTotalMs: Number((Number(tC - tA) / 1e6).toFixed(3)),
        resultados: filtrados.length
      });
    }

    return {
      geradoEm: new Date().toISOString(),
      metas: {
        codigoMs: 2,
        barrasMs: 2,
        pluMs: 2,
        memoriaMs: 5,
        primeiraSqlMs: 20,
        segundaCacheMs: 2,
        cemMilMs: 30,
        quinhentosMilMs: 50
      },
      resultados
    };
  }

  _gerarAmostra(n, termoNorm) {
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const nome = i % 17 === 0
        ? `produto ${termoNorm} item ${i}`
        : `produto generico ${i}`;
      out.push({
        id: i + 1,
        nome,
        nome_busca: normalizarNomeBusca(nome)
      });
    }
    return out;
  }
}

module.exports = BenchmarkEngine;
