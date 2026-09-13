/**
 * Métricas internas do MIP V1 (Sprint 08) — prontas para monitoramento futuro.
 * Contadores em memória (processo). Sem I/O.
 * @module motores/produto-identidade/observability/MipMetrics
 */

class MipMetrics {
  constructor() {
    this.reset();
  }

  reset() {
    this._resolucoes = 0;
    this._encontrados = 0;
    this._naoEncontrados = 0;
    this._desabilitados = 0;
    this._fallbacks = 0;
    this._erros = 0;
    this._porMetodo = Object.create(null);
    this._porStrategy = Object.create(null);
    this._tempoTotalMs = 0;
    this._tempoMaxMs = 0;
    this._tempoMinMs = null;
    this._amostrasTempo = 0;
  }

  /**
   * @param {Object} evt
   * @param {boolean} [evt.habilitado]
   * @param {boolean} [evt.encontrado]
   * @param {string|null} [evt.metodo]
   * @param {string|null} [evt.strategy]
   * @param {number} [evt.tempoMs]
   * @param {boolean} [evt.fallback]
   * @param {boolean} [evt.erro]
   */
  registrar(evt = {}) {
    if (evt.erro) {
      this._erros += 1;
      return;
    }

    if (evt.habilitado === false) {
      this._desabilitados += 1;
      return;
    }

    this._resolucoes += 1;

    if (evt.encontrado) this._encontrados += 1;
    else this._naoEncontrados += 1;

    if (evt.fallback) this._fallbacks += 1;

    const metodo = evt.metodo || 'DESCONHECIDO';
    this._porMetodo[metodo] = (this._porMetodo[metodo] || 0) + 1;

    if (evt.strategy) {
      this._porStrategy[evt.strategy] = (this._porStrategy[evt.strategy] || 0) + 1;
    }

    const t = Number(evt.tempoMs);
    if (Number.isFinite(t) && t >= 0) {
      this._tempoTotalMs += t;
      this._amostrasTempo += 1;
      if (t > this._tempoMaxMs) this._tempoMaxMs = t;
      if (this._tempoMinMs == null || t < this._tempoMinMs) this._tempoMinMs = t;
    }
  }

  /**
   * Snapshot para observabilidade / API futura.
   */
  snapshot() {
    const media = this._amostrasTempo > 0
      ? this._tempoTotalMs / this._amostrasTempo
      : 0;

    return {
      resolucoes: this._resolucoes,
      encontrados: this._encontrados,
      naoEncontrados: this._naoEncontrados,
      desabilitados: this._desabilitados,
      fallbacks: this._fallbacks,
      erros: this._erros,
      porMetodo: { ...this._porMetodo },
      porStrategy: { ...this._porStrategy },
      plu: this._porMetodo.PLU || this._porStrategy.PLU || 0,
      ean13: this._porMetodo.EAN13 || this._porStrategy.EAN13 || 0,
      gtin: this._porMetodo.GTIN || this._porStrategy.GTIN || 0,
      etiquetaBalanca: this._porStrategy.ETIQUETA_BALANCA || 0,
      tempoMedioMs: Number(media.toFixed(3)),
      tempoMaxMs: Number(this._tempoMaxMs.toFixed(3)),
      tempoMinMs: this._tempoMinMs == null ? null : Number(this._tempoMinMs.toFixed(3)),
      amostrasTempo: this._amostrasTempo
    };
  }
}

const mipMetrics = new MipMetrics();

module.exports = mipMetrics;
module.exports.MipMetrics = MipMetrics;
