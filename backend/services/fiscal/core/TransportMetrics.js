/**
 * Métricas locais do SoapTransport (sem persistência).
 *
 * @module services/fiscal/core/TransportMetrics
 */

class TransportMetrics {
  constructor() {
    this._total = 0;
    this._success = 0;
    this._failures = 0;
    this._timeouts = 0;
    this._retries = 0;
    this._totalTempoMs = 0;
  }

  /**
   * @param {import('./TransportResponse').TransportResponse|object} response
   * @param {{ retries?: number, timeout?: boolean }} [meta]
   */
  record(response, meta = {}) {
    if (!response) return;

    this._total += 1;
    const tempo = Number(response.tempo) || 0;
    this._totalTempoMs += tempo;

    if (response.success) {
      this._success += 1;
    } else {
      this._failures += 1;
    }

    if (meta.timeout || response.status === 'timeout') {
      this._timeouts += 1;
    }

    const retries = Number(meta.retries);
    if (Number.isFinite(retries) && retries > 0) {
      this._retries += retries;
    } else if (Number(response.attempts) > 1) {
      this._retries += Number(response.attempts) - 1;
    }
  }

  getTotal() {
    return this._total;
  }

  getSuccessCount() {
    return this._success;
  }

  getFailureCount() {
    return this._failures;
  }

  getTimeoutCount() {
    return this._timeouts;
  }

  getRetryCount() {
    return this._retries;
  }

  /**
   * Tempo médio em ms.
   * @returns {number}
   */
  getAverageTempo() {
    if (this._total === 0) return 0;
    return this._totalTempoMs / this._total;
  }

  /**
   * @returns {Readonly<object>}
   */
  snapshot() {
    return Object.freeze({
      total: this._total,
      success: this._success,
      failures: this._failures,
      timeouts: this._timeouts,
      retries: this._retries,
      averageTempoMs: this.getAverageTempo()
    });
  }

  reset() {
    this._total = 0;
    this._success = 0;
    this._failures = 0;
    this._timeouts = 0;
    this._retries = 0;
    this._totalTempoMs = 0;
  }
}

module.exports = {
  TransportMetrics
};
