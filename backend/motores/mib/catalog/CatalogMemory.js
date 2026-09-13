'use strict';

const AtomicCatalog = require('./AtomicCatalog');

/**
 * Facade compatível RC1.0 → RC1.1 (AtomicCatalog COW).
 */
class CatalogMemory {
  /**
   * @param {import('sqlite3').Database} db
   * @param {{ logger?: object, onSwap?: Function }} [deps]
   */
  constructor(db, deps = {}) {
    this.db = db;
    this.atomic = new AtomicCatalog(db, deps);
  }

  get tamanho() {
    return this.atomic.tamanho;
  }

  get versao() {
    return this.atomic.versao;
  }

  get carregadoEm() {
    return this.atomic.ultimoRefreshEm;
  }

  get ultimoErro() {
    return this.atomic.ultimoErro;
  }

  get carregando() {
    return this.atomic._reconstruindo;
  }

  carregar(callback) {
    const cb = typeof callback === 'function' ? callback : () => {};
    this.atomic.rebuild()
      .then((r) => cb(null, r.produtos))
      .catch((err) => cb(err));
  }

  garantir() {
    return this.atomic.garantir();
  }

  rebuild() {
    return this.atomic.rebuild();
  }

  filtrar(termoNorm, opcoes) {
    return this.atomic.filtrar(termoNorm, opcoes);
  }

  upsertProduto(produto) {
    this.atomic.aplicarPatch({ upsert: produto });
  }

  remove(id) {
    this.atomic.aplicarPatch({ removeId: id });
  }

  snapshot() {
    return this.atomic.snapshot();
  }

  ativo() {
    return this.atomic.ativo();
  }
}

module.exports = CatalogMemory;
