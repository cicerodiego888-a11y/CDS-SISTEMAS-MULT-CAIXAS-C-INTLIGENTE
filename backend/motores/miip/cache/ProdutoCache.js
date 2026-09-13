/**
 * ProdutoCache — Cache de produtos do MIIP.
 *
 * Sprint RC1: cache ativo para reduzir consultas repetidas.
 *
 * @class ProdutoCache
 */

class ProdutoCache {
  constructor() {
    /** @private @type {Map<string, import('../core/ProdutoSnapshot')>} */
    this._porGtin = new Map();

    /** @private @type {Map<number, import('../core/ProdutoSnapshot')>} */
    this._porId = new Map();

    /** @private */
    this._habilitado = true;
  }

  /**
   * @returns {boolean}
   */
  estaHabilitado() {
    return this._habilitado;
  }

  /**
   * @param {boolean} valor
   * @returns {void}
   */
  definirHabilitado(valor) {
    this._habilitado = Boolean(valor);
  }

  /**
   * @param {import('../core/ProdutoSnapshot')|null} snapshot
   * @returns {void}
   */
  armazenar(snapshot) {
    if (!this._habilitado || !snapshot) return;

    const id = Number(snapshot.id ?? snapshot.produtoId);
    if (Number.isFinite(id) && id > 0) {
      this._porId.set(id, snapshot);
    }

    const gtin = snapshot.codigoBarras ?? snapshot.codigo_barras;
    if (gtin) {
      this._porGtin.set(String(gtin), snapshot);
    }
  }

  /**
   * @param {number} id
   * @returns {import('../core/ProdutoSnapshot')|null}
   */
  buscarPorId(id) {
    if (!this._habilitado) return null;
    const produtoId = Number(id);
    if (!Number.isFinite(produtoId) || produtoId <= 0) return null;
    return this._porId.get(produtoId) ?? null;
  }

  /**
   * @param {string} gtin
   * @returns {import('../core/ProdutoSnapshot')|null}
   */
  buscarPorGtin(gtin) {
    if (!this._habilitado || !gtin) return null;
    return this._porGtin.get(String(gtin)) ?? null;
  }

  /**
   * @returns {void}
   */
  limpar() {
    this._porGtin.clear();
    this._porId.clear();
  }

  /**
   * @returns {{ porGtin: number, porId: number, habilitado: boolean }}
   */
  obterEstatisticas() {
    return {
      porGtin: this._porGtin.size,
      porId: this._porId.size,
      habilitado: this._habilitado
    };
  }
}

module.exports = new ProdutoCache();
module.exports.ProdutoCache = ProdutoCache;
