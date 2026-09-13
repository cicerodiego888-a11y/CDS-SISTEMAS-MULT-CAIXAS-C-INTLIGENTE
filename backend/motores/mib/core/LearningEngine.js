'use strict';

const { normalizarNomeBusca } = require('./normalizarNomeBusca');

/**
 * Learning Engine 2.0 — aprendizado contínuo por operador/filial/termo.
 */
class LearningEngine {
  /**
   * @param {import('sqlite3').Database} [db]
   * @param {{ limitePreferencia?: number }} [opcoes]
   */
  constructor(db = null, opcoes = {}) {
    this.db = db;
    this.limitePreferencia = Math.max(2, Number(opcoes.limitePreferencia) || 3);

    /** @type {Map<number, number>} */
    this._selecoes = new Map();
    /** @type {Set<number>} */
    this._favoritos = new Set();
    /** @type {Set<number>} */
    this._maisVendidos = new Set();
    /** @type {Set<number>} */
    this._ultimasVendas = new Set();

    /** termoNorm|operadorId → Map(produtoId → count) */
    this._prefMem = new Map();
    /** termoNorm → count not found */
    this._notFound = new Map();
    /** termoNorm → count searches */
    this._topSearches = new Map();

    this.aprendizados = 0;
    this.correcoes = 0;
  }

  setDb(db) {
    this.db = db;
  }

