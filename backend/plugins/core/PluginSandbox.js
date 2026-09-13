'use strict';

const CircuitBreaker = require('./CircuitBreaker');

/**
 * Sandbox — timeout + try/catch + circuit breaker.
 * Erro em plugin nunca propaga para derrubar o processo.
 */
class PluginSandbox {
  /**
   * @param {{ timeoutMs?: number, failureThreshold?: number, cooldownMs?: number }} [opts]
   */
  constructor(opts = {}) {
    this.timeoutMs = Number(opts.timeoutMs) || 8000;
    this.breaker = new CircuitBreaker(opts);
  }

  /**
   * @param {() => Promise<any>|any} fn
   * @param {{ timeoutMs?: number }} [opts]
   */
  async run(fn, opts = {}) {
    if (!this.breaker.canExecute()) {
      const err = new Error('Circuit breaker aberto — plugin temporariamente isolado');
      err.code = 'PLUGIN_CIRCUIT_OPEN';
      throw err;
    }
    const timeoutMs = Number(opts.timeoutMs) || this.timeoutMs;
    const inicio = process.hrtime.bigint();
    let timer = null;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => fn()),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const e = new Error(`Timeout do plugin (${timeoutMs}ms)`);
            e.code = 'PLUGIN_TIMEOUT';
            reject(e);
          }, timeoutMs);
        })
      ]);
      if (timer) clearTimeout(timer);
      this.breaker.success();
      return {
        ok: true,
        result,
        tempoMs: Number(process.hrtime.bigint() - inicio) / 1e6
      };
    } catch (err) {
      if (timer) clearTimeout(timer);
      this.breaker.failure();
      return {
        ok: false,
        error: err.message || String(err),
        code: err.code || 'PLUGIN_ERROR',
        tempoMs: Number(process.hrtime.bigint() - inicio) / 1e6
      };
    }
  }

  health() {
    return {
      timeoutMs: this.timeoutMs,
      circuit: this.breaker.snapshot()
    };
  }
}

module.exports = PluginSandbox;
