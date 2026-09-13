'use strict';

const CatalogSnapshot = require('../catalog/CatalogSnapshot');
const { produtoCasaFraseBusca } = require('../core/compararTextoBusca');

/**
 * HotCache — produtos quentes em memória (mais vendidos, pesquisados, últimos, favoritos).
 */
class HotCache {
  /**
   * @param {{ size?: number }} [opcoes]
   */
  constructor(opcoes = {}) {
    this.size = Math.max(10, Number(opcoes.size) || 100);
    /** @type {Map<number, object>} */
    this._byId = new Map();
    /** @type {Set<number>} */
    this._protegidos = new Set();
    this.hits = 0;
    this.misses = 0;
    this.reconstruidoEm = null;
  }

  get tamanho() {
    return this._byId.size;
  }

  idsProtegidos() {
    return new Set(this._protegidos);
  }

  /**
   * Busca exata/parcial no hot set.
   * @param {string} termoNorm
   * @param {string} termoRaw
   * @param {{ limite?: number, modoFiscal?: boolean }} [opcoes]
   */
  buscar(termoNorm, termoRaw, opcoes = {}) {
    const termo = String(termoNorm || termoRaw || '').toLowerCase();
    if (!termo) {
      this.misses += 1;
      return [];
    }
    const limite = Math.min(Math.max(Number(opcoes.limite) || 20, 1), 50);
    const modoFiscal = opcoes.modoFiscal === true;
    const out = [];
    const raw = String(termoRaw || '').toLowerCase();
    // RC14.15.15 — termo só dígitos: identificador EXATO (sem includes)
    const soDigitos = /^\d+$/.test(String(termoRaw || '').trim())
      || /^\d+$/.test(String(termoNorm || '').trim());

    for (const p of this._byId.values()) {
      if (modoFiscal && Number(p.item_fiscal) !== 1) continue;
      const codigo = String(p.codigo || '').toLowerCase();
      const barras = String(p.codigo_barras || '').toLowerCase();
      const plu = String(p.plu || '').toLowerCase();
      const nb = String(p.nome_busca || '');
      let ok = false;
      if (soDigitos) {
        ok = CatalogSnapshot.idsNumericosIguais(codigo, raw)
          || CatalogSnapshot.idsNumericosIguais(barras, raw)
          || CatalogSnapshot.idsNumericosIguais(plu, raw)
          || codigo === raw || barras === raw || plu === raw;
      } else {
        ok = codigo === raw || barras === raw || plu === raw
          || nb.startsWith(termo) || produtoCasaFraseBusca(p, termo)
          || codigo.includes(termo) || barras.includes(termo);
      }
      if (ok) {
        out.push({
          ...p,
          preco_venda: p.preco,
          match_exato: (CatalogSnapshot.idsNumericosIguais(codigo, raw)
            || CatalogSnapshot.idsNumericosIguais(barras, raw)
            || CatalogSnapshot.idsNumericosIguais(plu, raw)
            || codigo === raw || barras === raw || plu === raw) ? 1 : 0,
          _fonte: 'hotcache'
        });
        if (out.length >= limite) break;
      }
    }

    if (out.length) this.hits += 1;
    else this.misses += 1;
    return out;
  }

  /**
   * @param {import('sqlite3').Database} db
   * @param {import('../catalog/CatalogMemory')} catalog
   * @param {import('../core/LearningEngine')} learning
   * @param {import('./AdaptiveCache')|null} [searchStats]
   */
  async rebuild(db, catalog, learning, searchStats = null) {
    const size = this.size;
    const ids = new Set();

    const maisVendidos = await this._queryIds(db, `
      SELECT vi.produto_id AS id, SUM(vi.quantidade) AS qtd
      FROM vendas_itens vi
      INNER JOIN vendas v ON v.id = vi.venda_id
      WHERE COALESCE(v.cancelada, 0) = 0
        AND date(v.data_venda) >= date('now', '-60 day')
      GROUP BY vi.produto_id
      ORDER BY qtd DESC
      LIMIT ?
    `, [size]);

    const ultimos = await this._queryIds(db, `
      SELECT DISTINCT vi.produto_id AS id
      FROM vendas_itens vi
      INNER JOIN vendas v ON v.id = vi.venda_id
      WHERE COALESCE(v.cancelada, 0) = 0
      ORDER BY v.id DESC
      LIMIT ?
    `, [size]);

    for (const id of maisVendidos) ids.add(id);
    for (const id of ultimos) ids.add(id);

    if (learning) {
      for (const id of learning._favoritos || []) ids.add(Number(id));
      for (const id of learning._maisVendidos || []) ids.add(Number(id));
      for (const id of learning._ultimasVendas || []) ids.add(Number(id));
    }

    if (searchStats && typeof searchStats.topKeys === 'function') {
      // ids embutidos em meta dos caches — ignorar se não houver
    }

    // Top pesquisados via learning seleções
    if (learning && learning._selecoes) {
      const ordenados = [...learning._selecoes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, size);
      for (const [id] of ordenados) ids.add(Number(id));
    }

    await catalog.garantir();
    const byId = new Map();
    const protegidos = new Set();
    for (const id of ids) {
      const item = catalog.atomic
        ? catalog.atomic.get(id)
        : (catalog.ativo ? catalog.ativo().get(id) : null);
      if (item) {
        byId.set(id, item);
        protegidos.add(id);
        if (byId.size >= size * 4) break;
      }
    }

    this._byId = byId;
    this._protegidos = protegidos;
    this.reconstruidoEm = new Date().toISOString();
    return { produtos: byId.size, em: this.reconstruidoEm };
  }

  _queryIds(db, sql, params) {
    return new Promise((resolve) => {
      db.all(sql, params, (err, rows) => {
        if (err || !rows) return resolve([]);
        resolve(rows.map((r) => Number(r.id)).filter(Boolean));
      });
    });
  }

  stats() {
    return {
      tamanho: this._byId.size,
      max: this.size * 4,
      hits: this.hits,
      misses: this.misses,
      protegidos: this._protegidos.size,
      reconstruidoEm: this.reconstruidoEm
    };
  }
}

module.exports = HotCache;
