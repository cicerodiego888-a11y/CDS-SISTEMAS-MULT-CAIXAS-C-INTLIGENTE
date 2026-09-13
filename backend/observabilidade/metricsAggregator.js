'use strict';

/**
 * RC12.2 — Agregadores estatísticos em memória (sem persistência).
 * @module observabilidade/metricsAggregator
 */

function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

/**
 * @param {number[]} values
 * @returns {{ count: number, min: number|null, max: number|null, avg: number|null, p50: number|null, p95: number|null }}
 */
function aggregate(values) {
  const nums = (values || [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (!nums.length) {
    return { count: 0, min: null, max: null, avg: null, p50: null, p95: null };
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, n) => acc + n, 0);
  return {
    count: sorted.length,
    min: Number(sorted[0].toFixed(3)),
    max: Number(sorted[sorted.length - 1].toFixed(3)),
    avg: Number((sum / sorted.length).toFixed(3)),
    p50: Number(percentile(sorted, 50).toFixed(3)),
    p95: Number(percentile(sorted, 95).toFixed(3))
  };
}

/**
 * Janela deslizante por chave.
 * @param {{ maxSamples?: number }} [opts]
 */
function createMetricsStore(opts = {}) {
  const maxSamples = Math.max(20, Number(opts.maxSamples) || 500);
  /** @type {Map<string, number[]>} */
  const series = new Map();
  /** @type {Map<string, number>} */
  const counters = new Map();

  function push(key, value) {
    if (!key) return;
    if (Number.isFinite(Number(value))) {
      if (!series.has(key)) series.set(key, []);
      const arr = series.get(key);
      arr.push(Number(value));
      if (arr.length > maxSamples) arr.splice(0, arr.length - maxSamples);
    }
    counters.set(key, (counters.get(key) || 0) + 1);
  }

  function increment(key, by = 1) {
    counters.set(key, (counters.get(key) || 0) + Number(by || 1));
  }

  function stats(key) {
    return aggregate(series.get(key) || []);
  }

  function count(key) {
    return counters.get(key) || 0;
  }

  function snapshot(prefix) {
    const out = {};
    for (const key of series.keys()) {
      if (prefix && !String(key).startsWith(prefix)) continue;
      out[key] = {
        ...stats(key),
        events: count(key)
      };
    }
    for (const [key, c] of counters.entries()) {
      if (prefix && !String(key).startsWith(prefix)) continue;
      if (!out[key]) {
        out[key] = { count: 0, min: null, max: null, avg: null, p50: null, p95: null, events: c };
      }
    }
    return out;
  }

  function clear() {
    series.clear();
    counters.clear();
  }

  return { push, increment, stats, count, snapshot, clear, aggregate };
}

module.exports = {
  aggregate,
  percentile,
  createMetricsStore
};
