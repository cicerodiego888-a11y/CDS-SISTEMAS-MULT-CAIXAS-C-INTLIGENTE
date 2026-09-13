/**
 * Métricas padronizadas dos runtimes da Plataforma Fiscal (RC1.1).
 * Sem persistência. Formato único para todos os consumidores.
 *
 * @module services/fiscal/core/FiscalRuntimeMetrics
 */

class FiscalRuntimeMetrics {
  /**
   * @param {object} [options]
   * @param {string} [options.quantityKey] Alias opcional (ex.: quantidadeCancelamentos)
   */
  constructor(options = {}) {
    this._quantityKey = options.quantityKey || null;
    this.reset();
  }

  /**
   * @param {object} result
   */
  record(result) {
    if (!result) return;
    this._total += 1;

    this._tempoResolverMs += Number(result.tempoResolverMs) || 0;
    this._tempoTransporteMs += Number(result.tempoTransporteMs) || 0;
    this._tempoSoapMs += Number(result.tempoSoapMs) || 0;
    this._tempoXmlMs += Number(result.tempoXmlMs) || 0;
    this._tempoTotalMs += Number(result.tempoTotalMs) || 0;
    this._retries += Number(result.retries) || 0;
    this._warnings += Array.isArray(result.warnings) ? result.warnings.length : 0;

    const tPlat = Number(result.tempoPlataformaMs) || 0;
    const tLeg = Number(result.tempoLegadoMs) || 0;

    if (result.fallbackUtilizado || result.source === 'FALLBACK') {
      this._fallbacks += 1;
      this._amostrasLegado += 1;
      this._tempoLegadoMs += tLeg;
      if (result.success) this._sucessosLegado += 1;
      else this._erros += 1;
      return;
    }

    this._amostrasPlataforma += 1;
    this._tempoPlataformaMs += tPlat;
    if (result.success) this._sucessosPlataforma += 1;
    else this._erros += 1;
  }

  snapshot() {
    const n = Math.max(1, this._total);
    const snap = {
      total: this._total,
      sucessosPlataforma: this._sucessosPlataforma,
      sucessosLegado: this._sucessosLegado,
      sucessos: this._sucessosPlataforma + this._sucessosLegado,
      falhas: this._erros,
      erros: this._erros,
      fallbacks: this._fallbacks,
      retries: this._retries,
      warnings: this._warnings,
      tempoMedioResolverMs: this._tempoResolverMs / n,
      tempoMedioTransporteMs: this._tempoTransporteMs / n,
      tempoMedioSoapMs: this._tempoSoapMs / n,
      tempoMedioXmlMs: this._tempoXmlMs / n,
      tempoMedioTotalMs: this._tempoTotalMs / n,
      tempoMedioPlataformaMs: this._amostrasPlataforma
        ? this._tempoPlataformaMs / this._amostrasPlataforma
        : 0,
      tempoMedioLegadoMs: this._amostrasLegado
        ? this._tempoLegadoMs / this._amostrasLegado
        : 0
    };

    if (this._quantityKey) {
      snap[this._quantityKey] = this._total;
    }

    return Object.freeze(snap);
  }

  reset() {
    this._total = 0;
    this._sucessosPlataforma = 0;
    this._sucessosLegado = 0;
    this._fallbacks = 0;
    this._erros = 0;
    this._retries = 0;
    this._warnings = 0;
    this._tempoResolverMs = 0;
    this._tempoTransporteMs = 0;
    this._tempoSoapMs = 0;
    this._tempoXmlMs = 0;
    this._tempoTotalMs = 0;
    this._tempoPlataformaMs = 0;
    this._tempoLegadoMs = 0;
    this._amostrasPlataforma = 0;
    this._amostrasLegado = 0;
  }
}

module.exports = {
  FiscalRuntimeMetrics
};
