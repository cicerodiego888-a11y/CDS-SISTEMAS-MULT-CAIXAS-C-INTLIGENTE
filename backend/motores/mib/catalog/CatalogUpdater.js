'use strict';

/**
 * Agenda refresh do catálogo em background (debounce).
 * Nunca bloqueia o request do usuário.
 */
class CatalogUpdater {
  /**
   * @param {import('./CatalogMemory')} catalog
   * @param {{
   *   debounceMs?: number,
   *   logger?: object,
   *   onUpdated?: Function,
   *   invalidarCache?: Function
   * }} [deps]
   */
  constructor(catalog, deps = {}) {
    this.catalog = catalog;
    this.debounceMs = Math.max(50, Number(deps.debounceMs) || 400);
    this.logger = deps.logger || null;
    this.onUpdated = typeof deps.onUpdated === 'function' ? deps.onUpdated : null;
    this.invalidarCache = typeof deps.invalidarCache === 'function' ? deps.invalidarCache : null;
    this._timer = null;
    this._pendente = null;
    this._motivo = null;
    this.refreshAgendados = 0;
    this.refreshExecutados = 0;
  }

  setDebounceMs(ms) {
    this.debounceMs = Math.max(50, Number(ms) || 400);
  }

  /**
   * @param {{ motivo?: string, full?: boolean, patch?: object }} [opcoes]
   * @returns {Promise<object|null>}
   */
  scheduleRefresh(opcoes = {}) {
    this.refreshAgendados += 1;
    this._motivo = opcoes.motivo || 'scheduleRefresh';

    // Patch imediato opcional (COW leve) + full rebuild debounced
    if (opcoes.patch) {
      try {
        if (opcoes.patch.removeId != null) this.catalog.remove(opcoes.patch.removeId);
        else if (opcoes.patch.upsert) this.catalog.upsertProduto(opcoes.patch.upsert);
        if (this.invalidarCache) this.invalidarCache();
      } catch (err) {
        if (this.logger) this.logger.warn('catalog_patch', { erro: err.message });
      }
    }

    if (this._timer) clearTimeout(this._timer);

    if (!this._pendente) {
      this._pendente = new Promise((resolve, reject) => {
        this._resolve = resolve;
        this._reject = reject;
      });
    }

    this._timer = setTimeout(() => {
      this._timer = null;
      const motivo = this._motivo;
      this.refreshExecutados += 1;
      const inicio = Date.now();
      this.catalog.rebuild()
        .then((result) => {
          if (this.invalidarCache) this.invalidarCache();
          if (this.logger) {
            this.logger.info('refresh', {
              motivo,
              tempoMs: result.tempoMs,
              versao: result.versao,
              tamanho: result.produtos
            });
          }
          if (this.onUpdated) {
            try { this.onUpdated({ ...result, motivo }); } catch (_) { /* ignore */ }
          }
          if (this._resolve) this._resolve(result);
        })
        .catch((err) => {
          if (this.logger) this.logger.error('catalog_refresh', { erro: err.message, motivo });
          if (this._reject) this._reject(err);
        })
        .finally(() => {
          this._pendente = null;
          this._resolve = null;
          this._reject = null;
          this._motivo = null;
        });
      // evitar unused
      void inicio;
    }, this.debounceMs);

    return this._pendente;
  }

  stats() {
    return {
      debounceMs: this.debounceMs,
      refreshAgendados: this.refreshAgendados,
      refreshExecutados: this.refreshExecutados,
      pendente: Boolean(this._pendente)
    };
  }
}

module.exports = CatalogUpdater;
