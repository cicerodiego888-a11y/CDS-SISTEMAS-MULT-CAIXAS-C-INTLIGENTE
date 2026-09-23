/**
 * Sprint 7.0 — diagnóstico de performance local.
 * Coleta somente metadados técnicos, em memória e com limite fixo.
 * Default OFF. Ativação: CDSPerformanceDiagnostics.enable() ou
 * localStorage.CDS_PERFORMANCE_DIAGNOSTICS = "ON" antes do reload.
 */
(function (global) {
  'use strict';

  const DEFAULT_LIMIT = 2000;
  const SENSITIVE_KEY = /pass|senha|token|authorization|cookie|cert|secret|card|cartao|cvv|xml|chave/i;
  const SAFE_EVENTS = new Set([
    'input', 'change', 'blur', 'focus', 'focusin', 'focusout', 'keydown', 'keyup'
  ]);

  let enabled = false;
  let limit = DEFAULT_LIMIT;
  let seq = 0;
  let sessionSeq = 0;
  let sessionId = null;
  let navigationId = null;
  let navigation = null;
  let longTaskObserver = null;
  let pageObserver = null;
  let memoryTimer = null;
  let ajaxInstalled = false;
  let fieldEventsInstalled = false;
  let fetchInstalled = false;
  let timersInstalled = false;
  let originalFetch = null;
  let originalSetTimeout = null;
  let originalClearTimeout = null;
  let originalSetInterval = null;
  let originalClearInterval = null;
  let originalRequestAnimationFrame = null;
  let originalCancelAnimationFrame = null;
  const timerMetadata = new Map();
  const events = [];
  const active = new Map();
  const counters = Object.create(null);

  function now() {
    try {
      if (global.performance && typeof global.performance.now === 'function') {
        return global.performance.now();
      }
    } catch { /* ignore */ }
    return Date.now();
  }

  function epoch() {
    try {
      if (global.performance && Number.isFinite(global.performance.timeOrigin)) {
        return global.performance.timeOrigin + now();
      }
    } catch { /* ignore */ }
    return Date.now();
  }

  function nextId(prefix) {
    seq += 1;
    return `${prefix || 'PERF'}-${Date.now().toString(36)}-${String(seq).padStart(5, '0')}`;
  }

  function currentPage() {
    try {
      return (global.UINavigation && global.UINavigation.getPage && global.UINavigation.getPage())
        || global.currentPage
        || null;
    } catch {
      return null;
    }
  }

  function cleanString(value, max = 160) {
    return String(value == null ? '' : value)
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, max);
  }

  function safeEndpoint(input) {
    try {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const base = global.location && global.location.origin ? global.location.origin : 'http://localhost';
      const url = new URL(raw, base);
      const parts = url.pathname.split('/').map((part) => {
        if (!part) return part;
        if (/^\d+$/.test(part)) return ':id';
        if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(part)) return ':uuid';
        if (/^\d{44}$/.test(part)) return ':key';
        return part.slice(0, 64);
      });
      return parts.join('/') || '/';
    } catch {
      return cleanString(String(input || '').split('?')[0], 180);
    }
  }

  function safeObject(input, depth = 0) {
    if (input == null || typeof input === 'number' || typeof input === 'boolean') return input;
    if (typeof input === 'string') return cleanString(input);
    if (depth >= 2) return '[truncated]';
    if (Array.isArray(input)) {
      return input.slice(0, 20).map((item) => safeObject(item, depth + 1));
    }
    if (typeof input !== 'object') return cleanString(typeof input);
    const output = {};
    Object.keys(input).slice(0, 30).forEach((key) => {
      if (SENSITIVE_KEY.test(key)) {
        output[key] = '[redacted]';
      } else {
        output[key] = safeObject(input[key], depth + 1);
      }
    });
    return output;
  }

  function classify(type, duration) {
    const ms = Number(duration) || 0;
    if (type === 'longtask') {
      if (ms > 200) return 'CRITICA';
      if (ms >= 100) return 'ALTA';
      return 'ATENCAO';
    }
    if (String(type).startsWith('navigation')) {
      if (ms > 300) return 'LENTA';
      if (ms >= 100) return 'ATENCAO';
      return 'NORMAL';
    }
    if (ms > 50) return 'LENTO';
    if (ms >= 16) return 'ATENCAO';
    return 'NORMAL';
  }

  function push(type, detail = {}) {
    if (!enabled) return null;
    const row = Object.freeze({
      id: nextId('EVT'),
      sessionId,
      navigationId,
      page: currentPage(),
      type: cleanString(type, 80),
      timestamp: epoch(),
      ...safeObject(detail)
    });
    events.push(row);
    if (events.length > limit) events.splice(0, events.length - limit);
    counters[row.type] = (counters[row.type] || 0) + 1;
    return row;
  }

  function perfMark(name) {
    if (!enabled) return;
    try {
      if (global.performance && typeof global.performance.mark === 'function') {
        global.performance.mark(name);
      }
    } catch { /* diagnostics never breaks UI */ }
  }

  function perfMeasure(name, startMark, endMark) {
    if (!enabled) return;
    try {
      if (global.performance && typeof global.performance.measure === 'function') {
        global.performance.measure(name, startMark, endMark);
      }
    } catch { /* diagnostics never breaks UI */ }
  }

  function approximateBytes(value) {
    try {
      if (value == null) return 0;
      if (typeof value === 'string') return new Blob([value]).size;
      if (value instanceof ArrayBuffer) return value.byteLength;
      if (global.Blob && value instanceof global.Blob) return value.size;
      return new Blob([JSON.stringify(value)]).size;
    } catch {
      return null;
    }
  }

  function elementDescriptor(element) {
    if (!element || !element.tagName) return null;
    return {
      tag: String(element.tagName).toLowerCase(),
      id: cleanString(element.id || '', 80) || null,
      name: cleanString(element.getAttribute && element.getAttribute('name') || '', 80) || null,
      type: cleanString(element.getAttribute && element.getAttribute('type') || '', 40) || null,
      role: cleanString(element.getAttribute && element.getAttribute('role') || '', 40) || null
    };
  }

  function start(name, detail = {}) {
    if (!enabled) return null;
    const operationId = nextId('OP');
    const startMark = `cds:${name}:start:${operationId}`;
    const row = {
      operationId,
      name: cleanString(name, 100),
      startedAt: now(),
      timestamp: epoch(),
      startMark,
      detail: safeObject(detail),
      sessionId,
      navigationId,
      page: currentPage()
    };
    active.set(operationId, row);
    perfMark(startMark);
    push(`${name}:start`, { operationId, ...row.detail });
    return operationId;
  }

  function end(operationId, detail = {}) {
    if (!enabled || !operationId) return null;
    const row = active.get(operationId);
    if (!row) return null;
    active.delete(operationId);
    const endedAt = now();
    const duration = Math.max(0, endedAt - row.startedAt);
    const endMark = `cds:${row.name}:end:${operationId}`;
    perfMark(endMark);
    perfMeasure(`cds:${row.name}:${operationId}`, row.startMark, endMark);
    return push(`${row.name}:end`, {
      operationId,
      duration: Number(duration.toFixed(3)),
      classification: classify(row.name, duration),
      ...row.detail,
      ...safeObject(detail)
    });
  }

  function measure(name, fn, detail = {}) {
    if (!enabled || typeof fn !== 'function') return fn();
    const operationId = start(name, detail);
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        return result.then(
          (value) => {
            end(operationId, { outcome: 'fulfilled' });
            return value;
          },
          (error) => {
            end(operationId, { outcome: 'rejected', error: cleanString(error && error.message || error) });
            throw error;
          }
        );
      }
      end(operationId, { outcome: 'returned' });
      return result;
    } catch (error) {
      end(operationId, { outcome: 'threw', error: cleanString(error && error.message || error) });
      throw error;
    }
  }

  function completeNavigation(reason) {
    if (!enabled || !navigation || navigation.completed) return;
    navigation.completed = true;
    const duration = now() - navigation.startedAt;
    push('navigation:ready', {
      fromPage: navigation.fromPage,
      toPage: navigation.toPage,
      pageToken: navigation.pageToken || null,
      reason: reason || 'dom-idle',
      duration: Number(duration.toFixed(3)),
      classification: classify('navigation', duration),
      mutations: navigation.mutations
    });
    perfMark(`cds:navigation:ready:${navigation.id}`);
    perfMeasure(
      `cds:navigation_total:${navigation.id}`,
      `cds:navigation:start:${navigation.id}`,
      `cds:navigation:ready:${navigation.id}`
    );
  }

  function scheduleNavigationReady() {
    if (!navigation || navigation.completed) return;
    const version = ++navigation.readyVersion;
    const finish = () => {
      if (!navigation || navigation.completed || version !== navigation.readyVersion) return;
      completeNavigation('dom-idle');
    };
    if (typeof global.requestAnimationFrame === 'function') {
      global.requestAnimationFrame(() => global.requestAnimationFrame(finish));
    } else {
      setTimeout(finish, 0);
    }
  }

  function observePageContent() {
    if (!enabled || pageObserver || typeof global.MutationObserver !== 'function' || !global.document) return;
    const target = global.document.getElementById('page-content');
    if (!target) return;
    pageObserver = new global.MutationObserver((mutations) => {
      if (!navigation || navigation.completed) return;
      if (!navigation.renderStarted) {
        navigation.renderStarted = true;
        navigation.renderStartedAt = now();
        perfMark(`cds:navigation:render:start:${navigation.id}`);
        push('navigation:render:start', { toPage: navigation.toPage });
      }
      navigation.mutations += mutations.length;
      navigation.readyVersion += 1;
      const version = navigation.readyVersion;
      const finish = () => {
        if (!navigation || navigation.completed || version !== navigation.readyVersion) return;
        const renderDuration = now() - navigation.renderStartedAt;
        perfMark(`cds:navigation:render:end:${navigation.id}`);
        perfMeasure(
          `cds:navigation_render:${navigation.id}`,
          `cds:navigation:render:start:${navigation.id}`,
          `cds:navigation:render:end:${navigation.id}`
        );
        push('navigation:render:end', {
          toPage: navigation.toPage,
          duration: Number(renderDuration.toFixed(3)),
          classification: classify('render', renderDuration),
          mutations: navigation.mutations,
          nodes: target.querySelectorAll ? target.querySelectorAll('*').length : null
        });
        scheduleNavigationReady();
      };
      if (typeof global.requestAnimationFrame === 'function') {
        global.requestAnimationFrame(finish);
      } else {
        setTimeout(finish, 0);
      }
    });
    pageObserver.observe(target, { childList: true, subtree: true, attributes: false });
  }

  function navigationStart(toPage, detail = {}) {
    if (!enabled) return null;
    if (navigation && !navigation.completed) completeNavigation('superseded');
    const fromPage = currentPage();
    navigationId = nextId('NAV');
    navigation = {
      id: navigationId,
      fromPage,
      toPage: cleanString(toPage, 80),
      pageToken: detail.pageToken || null,
      startedAt: now(),
      completed: false,
      renderStarted: false,
      mutations: 0,
      readyVersion: 0
    };
    perfMark(`cds:navigation:start:${navigationId}`);
    push('navigation:start', { fromPage, toPage: navigation.toPage, trigger: detail.trigger || 'loadPage' });
    observePageContent();
    return navigationId;
  }

  function navigationPhase(phase, detail = {}) {
    if (!enabled || !navigation) return null;
    const safePhase = cleanString(phase, 60);
    perfMark(`cds:navigation:${safePhase}:${navigation.id}`);
    return push(`navigation:${safePhase}`, {
      fromPage: navigation.fromPage,
      toPage: navigation.toPage,
      ...safeObject(detail)
    });
  }

  function installLongTasks() {
    if (!enabled || longTaskObserver || typeof global.PerformanceObserver !== 'function') return;
    try {
      const supported = global.PerformanceObserver.supportedEntryTypes || [];
      if (supported.length && !supported.includes('longtask')) return;
      longTaskObserver = new global.PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          push('longtask', {
            duration: Number(entry.duration.toFixed(3)),
            startTime: Number(entry.startTime.toFixed(3)),
            classification: classify('longtask', entry.duration),
            context: navigation ? navigation.toPage : currentPage()
          });
        });
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
      push('diagnostics:capability', { longtask: true });
    } catch (error) {
      push('diagnostics:capability', { longtask: false, reason: cleanString(error && error.message || error) });
    }
  }

  function installFieldEvents() {
    if (!enabled || fieldEventsInstalled || !global.document || !global.document.addEventListener) return;
    fieldEventsInstalled = true;
    SAFE_EVENTS.forEach((eventName) => {
      global.document.addEventListener(eventName, (event) => {
        if (!enabled) return;
        const target = event.target;
        if (!target || !/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName || '')) return;
        const startedAt = now();
        const detail = { event: eventName, element: elementDescriptor(target) };
        const finish = () => {
          const duration = now() - startedAt;
          push('field:event', {
            ...detail,
            duration: Number(duration.toFixed(3)),
            classification: classify('field', duration)
          });
        };
        if (typeof global.queueMicrotask === 'function') global.queueMicrotask(finish);
        else Promise.resolve().then(finish);
      }, true);
    });
  }

  function installFetch() {
    if (!enabled || fetchInstalled || typeof global.fetch !== 'function') return;
    fetchInstalled = true;
    originalFetch = global.fetch;
    global.fetch = async function instrumentedFetch(input, init) {
      if (!enabled) return originalFetch.apply(this, arguments);
      const method = cleanString((init && init.method) || (input && input.method) || 'GET', 12).toUpperCase();
      const endpoint = safeEndpoint(input);
      const requestBytes = approximateBytes(init && init.body);
      const requestId = start('request', { transport: 'fetch', method, endpoint, requestBytes });
      const requestStarted = now();
      try {
        let fetchInit = init;
        if (requestId && endpoint.startsWith('/api/') && typeof input === 'string') {
          const headers = new global.Headers((init && init.headers) || {});
          headers.set('X-CDS-Performance-Id', requestId);
          fetchInit = { ...(init || {}), headers };
        }
        const response = await originalFetch.call(this, input, fetchInit);
        const requestDuration = now() - requestStarted;
        const responseBytes = Number(response.headers && response.headers.get('content-length')) || null;
        const serverTiming = cleanString(response.headers && response.headers.get('server-timing') || '', 240) || null;
        end(requestId, {
          status: response.status,
          ok: response.ok,
          requestDuration: Number(requestDuration.toFixed(3)),
          responseBytes,
          serverTiming
        });
        return response;
      } catch (error) {
        end(requestId, { status: 0, ok: false, error: cleanString(error && error.message || error) });
        throw error;
      }
    };
  }

  function installAjax() {
    if (!enabled || ajaxInstalled || !global.document || !global.jQuery) return;
    ajaxInstalled = true;
    const requests = new WeakMap();
    global.jQuery(global.document)
      .on('ajaxSend.cdsPerformance', function (_event, jqXHR, settings) {
        if (!enabled) return;
        const operationId = start('request', {
          transport: 'jquery',
          method: cleanString(settings.type || settings.method || 'GET', 12).toUpperCase(),
          endpoint: safeEndpoint(settings.url),
          requestBytes: approximateBytes(settings.data)
        });
        if (operationId && safeEndpoint(settings.url).startsWith('/api/')
          && jqXHR && typeof jqXHR.setRequestHeader === 'function') {
          jqXHR.setRequestHeader('X-CDS-Performance-Id', operationId);
        }
        requests.set(jqXHR, { operationId, startedAt: now() });
      })
      .on('ajaxComplete.cdsPerformance', function (_event, jqXHR) {
        if (!enabled) return;
        const req = requests.get(jqXHR);
        if (!req) return;
        const requestDuration = now() - req.startedAt;
        end(req.operationId, {
          status: Number(jqXHR.status) || 0,
          ok: jqXHR.status >= 200 && jqXHR.status < 400,
          requestDuration: Number(requestDuration.toFixed(3)),
          responseBytes: jqXHR.responseText ? approximateBytes(jqXHR.responseText) : null,
          serverTiming: cleanString(jqXHR.getResponseHeader && jqXHR.getResponseHeader('server-timing') || '', 240) || null
        });
        requests.delete(jqXHR);
      });
  }

  function timerOrigin() {
    try {
      const lines = String(new Error().stack || '').split('\n');
      const line = lines.find((item) =>
        /\/(?:erp|shared)\/.*\.js/i.test(item)
        && !/PerformanceMonitor\.js/i.test(item)
      );
      return cleanString(line || 'unknown', 180);
    } catch {
      return 'unknown';
    }
  }

  function installTimers() {
    if (!enabled || timersInstalled) return;
    timersInstalled = true;
    originalSetTimeout = global.setTimeout;
    originalClearTimeout = global.clearTimeout;
    originalSetInterval = global.setInterval;
    originalClearInterval = global.clearInterval;
    originalRequestAnimationFrame = global.requestAnimationFrame;
    originalCancelAnimationFrame = global.cancelAnimationFrame;

    function create(kind, originalCreate, callback, delay, args) {
      if (!enabled || typeof callback !== 'function') {
        return originalCreate(callback, delay, ...args);
      }
      const timerId = nextId('TIMER');
      const meta = {
        timerId,
        kind,
        delay: Number(delay) || 0,
        origin: timerOrigin(),
        page: currentPage(),
        executions: 0,
        nativeHandle: null
      };
      const wrapped = function () {
        meta.executions += 1;
        const startedAt = now();
        try {
          return callback.apply(this, arguments);
        } finally {
          const duration = Math.max(0, now() - startedAt);
          if (duration >= 8) {
            push('timer:end', {
              timerId,
              kind,
              delay: meta.delay,
              origin: meta.origin,
              creationPage: meta.page,
              duration: Number(duration.toFixed(3)),
              executions: meta.executions,
              classification: classify('timer', duration)
            });
          }
          if (kind === 'timeout' || kind === 'animation-frame') {
            timerMetadata.delete(meta.nativeHandle);
          }
        }
      };
      const handle = kind === 'animation-frame'
        ? originalCreate(wrapped)
        : originalCreate(wrapped, delay, ...args);
      meta.nativeHandle = handle;
      timerMetadata.set(handle, meta);
      push('timer:create', {
        timerId,
        kind,
        delay: meta.delay,
        origin: meta.origin,
        creationPage: meta.page
      });
      return handle;
    }

    global.setTimeout = function instrumentedTimeout(callback, delay) {
      return create('timeout', originalSetTimeout, callback, delay, Array.from(arguments).slice(2));
    };
    global.setInterval = function instrumentedInterval(callback, delay) {
      return create('interval', originalSetInterval, callback, delay, Array.from(arguments).slice(2));
    };
    global.clearTimeout = function instrumentedClearTimeout(handle) {
      const meta = timerMetadata.get(handle);
      if (meta) {
        push('timer:cancel', { timerId: meta.timerId, kind: meta.kind, executions: meta.executions });
        timerMetadata.delete(handle);
      }
      return originalClearTimeout(handle);
    };
    global.clearInterval = function instrumentedClearInterval(handle) {
      const meta = timerMetadata.get(handle);
      if (meta) {
        push('timer:cancel', { timerId: meta.timerId, kind: meta.kind, executions: meta.executions });
        timerMetadata.delete(handle);
      }
      return originalClearInterval(handle);
    };
    if (typeof originalRequestAnimationFrame === 'function') {
      global.requestAnimationFrame = function instrumentedAnimationFrame(callback) {
        return create('animation-frame', originalRequestAnimationFrame, callback, 0, []);
      };
    }
    if (typeof originalCancelAnimationFrame === 'function') {
      global.cancelAnimationFrame = function instrumentedCancelAnimationFrame(handle) {
        const meta = timerMetadata.get(handle);
        if (meta) {
          push('timer:cancel', { timerId: meta.timerId, kind: meta.kind, executions: meta.executions });
          timerMetadata.delete(handle);
        }
        return originalCancelAnimationFrame(handle);
      };
    }
  }

  function restoreTimers() {
    if (!timersInstalled) return;
    if (originalSetTimeout) global.setTimeout = originalSetTimeout;
    if (originalClearTimeout) global.clearTimeout = originalClearTimeout;
    if (originalSetInterval) global.setInterval = originalSetInterval;
    if (originalClearInterval) global.clearInterval = originalClearInterval;
    if (originalRequestAnimationFrame) global.requestAnimationFrame = originalRequestAnimationFrame;
    if (originalCancelAnimationFrame) global.cancelAnimationFrame = originalCancelAnimationFrame;
    timerMetadata.clear();
    timersInstalled = false;
  }

  function sampleMemory(reason) {
    if (!enabled) return null;
    try {
      const memory = global.performance && global.performance.memory;
      if (!memory) return push('memory:unsupported', { reason: reason || 'sample' });
      return push('memory:sample', {
        reason: reason || 'periodic',
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit
      });
    } catch {
      return null;
    }
  }

  function sampleRequestContext(reason) {
    if (!enabled) return null;
    try {
      const Context = global.UIRequestContext;
      if (!Context || typeof Context.getDiagnostics !== 'function') return null;
      return push('request-context:retained', {
        reason: reason || 'periodic',
        ...Context.getDiagnostics()
      });
    } catch {
      return null;
    }
  }

  function lastEvents(type, max = 40) {
    return events.filter((row) => row.type.includes(type)).slice(-max);
  }

  function getSnapshot() {
    const report = getReport();
    return {
      generatedAt: report.generatedAt,
      status: report.status,
      counters: report.counters,
      thresholds: report.thresholds,
      navigations: lastEvents('navigation:', 30),
      requests: lastEvents('request:', 40),
      longTasks: lastEvents('longtask', 30),
      slowEvents: events.filter((row) => {
        const duration = Number(row.duration);
        return Number.isFinite(duration) && duration >= 50;
      }).slice(-40),
      polling: lastEvents('polling:', 40),
      renders: events.filter((row) =>
        row.type.includes('render')
        || row.type.includes('dom-update')
        || row.type.includes('soft-refresh')
      ).slice(-40),
      sqlite: lastEvents('sqlite:', 40),
      memory: lastEvents('memory:', 20),
      races: events.filter((row) =>
        row.validity === 'STALE'
        || row.validity === 'CANCELLED'
        || row.type.includes('stale')
        || row.type.includes('request-context:stale')
        || row.type.includes('request-context:cancel')
      ).slice(-40),
      fieldEvents: lastEvents('field:event', 40),
      timers: lastEvents('timer:', 40)
    };
  }

  function startSession(reason) {
    sessionSeq += 1;
    sessionId = `PERF-${Date.now().toString(36)}-${String(sessionSeq).padStart(3, '0')}`;
    if (enabled) push('session:start', { reason: reason || 'manual', bufferLimit: limit });
    return sessionId;
  }

  function enable(options = {}) {
    if (Number.isFinite(Number(options.limit))) {
      limit = Math.max(100, Math.min(10000, Number(options.limit)));
      if (events.length > limit) events.splice(0, events.length - limit);
    }
    enabled = true;
    if (!sessionId) startSession('enable');
    installLongTasks();
    installFieldEvents();
    installFetch();
    installAjax();
    observePageContent();
    if (!memoryTimer && typeof global.setInterval === 'function') {
      memoryTimer = global.setInterval(() => {
        sampleMemory('periodic');
        sampleRequestContext('periodic');
      }, 30000);
    }
    installTimers();
    push('diagnostics:enabled', { bufferLimit: limit });
    return getStatus();
  }

  function disable() {
    if (enabled) push('diagnostics:disabled');
    enabled = false;
    active.clear();
    if (longTaskObserver) {
      try { longTaskObserver.disconnect(); } catch { /* ignore */ }
      longTaskObserver = null;
    }
    if (pageObserver) {
      try { pageObserver.disconnect(); } catch { /* ignore */ }
      pageObserver = null;
    }
    if (memoryTimer) {
      (originalClearInterval || global.clearInterval)(memoryTimer);
      memoryTimer = null;
    }
    restoreTimers();
    return getStatus();
  }

  function clear() {
    events.length = 0;
    active.clear();
    Object.keys(counters).forEach((key) => delete counters[key]);
    try {
      if (global.performance && typeof global.performance.clearMarks === 'function') {
        global.performance.clearMarks('cds:');
        global.performance.clearMeasures('cds:');
      }
    } catch { /* ignore */ }
  }

  function getStatus() {
    return {
      enabled,
      sessionId,
      navigationId,
      page: currentPage(),
      bufferSize: events.length,
      bufferLimit: limit,
      activeOperations: active.size
    };
  }

  function getReport(options = {}) {
    const max = Math.max(1, Math.min(limit, Number(options.limit) || limit));
    const type = options.type ? String(options.type) : null;
    const filtered = type ? events.filter((row) => row.type.includes(type)) : events;
    return {
      generatedAt: new Date().toISOString(),
      status: getStatus(),
      counters: { ...counters },
      thresholds: {
        ui: { normalBelowMs: 16, attentionBelowMs: 50 },
        navigation: { normalBelowMs: 100, attentionBelowMs: 300 },
        longtask: { attentionMs: 50, highMs: 100, criticalAboveMs: 200 }
      },
      events: filtered.slice(-max)
    };
  }

  function configure(options = {}) {
    if (Number.isFinite(Number(options.limit))) {
      limit = Math.max(100, Math.min(10000, Number(options.limit)));
      if (events.length > limit) events.splice(0, events.length - limit);
    }
    return getStatus();
  }

  const api = {
    enable,
    disable,
    isEnabled: () => enabled,
    configure,
    startSession,
    start,
    end,
    measure,
    mark(name, detail) {
      if (!enabled) return null;
      perfMark(`cds:${cleanString(name, 100)}`);
      return push(name, detail);
    },
    record: push,
    clear,
    getStatus,
    getReport,
    getSnapshot,
    sampleRequestContext,
    navigationStart,
    navigationPhase,
    navigationReady: completeNavigation,
    sampleMemory,
    safeEndpoint,
    approximateBytes,
    elementDescriptor,
    _resetForTests() {
      disable();
      clear();
      seq = 0;
      sessionSeq = 0;
      sessionId = null;
      navigationId = null;
      navigation = null;
      limit = DEFAULT_LIMIT;
    }
  };

  global.PerformanceMonitor = api;
  global.CDSPerformanceDiagnostics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  try {
    const initial = global.PERFORMANCE_DIAGNOSTICS === 'ON'
      || (global.localStorage && global.localStorage.getItem('CDS_PERFORMANCE_DIAGNOSTICS') === 'ON');
    if (initial) enable();
  } catch { /* default OFF */ }
})(typeof window !== 'undefined' ? window : global);
