/**
 * Sprint 7.0 — infraestrutura de diagnóstico frontend.
 * node --test tests/frontend/sprint7-performance-instrumentation.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const MONITOR_FILE = path.join(ROOT, 'frontend/shared/js/core/PerformanceMonitor.js');
const POLLING_FILE = path.join(ROOT, 'frontend/shared/js/core/UIPollingManager.js');

function createSandbox(options = {}) {
  let timerSeq = 0;
  const intervals = new Map();
  const listeners = {};
  const sandbox = {
    console,
    Date,
    Promise,
    URL,
    Blob,
    Headers,
    ArrayBuffer,
    module: { exports: {} },
    exports: {},
    location: { origin: 'http://localhost:3001' },
    localStorage: { getItem: () => null },
    setTimeout(fn) {
      if (options.runTimeouts) fn();
      return ++timerSeq;
    },
    clearTimeout() {},
    setInterval(fn) {
      const id = ++timerSeq;
      intervals.set(id, fn);
      return id;
    },
    clearInterval(id) { intervals.delete(id); },
    requestAnimationFrame(fn) {
      if (options.runAnimationFrames) fn(0);
      return ++timerSeq;
    },
    cancelAnimationFrame() {},
    queueMicrotask,
    document: {
      hidden: false,
      activeElement: null,
      addEventListener(name, fn) { listeners[name] = fn; },
      getElementById() { return null; },
      querySelector() { return null; }
    },
    performance: options.withPerformance === false
      ? undefined
      : {
          timeOrigin: 1000,
          now: (() => {
            let value = 0;
            return () => ++value;
          })(),
          mark() {},
          measure() {},
          clearMarks() {},
          clearMeasures() {}
        },
    fetch: options.fetch || (async () => ({
      status: 200,
      ok: true,
      headers: new Headers({ 'content-length': '12', 'server-timing': 'cds_total;dur=3' })
    }))
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.self = sandbox;
  sandbox.__intervals = intervals;
  sandbox.__listeners = listeners;
  return sandbox;
}

function loadMonitor(options) {
  const sandbox = createSandbox(options);
  vm.runInNewContext(fs.readFileSync(MONITOR_FILE, 'utf8'), sandbox, {
    filename: 'PerformanceMonitor.js'
  });
  return sandbox;
}

describe('Sprint 7.0 — PerformanceMonitor frontend', () => {
  it('fica OFF por padrão e start tem overhead mínimo', () => {
    const box = loadMonitor();
    assert.equal(box.PerformanceMonitor.isEnabled(), false);
    assert.equal(box.PerformanceMonitor.start('noop'), null);
    assert.equal(box.PerformanceMonitor.getReport().events.length, 0);
  });

  it('inicia sessão identificada e finaliza medição', () => {
    const box = loadMonitor();
    box.PerformanceMonitor.enable();
    const operation = box.PerformanceMonitor.start('ui:test', { records: 3 });
    const result = box.PerformanceMonitor.end(operation, { outcome: 'ok' });
    assert.match(box.PerformanceMonitor.getStatus().sessionId, /^PERF-/);
    assert.equal(result.type, 'ui:test:end');
    assert.equal(typeof result.duration, 'number');
  });

  it('não quebra sem Performance API', () => {
    const box = loadMonitor({ withPerformance: false });
    assert.doesNotThrow(() => {
      box.PerformanceMonitor.enable();
      const operation = box.PerformanceMonitor.start('fallback');
      box.PerformanceMonitor.end(operation);
    });
  });

  it('buffer é limitado e descarta eventos antigos', () => {
    const box = loadMonitor();
    box.PerformanceMonitor.enable({ limit: 100 });
    for (let i = 0; i < 130; i += 1) {
      box.PerformanceMonitor.record('buffer:test', { index: i });
    }
    const report = box.PerformanceMonitor.getReport();
    assert.equal(report.events.length, 100);
    assert.ok(report.events[0].index >= 30);
  });

  it('navegação gera start e ready com navigationId', () => {
    const box = loadMonitor();
    box.PerformanceMonitor.enable();
    const id = box.PerformanceMonitor.navigationStart('clientes');
    box.PerformanceMonitor.navigationPhase('request:start');
    box.PerformanceMonitor.navigationReady('test');
    const events = box.PerformanceMonitor.getReport({ type: 'navigation:' }).events;
    assert.ok(events.some((event) => event.type === 'navigation:start'));
    assert.ok(events.some((event) => event.type === 'navigation:ready'));
    assert.ok(events.every((event) => event.navigationId === id));
  });

  it('request fetch gera medição sem guardar query string', async () => {
    const box = loadMonitor();
    box.PerformanceMonitor.enable();
    const result = await box.fetch('http://localhost:3001/api/clientes?cpf=123');
    assert.equal(result.status, 200);
    const completed = box.PerformanceMonitor.getReport({ type: 'request:end' }).events.at(-1);
    assert.equal(completed.endpoint, '/api/clientes');
    assert.equal(completed.status, 200);
    assert.equal(completed.responseBytes, 12);
  });

  it('measure preserva retorno funcional síncrono e assíncrono', async () => {
    const box = loadMonitor();
    box.PerformanceMonitor.enable();
    assert.equal(box.PerformanceMonitor.measure('sync', () => 42), 42);
    assert.equal(await box.PerformanceMonitor.measure('async', async () => 'ok'), 'ok');
  });

  it('dados sensíveis são redigidos', () => {
    const box = loadMonitor();
    box.PerformanceMonitor.enable();
    box.PerformanceMonitor.record('security:test', {
      token: 'segredo',
      senha: 'segredo',
      endpoint: '/api/clientes',
      nested: { certificado: 'segredo' }
    });
    const event = box.PerformanceMonitor.getReport().events.at(-1);
    assert.equal(event.token, '[redacted]');
    assert.equal(event.senha, '[redacted]');
    assert.equal(event.nested.certificado, '[redacted]');
  });

  it('polling gera start, execute, end e stop sem alterar callback', async () => {
    const box = loadMonitor();
    box.PerformanceMonitor.enable();
    box.UINavigation = { isActivePage: () => true };
    box.module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(POLLING_FILE, 'utf8'), box, {
      filename: 'UIPollingManager.js'
    });
    let calls = 0;
    box.UIPollingManager.start({
      id: 'test-poll',
      page: 'clientes',
      interval: 500,
      fn: async () => { calls += 1; }
    });
    const pollTimer = [...box.__intervals.entries()].at(-1);
    await pollTimer[1]();
    box.UIPollingManager.stop('test-poll');
    assert.equal(calls, 1);
    const types = box.PerformanceMonitor.getReport({ type: 'polling:' }).events.map((e) => e.type);
    assert.ok(types.includes('polling:start'));
    assert.ok(types.includes('polling:execute'));
    assert.ok(types.includes('polling:end'));
    assert.ok(types.includes('polling:stop'));
  });

  it('request-context registra retenção sem apagar entradas', () => {
    const box = loadMonitor();
    box.PerformanceMonitor.enable();
    box.module = { exports: {} };
    vm.runInNewContext(
      fs.readFileSync(path.join(ROOT, 'frontend/shared/js/core/UIRequestContext.js'), 'utf8'),
      box,
      { filename: 'UIRequestContext.js' }
    );
    const first = box.UIRequestContext.begin({ page: 'clientes' });
    box.UIRequestContext.markCompleted(first.request_id);
    const second = box.UIRequestContext.begin({ page: 'produtos' });
    box.UIRequestContext.markStale(second.request_id, 'page_changed');
    const snapshot = box.PerformanceMonitor.getSnapshot();
    assert.equal(box.UIRequestContext.getDiagnostics().retained, 2);
    assert.ok(snapshot.races.some((event) => event.type === 'request-context:stale'));
    assert.ok(snapshot.requests.length >= 0);
  });

  it('getSnapshot expõe as categorias de diagnóstico', () => {
    const box = loadMonitor();
    box.PerformanceMonitor.enable();
    box.PerformanceMonitor.navigationStart('clientes');
    box.PerformanceMonitor.record('longtask', { duration: 120, classification: 'ALTA' });
    box.PerformanceMonitor.record('field:event', { duration: 60, classification: 'LENTO' });
    const snapshot = box.PerformanceMonitor.getSnapshot();
    assert.ok(Array.isArray(snapshot.navigations));
    assert.ok(Array.isArray(snapshot.longTasks));
    assert.ok(Array.isArray(snapshot.slowEvents));
    assert.ok(Array.isArray(snapshot.fieldEvents));
    assert.ok(snapshot.slowEvents.some((event) => event.duration >= 50));
  });
});

