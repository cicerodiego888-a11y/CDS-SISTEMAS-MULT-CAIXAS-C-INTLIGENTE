'use strict';

/**
 * RC12.2 — Sampler periódico de recursos do processo Node.
 * Observe-only; nunca bloqueia o event loop de forma relevante.
 * @module observabilidade/resourceSampler
 */

const { performance, monitorEventLoopDelay } = require('perf_hooks');
const { CATEGORIAS, EVENT_NAMES } = require('./eventTypes');

const DEFAULT_INTERVAL_MS = 15000;

/**
 * @param {{ publish?: Function, intervalMs?: number }} [deps]
 */
function createResourceSampler(deps = {}) {
  const intervalMs = Math.max(5000, Number(deps.intervalMs) || Number(process.env.CDS_OBS_SAMPLER_MS) || DEFAULT_INTERVAL_MS);
  let timer = null;
  let histogram = null;
  let lastCpu = process.cpuUsage();
  let lastWall = performance.now();
  let samples = 0;

  try {
    if (typeof monitorEventLoopDelay === 'function') {
      histogram = monitorEventLoopDelay({ resolution: 20 });
      histogram.enable();
    }
  } catch (_) {
    histogram = null;
  }

  function collect() {
    const mem = process.memoryUsage();
    const nowCpu = process.cpuUsage();
    const nowWall = performance.now();
    const wallMicros = Math.max(1, (nowWall - lastWall) * 1000);
    const userDelta = nowCpu.user - lastCpu.user;
    const systemDelta = nowCpu.system - lastCpu.system;
    const cpuPercent = Number((((userDelta + systemDelta) / wallMicros) * 100).toFixed(2));
    lastCpu = nowCpu;
    lastWall = nowWall;

    let eventLoopDelayMs = null;
    if (histogram) {
      try {
        eventLoopDelayMs = Number((histogram.mean / 1e6).toFixed(3));
        histogram.reset();
      } catch (_) {
        eventLoopDelayMs = null;
      }
    }

    samples += 1;
    return {
      heap_rss_mb: Number((mem.rss / (1024 * 1024)).toFixed(2)),
      heap_used_mb: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
      heap_total_mb: Number((mem.heapTotal / (1024 * 1024)).toFixed(2)),
      external_mb: Number((mem.external / (1024 * 1024)).toFixed(2)),
      cpu_percent: cpuPercent,
      event_loop_delay_ms: eventLoopDelayMs,
      uptime_s: Number(process.uptime().toFixed(1)),
      sample_n: samples
    };
  }

  function publishSample() {
    try {
      const payload = collect();
      const publish = deps.publish || require('./eventBus').publish;
      publish({
        event_name: EVENT_NAMES.RESOURCE_SAMPLE,
        categoria: CATEGORIAS.PLATFORM,
        origem: 'observabilidade.resourceSampler',
        duracao_ms: payload.event_loop_delay_ms,
        payload
      });
      return payload;
    } catch (_) {
      return null;
    }
  }

  function start() {
    if (timer) return { ok: true, reason: 'already' };
    publishSample();
    timer = setInterval(() => {
      publishSample();
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    return { ok: true, intervalMs };
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (histogram) {
      try { histogram.disable(); } catch (_) { /* ignore */ }
    }
  }

  return { start, stop, collect, publishSample, intervalMs };
}

module.exports = {
  createResourceSampler,
  DEFAULT_INTERVAL_MS
};
