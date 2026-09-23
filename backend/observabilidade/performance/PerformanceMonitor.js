'use strict';

/**
 * Sprint 7.0 — diagnóstico local de backend/SQLite.
 * Default OFF. Ativação: PERFORMANCE_DIAGNOSTICS=ON.
 * Buffer somente em memória; não persiste payload, parâmetros SQL ou credenciais.
 */
const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

const DEFAULT_LIMIT = 3000;
const contextStorage = new AsyncLocalStorage();
const events = [];
const active = new Map();
const counters = Object.create(null);
let enabled = ['ON', '1', 'TRUE'].includes(String(process.env.PERFORMANCE_DIAGNOSTICS || '').toUpperCase());
let limit = DEFAULT_LIMIT;
let seq = 0;
let sessionId = `BACKEND-${Date.now().toString(36)}`;
let sqliteInstalled = false;

function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function nextId(prefix) {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${String(seq).padStart(5, '0')}`;
}

function clean(value, max = 180) {
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').slice(0, max);
}

function routeTemplate(req) {
  const base = String(req.baseUrl || '');
  const route = req.route && req.route.path ? String(req.route.path) : '';
  const raw = route ? `${base}${route}` : String(req.path || req.originalUrl || '/').split('?')[0];
  return raw
    .split('/')
    .map((part) => {
      if (/^\d+$/.test(part)) return ':id';
      if (/^\d{44}$/.test(part)) return ':key';
      if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(part)) return ':uuid';
      return part.slice(0, 64);
    })
    .join('/') || '/';
}

function currentContext() {
  return contextStorage.getStore() || null;
}

function safeDetail(detail) {
  const output = {};
  Object.entries(detail || {}).slice(0, 40).forEach(([key, value]) => {
    if (/pass|senha|token|authorization|cookie|cert|secret|card|cartao|cvv|xml|chave|param/i.test(key)) {
      output[key] = '[redacted]';
    } else if (value == null || typeof value === 'number' || typeof value === 'boolean') {
      output[key] = value;
    } else {
      output[key] = clean(value);
    }
  });
  return output;
}

function record(type, detail = {}) {
  if (!enabled) return null;
  const context = currentContext();
  const row = Object.freeze({
    id: nextId('BEVT'),
    sessionId,
    requestId: context?.requestId || null,
    correlationId: context?.correlationId || null,
    endpoint: context?.endpoint || null,
    type: clean(type, 100),
    timestamp: Date.now(),
    ...safeDetail(detail)
  });
  events.push(row);
  if (events.length > limit) events.splice(0, events.length - limit);
  counters[row.type] = (counters[row.type] || 0) + 1;
  return row;
}

function start(name, detail = {}) {
  if (!enabled) return null;
  const operationId = nextId('BOP');
  active.set(operationId, {
    operationId,
    name: clean(name, 100),
    startedAt: now(),
    detail: safeDetail(detail),
    context: currentContext()
  });
  record(`${name}:start`, { operationId, ...detail });
  return operationId;
}

function end(operationId, detail = {}) {
  if (!enabled || !operationId) return null;
  const operation = active.get(operationId);
  if (!operation) return null;
  active.delete(operationId);
  const duration = Math.max(0, now() - operation.startedAt);
  const context = operation.context || currentContext();
  if (context && operation.name === 'sqlite:query') {
    context.sqliteMs = (Number(context.sqliteMs) || 0) + duration;
  }
  if (context && operation.name === 'backend:serialization') {
    context.serializationMs = (Number(context.serializationMs) || 0) + duration;
  }
  return record(`${operation.name}:end`, {
    operationId,
    duration: Number(duration.toFixed(3)),
    ...operation.detail,
    ...detail
  });
}

function measureSync(name, fn, detail = {}) {
  if (!enabled || typeof fn !== 'function') return fn();
  const operationId = start(name, detail);
  try {
    const result = fn();
    end(operationId, { outcome: 'returned' });
    return result;
  } catch (error) {
    end(operationId, { outcome: 'threw', error: clean(error?.message || error) });
    throw error;
  }
}

async function measureAsync(name, fn, detail = {}) {
  if (!enabled || typeof fn !== 'function') return fn();
  const operationId = start(name, detail);
  try {
    const result = await fn();
    end(operationId, { outcome: 'fulfilled' });
    return result;
  } catch (error) {
    end(operationId, { outcome: 'rejected', error: clean(error?.message || error) });
    throw error;
  }
}

function sqlIdentity(sql) {
  const normalized = String(sql || '')
    .replace(/'(?:''|[^'])*'/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  const operation = (normalized.match(/^(SELECT|INSERT|UPDATE|DELETE|PRAGMA|CREATE|ALTER|DROP)/i) || [])[1] || 'SQL';
  const tables = [];
  const regex = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([a-zA-Z_][\w]*)/gi;
  let match;
  while ((match = regex.exec(normalized)) && tables.length < 6) {
    if (!tables.includes(match[1])) tables.push(match[1]);
  }
  return {
    queryId: crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 12),
    operation: operation.toUpperCase(),
    tables: tables.join(',') || null
  };
}

function rowsFromCallback(method, args, callbackThis) {
  if (method === 'all' && Array.isArray(args[1])) return args[1].length;
  if (method === 'get') return args[1] ? 1 : 0;
  if (method === 'run') return Number(callbackThis?.changes) || 0;
  return null;
}

function installSqlite(db) {
  if (!enabled || sqliteInstalled || !db) return false;
  sqliteInstalled = true;
  ['all', 'get', 'run', 'each', 'exec'].forEach((method) => {
    if (typeof db[method] !== 'function') return;
    const original = db[method];
    db[method] = function instrumentedSqlite(sql) {
      if (!enabled) return original.apply(this, arguments);
      const args = Array.from(arguments);
      const identity = sqlIdentity(sql);
      const operationId = start('sqlite:query', {
        method,
        queryId: identity.queryId,
        operation: identity.operation,
        tables: identity.tables
      });
      const callbackIndex = args.length - 1;
      if (typeof args[callbackIndex] === 'function') {
        const callback = args[callbackIndex];
        args[callbackIndex] = function instrumentedCallback() {
          const callbackArgs = Array.from(arguments);
          end(operationId, {
            outcome: callbackArgs[0] ? 'error' : 'success',
            rows: rowsFromCallback(method, callbackArgs, this),
            error: callbackArgs[0] ? clean(callbackArgs[0].message || callbackArgs[0]) : null
          });
          return callback.apply(this, callbackArgs);
        };
        return original.apply(this, args);
      }
      try {
        const result = original.apply(this, args);
        end(operationId, { outcome: 'scheduled-no-callback', rows: null });
        return result;
      } catch (error) {
        end(operationId, { outcome: 'threw', error: clean(error?.message || error) });
        throw error;
      }
    };
  });
  record('sqlite:instrumentation-installed');
  return true;
}

function middleware(req, res, next) {
  if (!enabled) return next();
  const requestId = nextId('HTTP');
  const incomingCorrelation = clean(req.get?.('x-cds-performance-id') || '', 80);
  const correlationId = incomingCorrelation || requestId;
  const context = {
    requestId,
    correlationId,
    endpoint: routeTemplate(req),
    method: clean(req.method, 12),
    startedAt: now(),
    sqliteMs: 0,
    serializationMs: 0
  };

  return contextStorage.run(context, () => {
    const operationId = start('backend:request', {
      method: context.method,
      endpoint: context.endpoint,
      requestBytes: Number(req.get?.('content-length')) || null
    });
    const originalJson = res.json;
    const originalEnd = res.end;
    res.end = function instrumentedEnd() {
      try {
        if (!res.headersSent) {
          const elapsed = Math.max(0, now() - context.startedAt);
          const controller = Math.max(0, elapsed - context.sqliteMs - context.serializationMs);
          res.setHeader(
            'Server-Timing',
            `cds_total;dur=${elapsed.toFixed(2)}, cds_sqlite;dur=${context.sqliteMs.toFixed(2)}, `
              + `cds_serialize;dur=${context.serializationMs.toFixed(2)}, cds_controller;dur=${controller.toFixed(2)}`
          );
        }
      } catch { /* diagnostics never blocks response */ }
      return originalEnd.apply(this, arguments);
    };
    res.json = function instrumentedJson(body) {
      const serializeOp = start('backend:serialization', { endpoint: routeTemplate(req) });
      try {
        return originalJson.call(this, body);
      } finally {
        end(serializeOp, { responseBytes: Number(res.getHeader('content-length')) || null });
      }
    };
    res.setHeader('X-CDS-Performance-Id', correlationId);
    res.on('finish', () => {
      const duration = Math.max(0, now() - context.startedAt);
      end(operationId, {
        status: res.statusCode,
        responseBytes: Number(res.getHeader('content-length')) || null,
        totalDuration: Number(duration.toFixed(3)),
        sqliteDuration: Number(context.sqliteMs.toFixed(3)),
        serializationDuration: Number(context.serializationMs.toFixed(3)),
        controllerDuration: Number(Math.max(0, duration - context.sqliteMs - context.serializationMs).toFixed(3))
      });
    });
    next();
  });
}

function enable(options = {}) {
  enabled = true;
  if (Number.isFinite(Number(options.limit))) {
    limit = Math.max(100, Math.min(20000, Number(options.limit)));
  }
  record('diagnostics:enabled', { bufferLimit: limit });
  return getStatus();
}

function disable() {
  if (enabled) record('diagnostics:disabled');
  enabled = false;
  active.clear();
  return getStatus();
}

function clear() {
  events.length = 0;
  active.clear();
  Object.keys(counters).forEach((key) => delete counters[key]);
}

function getStatus() {
  return {
    enabled,
    sessionId,
    bufferSize: events.length,
    bufferLimit: limit,
    activeOperations: active.size,
    sqliteInstalled
  };
}

function getReport(options = {}) {
  const max = Math.max(1, Math.min(limit, Number(options.limit) || limit));
  const type = options.type ? String(options.type) : null;
  const filtered = type ? events.filter((event) => event.type.includes(type)) : events;
  return {
    generatedAt: new Date().toISOString(),
    status: getStatus(),
    counters: { ...counters },
    events: filtered.slice(-max)
  };
}

function lastEvents(type, max = 40) {
  return events.filter((event) => event.type.includes(type)).slice(-max);
}

function getSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    status: getStatus(),
    counters: { ...counters },
    requests: lastEvents('backend:request', 40),
    sqlite: lastEvents('sqlite:', 50),
    serialization: lastEvents('backend:serialization', 30),
    syncIo: lastEvents('dashboard:backup-sync-io', 20),
    slowEvents: events.filter((event) => Number(event.duration) >= 50).slice(-40)
  };
}

const api = {
  enable,
  disable,
  isEnabled: () => enabled,
  start,
  end,
  record,
  measureSync,
  measureAsync,
  middleware,
  installSqlite,
  getStatus,
  getReport,
  getSnapshot,
  clear,
  currentContext,
  sqlIdentity,
  _resetForTests() {
    disable();
    clear();
    limit = DEFAULT_LIMIT;
    seq = 0;
    sessionId = `BACKEND-${Date.now().toString(36)}`;
    sqliteInstalled = false;
  }
};

global.CDSPerformanceDiagnosticsBackend = api;
module.exports = api;
