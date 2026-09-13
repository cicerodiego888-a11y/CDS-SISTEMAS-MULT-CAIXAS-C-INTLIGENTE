/**
 * Sprint 14.10 — MonitorScheduler
 * Verificações periódicas (sem auto-reconexão / sem operações de negócio).
 */

'use strict';

class MonitorScheduler {
  /**
   * @param {{intervalMs?:number, enabled?:boolean, timeoutMs?:number, onTick?:Function}} [opcoes]
   */
  constructor(opcoes = {}) {
    this.intervalMs = Number(opcoes.intervalMs) || 5000;
    this.timeoutMs = Number(opcoes.timeoutMs) || 2000;
    this.enabled = opcoes.enabled !== false;
    this.onTick = typeof opcoes.onTick === 'function' ? opcoes.onTick : null;
    this._timer = null;
    this._running = false;
    this._paused = false;
    this._tickCount = 0;
  }

  get config() {
    return {
      intervalMs: this.intervalMs,
      enabled: this.enabled && !this._paused,
      timeoutMs: this.timeoutMs
    };
  }

  isRunning() {
    return this._running && !this._paused;
  }

  isPaused() {
    return this._paused;
  }

  start(opcoes = {}) {
    if (opcoes.intervalMs != null) this.intervalMs = Number(opcoes.intervalMs);
    if (opcoes.timeoutMs != null) this.timeoutMs = Number(opcoes.timeoutMs);
    if (opcoes.enabled != null) this.enabled = !!opcoes.enabled;
    if (typeof opcoes.onTick === 'function') this.onTick = opcoes.onTick;

    this.stop();
    if (!this.enabled) return { started: false, reason: 'disabled' };

    this._paused = false;
    this._running = true;
    this._timer = setInterval(() => this._tick(), this.intervalMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();

    // primeiro tick imediato (opcional)
    if (opcoes.immediate !== false) {
      setImmediate(() => this._tick());
    }

    return { started: true, intervalMs: this.intervalMs };
  }

  async _tick() {
    if (!this._running || this._paused || !this.enabled) return;
    this._tickCount += 1;
    if (!this.onTick) return;
    try {
      await this.onTick({
        tick: this._tickCount,
        timeoutMs: this.timeoutMs,
        intervalMs: this.intervalMs
      });
    } catch (_) {
      /* não derruba o scheduler */
    }
  }

  pause() {
    this._paused = true;
    return { paused: true };
  }

  resume() {
    if (!this._running) return { resumed: false, reason: 'not_running' };
    this._paused = false;
    return { resumed: true };
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._running = false;
    this._paused = false;
    return { stopped: true, ticks: this._tickCount };
  }
}

module.exports = MonitorScheduler;
module.exports.MonitorScheduler = MonitorScheduler;
