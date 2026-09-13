/**
 * Política de retry para o SoapTransport.
 * RC1.1 — backoff exponencial ativo no SoapTransport.
 *
 * delay(attempt) = min(initialDelayMs * multiplier^(attempt-1), maxDelayMs)
 * Default: 3s → 6s → 12s … (multiplier=2)
 *
 * @module services/fiscal/core/RetryPolicy
 */

class RetryPolicy {
  /**
   * @param {object} [options]
   * @param {number} [options.maxAttempts=2] Tentativas adicionais após a primeira
   * @param {number} [options.initialDelayMs=3000] Espera inicial (backoff)
   * @param {number} [options.multiplier=2] Multiplicador de backoff exponencial
   * @param {number} [options.maxDelayMs=30000] Teto de espera
   */
  constructor(options = {}) {
    this.maxAttempts = Number(options.maxAttempts) >= 0
      ? Number(options.maxAttempts)
      : 2;
    this.initialDelayMs = Number(options.initialDelayMs) > 0
      ? Number(options.initialDelayMs)
      : 3000;
    this.multiplier = Number(options.multiplier) > 0
      ? Number(options.multiplier)
      : 2;
    this.maxDelayMs = Number(options.maxDelayMs) > 0
      ? Number(options.maxDelayMs)
      : 30000;
    Object.freeze(this);
  }

  /**
   * Total de envios possíveis = 1 + maxAttempts.
   * @returns {number}
   */
  getMaxTries() {
    return this.maxAttempts + 1;
  }

  /**
   * Indica se ainda há tentativa após a atual (1-based).
   * @param {number} attempt Número da tentativa atual (1 = primeira)
   * @returns {boolean}
   */
  shouldRetry(attempt) {
    return Number(attempt) < this.getMaxTries();
  }

  /**
   * Calcula espera antes da próxima tentativa.
   * @param {number} attempt Tentativa que acabou de falhar (1-based)
   * @returns {number} ms
   */
  getDelayMs(attempt) {
    const n = Math.max(1, Number(attempt) || 1);
    const delay = this.initialDelayMs * (this.multiplier ** (n - 1));
    return Math.min(delay, this.maxDelayMs);
  }

  /**
   * Snapshot imutável.
   * @returns {Readonly<object>}
   */
  toJSON() {
    return Object.freeze({
      maxAttempts: this.maxAttempts,
      initialDelayMs: this.initialDelayMs,
      multiplier: this.multiplier,
      maxDelayMs: this.maxDelayMs,
      maxTries: this.getMaxTries()
    });
  }
}

module.exports = {
  RetryPolicy
};
