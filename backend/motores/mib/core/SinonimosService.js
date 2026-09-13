'use strict';

const { normalizarNomeBusca } = require('./normalizarNomeBusca');

const SEED = [
  ['refri', 'refrigerante'],
  ['bolacha', 'biscoito'],
  ['pao', 'paofrances'],
  ['macarrao', 'espaguete'],
  ['coca', 'cocacola'],
  ['guara', 'guarana'],
  [' Marginal', 'papelhigienico'],
  ['sabao', 'sabaoempo'],
  ['oleo', 'oleodesoja']
];

/**
 * Dicionário de sinônimos (manual + aprendizado automático).
 */
class SinonimosService {
  /**
   * @param {import('sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    /** @type {Map<string, Set<string>>} */
    this._map = new Map();
    this.carregado = false;
  }

  async carregar() {
    await this._garantirSeed();
    return new Promise((resolve) => {
      this.db.all(
        `SELECT termo, sinonimo, origem FROM mib_sinonimos WHERE ativo = 1`,
        [],
        (err, rows) => {
          this._map.clear();
          if (!err && rows) {
            for (const row of rows) {
              this._add(row.termo, row.sinonimo);
              this._add(row.sinonimo, row.termo);
            }
          }
          this.carregado = true;
          resolve(this._map.size);
        }
      );
    });
  }

  _add(a, b) {
    const ka = normalizarNomeBusca(a);
    const kb = normalizarNomeBusca(b);
    if (!ka || !kb || ka === kb) return;
    if (!this._map.has(ka)) this._map.set(ka, new Set());
    this._map.get(ka).add(kb);
  }

  _garantirSeed() {
    return new Promise((resolve) => {
      this.db.get(`SELECT COUNT(*) AS n FROM mib_sinonimos`, [], (err, row) => {
        if (err || (row && row.n > 0)) return resolve();
        let pend = SEED.length;
        if (!pend) return resolve();
        for (const [termo, sinonimo] of SEED) {
          this.db.run(
            `INSERT OR IGNORE INTO mib_sinonimos (termo, sinonimo, origem, ativo)
             VALUES (?, ?, 'seed', 1)`,
            [normalizarNomeBusca(termo), normalizarNomeBusca(sinonimo)],
            () => {
              pend -= 1;
              if (pend === 0) resolve();
            }
          );
        }
      });
    });
  }

  /**
   * Expande tokens com sinônimos.
   * @param {string[]} tokensNorm
   * @returns {string[]}
   */
  expandir(tokensNorm) {
    const out = new Set(tokensNorm || []);
    for (const t of tokensNorm || []) {
      const set = this._map.get(t);
      if (set) for (const s of set) out.add(s);
    }
    return [...out];
  }

  /**
   * @param {string} termo
   * @param {string} sinonimo
   * @param {string} [origem]
   */
  async cadastrar(termo, sinonimo, origem = 'manual') {
    const t = normalizarNomeBusca(termo);
    const s = normalizarNomeBusca(sinonimo);
    if (!t || !s) throw new Error('termo e sinonimo obrigatórios');
    await new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO mib_sinonimos (termo, sinonimo, origem, ativo, criado_em)
         VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(termo, sinonimo) DO UPDATE SET ativo = 1, origem = excluded.origem`,
        [t, s, origem],
        (err) => (err ? reject(err) : resolve())
      );
    });
    this._add(t, s);
    this._add(s, t);
    return { termo: t, sinonimo: s, origem };
  }

  /**
   * Aprendizado automático: associa termo pesquisado ao nome do produto escolhido (token principal).
   */
  async aprenderDeSelecao(termoBusca, nomeProduto) {
    const t = normalizarNomeBusca(termoBusca);
    const nome = normalizarNomeBusca(nomeProduto);
    if (!t || !nome || t.length < 3 || nome.startsWith(t)) return null;
    // associa termo → primeiro token significativo do produto
    const tokenProd = nome.slice(0, Math.min(nome.length, t.length + 4));
    if (tokenProd.length < 3) return null;
    try {
      return await this.cadastrar(t, tokenProd, 'aprendizado');
    } catch (_) {
      return null;
    }
  }

  listar() {
    return new Promise((resolve) => {
      this.db.all(
        `SELECT id, termo, sinonimo, origem, ativo, criado_em
         FROM mib_sinonimos ORDER BY id DESC LIMIT 500`,
        [],
        (err, rows) => resolve(err ? [] : (rows || []))
      );
    });
  }

  stats() {
    return { pares: this._map.size, carregado: this.carregado };
  }
}

module.exports = SinonimosService;