  /**
   * Registra pesquisa/seleção completa.
   * @param {object} evt
   */
  async registrarEvento(evt = {}) {
    const termo = String(evt.texto || evt.termo || '').trim();
    const termoNorm = normalizarNomeBusca(termo);
    if (!termoNorm) return null;

    this._topSearches.set(termoNorm, (this._topSearches.get(termoNorm) || 0) + 1);

    const operadorId = evt.operador_id != null ? Number(evt.operador_id) : null;
    const filialId = evt.filial_id != null ? Number(evt.filial_id) : null;
    const caixaId = evt.caixa_id != null ? Number(evt.caixa_id) : null;
    const produtoId = evt.produto_id != null ? Number(evt.produto_id) : null;
    const posicao = evt.posicao != null ? Number(evt.posicao) : null;
    const tempoMs = evt.tempo_ms != null ? Number(evt.tempo_ms) : null;
    const encontrado = produtoId ? 1 : 0;

    if (!produtoId) {
      this._notFound.set(termoNorm, (this._notFound.get(termoNorm) || 0) + 1);
    } else {
      this.registrarSelecao(produtoId);
      const chavePref = `${termoNorm}|${operadorId || 0}`;
      if (!this._prefMem.has(chavePref)) this._prefMem.set(chavePref, new Map());
      const m = this._prefMem.get(chavePref);
      m.set(produtoId, (m.get(produtoId) || 0) + 1);
      if (m.get(produtoId) >= this.limitePreferencia) {
        await this._criarPreferencia(termoNorm, produtoId, operadorId, filialId, m.get(produtoId));
      }
    }

    if (!this.db) return { termoNorm, persistido: false };

    await new Promise((resolve) => {
      this.db.run(
        `INSERT INTO mib_learning (
          operador_id, filial_id, caixa_id, texto, texto_norm, produto_id,
          posicao, tempo_ms, encontrado, horario, criado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          operadorId,
          filialId,
          caixaId,
          termo.slice(0, 200),
          termoNorm,
          produtoId,
          posicao,
          tempoMs,
          encontrado,
          new Date().toISOString()
        ],
        () => resolve()
      );
    });

    return { termoNorm, produtoId, persistido: true };
  }

  _criarPreferencia(termoNorm, produtoId, operadorId, filialId, freq) {
    this.aprendizados += 1;
    if (!this.db) return Promise.resolve();
    return new Promise((resolve) => {
      this.db.run(
        `INSERT INTO mib_preferencias (termo_norm, produto_id, operador_id, filial_id, frequencia, atualizado_em)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(termo_norm, produto_id, operador_id) DO UPDATE SET
           frequencia = frequencia + 1,
           atualizado_em = CURRENT_TIMESTAMP`,
        [termoNorm, produtoId, operadorId || 0, filialId, freq || 1],
        () => resolve()
      );
    });
  }

  /**
   * Score histórico/operador/filial para um produto + termo.
   */
  scoreContextual(produtoId, termoNorm, contexto = {}) {
    const id = Number(produtoId);
    if (!id || !termoNorm) return { historico: 0, operador: 0, filial: 0 };

    let historico = 0;
    let operador = 0;
    let filial = 0;

    const chaveOp = `${termoNorm}|${contexto.operador_id || 0}`;
    const mapaOp = this._prefMem.get(chaveOp);
    if (mapaOp && mapaOp.has(id)) {
      operador = Math.min(40, (mapaOp.get(id) || 0) * 10);
    }

    const chaveGlobal = `${termoNorm}|0`;
    const mapaG = this._prefMem.get(chaveGlobal);
    if (mapaG && mapaG.has(id)) {
      historico = Math.min(50, (mapaG.get(id) || 0) * 8);
    }

    // fallback: seleções globais do produto
    const sel = this._selecoes.get(id) || 0;
    if (sel) historico = Math.max(historico, Math.min(30, sel * 3));

    if (contexto.filial_id && mapaOp) {
      filial = Math.min(30, operador > 0 ? 15 : 0);
    }

    return { historico, operador, filial };
  }

  /**
   * Preferência automática do operador para o termo.
   */
  preferenciaProduto(termoNorm, operadorId) {
    const chave = `${termoNorm}|${operadorId || 0}`;
    const mapa = this._prefMem.get(chave) || this._prefMem.get(`${termoNorm}|0`);
    if (!mapa || !mapa.size) return null;
    let best = null;
    let bestN = 0;
    for (const [pid, n] of mapa.entries()) {
      if (n > bestN) {
        bestN = n;
        best = pid;
      }
    }
    return bestN >= this.limitePreferencia ? best : null;
  }

  registrarSelecao(produtoId) {
    const id = Number(produtoId);
    if (!id) return;
    this._selecoes.set(id, (this._selecoes.get(id) || 0) + 1);
    if ((this._selecoes.get(id) || 0) >= 5) this._favoritos.add(id);
  }

  hidratarDoBanco(db, callback) {
    const cb = typeof callback === 'function' ? callback : () => {};
    const database = db || this.db;
    if (!database) return cb(null);
    this.db = database;

    const sqlMais = `
      SELECT vi.produto_id AS id, SUM(vi.quantidade) AS qtd
      FROM vendas_itens vi
      INNER JOIN vendas v ON v.id = vi.venda_id
      WHERE COALESCE(v.cancelada, 0) = 0
        AND date(v.data_venda) >= date('now', '-30 day')
      GROUP BY vi.produto_id
      ORDER BY qtd DESC
      LIMIT 50
    `;
    const sqlUltimas = `
      SELECT DISTINCT vi.produto_id AS id
      FROM vendas_itens vi
      INNER JOIN vendas v ON v.id = vi.venda_id
      WHERE COALESCE(v.cancelada, 0) = 0
      ORDER BY v.id DESC
      LIMIT 30
    `;

    database.all(sqlMais, [], (err, rows) => {
      if (!err && rows) {
        this._maisVendidos = new Set(rows.map((r) => Number(r.id)).filter(Boolean));
      }
      database.all(sqlUltimas, [], (err2, rows2) => {
        if (!err2 && rows2) {
          this._ultimasVendas = new Set(rows2.map((r) => Number(r.id)).filter(Boolean));
        }
        this._hidratarPreferencias(database, () => cb(err || err2 || null));
      });
    });
  }

  _hidratarPreferencias(db, cb) {
    db.all(
      `SELECT termo_norm, produto_id, operador_id, frequencia
       FROM mib_preferencias
       ORDER BY frequencia DESC
       LIMIT 2000`,
      [],
      (err, rows) => {
        if (!err && rows) {
          for (const row of rows) {
            const chave = `${row.termo_norm}|${row.operador_id || 0}`;
            if (!this._prefMem.has(chave)) this._prefMem.set(chave, new Map());
            this._prefMem.get(chave).set(Number(row.produto_id), Number(row.frequencia) || 1);
            this.aprendizados += 1;
          }
        }
        cb();
      }
    );
  }

  isFavorito(id) { return this._favoritos.has(Number(id)); }
  isMaisVendido(id) { return this._maisVendidos.has(Number(id)); }
  isUltimaVenda(id) { return this._ultimasVendas.has(Number(id)); }

  async resetLearning() {
    this._selecoes.clear();
    this._favoritos.clear();
    this._prefMem.clear();
    this._notFound.clear();
    this._topSearches.clear();
    this.aprendizados = 0;
    if (!this.db) return { ok: true };
    await Promise.all([
      new Promise((r) => this.db.run(`DELETE FROM mib_learning`, () => r())),
      new Promise((r) => this.db.run(`DELETE FROM mib_preferencias`, () => r()))
    ]);
    return { ok: true };
  }

  async retrain() {
    if (!this.db) return { ok: false };
    this._prefMem.clear();
    this.aprendizados = 0;
    await new Promise((resolve) => {
      this.db.all(
        `SELECT texto_norm, produto_id, operador_id, COUNT(*) AS n
         FROM mib_learning
         WHERE produto_id IS NOT NULL AND encontrado = 1
         GROUP BY texto_norm, produto_id, operador_id
         HAVING n >= ?`,
        [this.limitePreferencia],
        (err, rows) => {
          if (!err && rows) {
            for (const row of rows) {
              this._criarPreferencia(
                row.texto_norm,
                row.produto_id,
                row.operador_id,
                null,
                row.n
              );
              const chave = `${row.texto_norm}|${row.operador_id || 0}`;
              if (!this._prefMem.has(chave)) this._prefMem.set(chave, new Map());
              this._prefMem.get(chave).set(Number(row.produto_id), Number(row.n));
            }
          }
          resolve();
        }
      );
    });
    return { ok: true, preferencias: this._prefMem.size };
  }

  topSearches(limite = 20) {
    return [...this._topSearches.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limite)
      .map(([termo, count]) => ({ termo, count }));
  }

  notFound(limite = 20) {
    return [...this._notFound.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limite)
      .map(([termo, count]) => ({ termo, count }));
  }

  stats() {
    return {
      selecoes: this._selecoes.size,
      favoritos: this._favoritos.size,
      maisVendidos: this._maisVendidos.size,
      ultimasVendas: this._ultimasVendas.size,
      preferencias: this._prefMem.size,
      aprendizados: this.aprendizados,
      correcoes: this.correcoes,
      topSearches: this._topSearches.size,
      notFound: this._notFound.size
    };
  }
}

module.exports = LearningEngine;
