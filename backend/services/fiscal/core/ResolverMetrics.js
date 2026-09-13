/**
 * Métricas locais do UrlResolver (sem persistência).
 *
 * @module services/fiscal/core/ResolverMetrics
 */

class ResolverMetrics {
  constructor() {
    this._total = 0;
    this._success = 0;
    this._failures = 0;
    this._warnings = 0;
    this._totalExecutionTimeMs = 0;
    this._bySource = Object.create(null);
  }

  /**
   * Registra um ResolutionResult.
   * @param {import('./ResolutionResult').ResolutionResult|object} result
   */
  record(result) {
    if (!result) return;

    this._total += 1;
    const elapsed = Number(result.executionTime) || 0;
    this._totalExecutionTimeMs += elapsed;

    if (result.success) {
      this._success += 1;
    } else {
      this._failures += 1;
    }

    const warningCount = Array.isArray(result.warnings) ? result.warnings.length : 0;
    this._warnings += warningCount;

    if (result.source) {
      this._bySource[result.source] = (this._bySource[result.source] || 0) + 1;
    }
  }

  /**
   * @returns {number}
   */
  getTotal() {
    return this._total;
  }

  /**
   * @returns {number}
   */
  getSuccessCount() {
    return this._success;
  }

  /**
   * @returns {number}
   */
  getFailureCount() {
    return this._failures;
  }

  /**
   * @returns {number}
   */
  getWarningCount() {
    return this._warnings;
  }

  /**
   * Tempo médio em ms (0 se ainda não houve resoluções).
   * @returns {number}
   */
  getAverageExecutionTime() {
    if (this._total === 0) return 0;
    return this._totalExecutionTimeMs / this._total;
  }

  /**
   * Snapshot imutável.
   * @returns {Readonly<object>}
   */
  snapshot() {
    return Object.freeze({
      total: this._total,
      success: this._success,
      failures: this._failures,
      warnings: this._warnings,
      averageExecutionTimeMs: this.getAverageExecutionTime(),
      bySource: Object.freeze({ ...this._bySource })
    });
  }

  /**
   * Zera contadores (útil em testes).
   */
  reset() {
    this._total = 0;
    this._success = 0;
    this._failures = 0;
    this._warnings = 0;
    this._totalExecutionTimeMs = 0;
    this._bySource = Object.create(null);
  }
}

module.exports = {
  ResolverMetrics
};
