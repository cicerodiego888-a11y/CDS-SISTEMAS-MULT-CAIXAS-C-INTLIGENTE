/**
 * Sprint 15.4 — ToledoRetryPolicy
 * Tentativa 1 → 2 → 3 → abortar lote. Nunca reenvia lotes já confirmados.
 */

'use strict';

const DEFAULTS = Object.freeze({
  maxAttempts: 3,
  backoffMs: [0, 200, 500]
});

class ToledoRetryPolicy {
  /**
   * @param {{maxAttempts?:number, backoffMs?:number[]}} [opcoes]
   */
  constructor(opcoes = {}) {
    this.maxAttempts = Math.max(1, Number(opcoes.maxAttempts) || DEFAULTS.maxAttempts);
    this.backoffMs = Array.isArray(opcoes.backoffMs) && opcoes.backoffMs.length
      ? opcoes.backoffMs.map((n) => Math.max(0, Number(n) || 0))
      : DEFAULTS.backoffMs.slice();
  }

  /** @returns {boolean} */
  podeTentar(tentativaAtual /* 1-based após falha */) {
    return Number(tentativaAtual) < this.maxAttempts;
  }

  delayMs(tentativa /* 0-based index da próxima tentativa */) {
    const i = Math.max(0, Number(tentativa) || 0);
    if (i < this.backoffMs.length) return this.backoffMs[i];
    return this.backoffMs[this.backoffMs.length - 1] || 0;
  }

  async sleep(ms) {
    const t = Math.max(0, Number(ms) || 0);
    if (!t) return;
    await new Promise((r) => setTimeout(r, t));
  }

  /**
   * Executa fn com retries. Não chama fn se alreadyConfirmed.
   * @param {Function} fn — async () => result
   * @param {{alreadyConfirmed?:boolean, onRetry?:Function, isSuccess?:Function, isAbort?:Function}} [ctx]
   */
  async execute(fn, ctx = {}) {
    if (ctx.alreadyConfirmed) {
      return { success: true, skipped: true, reason: 'already_confirmed', attempts: 0 };
    }
    const isSuccess = typeof ctx.isSuccess === 'function'
      ? ctx.isSuccess
      : ((r) => r && (r.sucesso === true || r.success === true || r.ok === true));
    const isAbort = typeof ctx.isAbort === 'function' ? ctx.isAbort : (() => false);

    let lastError = null;
    let lastResult = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (isAbort()) {
        return {
          success: false,
          aborted: true,
          attempts: attempt - 1,
          error: lastError,
          result: lastResult
        };
      }

      if (attempt > 1) {
        await this.sleep(this.delayMs(attempt - 1));
        if (typeof ctx.onRetry === 'function') {
          try {
            ctx.onRetry({ attempt, maxAttempts: this.maxAttempts, error: lastError });
          } catch (_) { /* ignore */ }
        }
      }

      try {
        const result = await fn({ attempt, maxAttempts: this.maxAttempts });
        lastResult = result;
        if (isSuccess(result)) {
          return { success: true, result, attempts: attempt, confirmed: true };
        }
        lastError = result?.erro || result?.error || new Error('Resposta sem sucesso');
      } catch (err) {
        lastError = err;
        if (!this.podeTentar(attempt)) break;
      }
    }

    return {
      success: false,
      result: lastResult,
      error: lastError,
      attempts: this.maxAttempts,
      aborted: false
    };
  }
}

module.exports = ToledoRetryPolicy;
module.exports.ToledoRetryPolicy = ToledoRetryPolicy;
module.exports.DEFAULTS = DEFAULTS;
