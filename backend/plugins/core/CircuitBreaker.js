'use strict';

/**
 * Circuit Breaker — isola plugins com falhas repetidas.
 */
class CircuitBreaker {
  /**
   * @param {{ failureThreshold?: number, cooldownMs?: number }} [opts]
   */
  constructor(opts = {}) {
    this.failureThreshold = Number(opts.failureThreshold) || 5;
    this.cooldownMs = Number(opts.cooldownMs) || 30000;
    this.failures = 0;
    this.openUntil = 0;
    this.state = 'closed';
  }

  canExecute() {
    if (this.state === 'open') {
      if (Date.now() >= this.openUntil) {
        this.state = 'half-open';
        return true;
      }
      return false;
    }
    return true;
  }

  success() {
    this.failures = 0;
    this.state = 'closed';
    this.openUntil = 0;
  }

  failure() {
    this.failures += 1;
    if (this.failures >= this.failureThreshold || this.state === 'half-open') {
      this.state = 'open';
      this.openUntil = Date.now() + this.cooldownMs;
    }
  }

  snapshot() {
    return {
      state: this.state,
      failures: this.failures,
      openUntil: this.openUntil || null
    };
  }
}

module.exports = CircuitBreaker;
