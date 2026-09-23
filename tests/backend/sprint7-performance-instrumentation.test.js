/**
 * Sprint 7.0 — infraestrutura de diagnóstico backend/SQLite.
 * node --test tests/backend/sprint7-performance-instrumentation.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PerformanceMonitor = require('../../backend/observabilidade/performance/PerformanceMonitor');

describe('Sprint 7.0 — PerformanceMonitor backend', () => {
  beforeEach(() => {
    PerformanceMonitor._resetForTests();
  });

  it('fica OFF após reset e start não coleta', () => {
    assert.equal(PerformanceMonitor.isEnabled(), false);
    assert.equal(PerformanceMonitor.start('backend:request'), null);
    assert.equal(PerformanceMonitor.getReport().events.length, 0);
  });

  it('inicia e finaliza medição com sessão identificada', () => {
    PerformanceMonitor.enable();
    const operation = PerformanceMonitor.start('backend:request', { endpoint: '/api/clientes' });
    const result = PerformanceMonitor.end(operation, { status: 200 });
    assert.match(PerformanceMonitor.getStatus().sessionId, /^BACKEND-/);
    assert.equal(result.type, 'backend:request:end');
    assert.equal(typeof result.duration, 'number');
  });

  it('buffer é limitado e descarta eventos antigos', () => {
    PerformanceMonitor.enable({ limit: 100 });
    for (let i = 0; i < 130; i += 1) {
      PerformanceMonitor.record('buffer:test', { index: i });
    }
    const report = PerformanceMonitor.getReport();
    assert.equal(report.events.length, 100);
    assert.ok(report.events[0].index >= 30);
  });

  it('sqlIdentity não guarda literais', () => {
    const identity = PerformanceMonitor.sqlIdentity(
      "SELECT * FROM clientes WHERE cpf_cnpj = '12345678901' AND id = 44"
    );
    assert.equal(identity.operation, 'SELECT');
    assert.match(identity.tables, /clientes/);
    assert.equal(identity.queryId.length, 12);
  });

  it('middleware não altera resposta quando OFF', () => {
    const calls = [];
    PerformanceMonitor.middleware(
      { method: 'GET', path: '/api/clientes', get: () => null },
      { json() {}, end() {}, on() {}, setHeader() { calls.push('header'); } },
      () => calls.push('next')
    );
    assert.deepEqual(calls, ['next']);
  });

  it('middleware mede request quando ON e redige dados sensíveis', () => {
    PerformanceMonitor.enable();
    const headers = {};
    const listeners = {};
    const res = {
      headersSent: false,
      statusCode: 200,
      setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
      getHeader(name) { return headers[String(name).toLowerCase()] || null; },
      json(body) { return body; },
      end() { return true; },
      on(event, fn) { listeners[event] = fn; }
    };
    PerformanceMonitor.middleware(
      {
        method: 'GET',
        path: '/api/clientes/12',
        baseUrl: '/api/clientes',
        route: { path: '/:id' },
        get(name) {
          if (String(name).toLowerCase() === 'authorization') return 'Bearer secret';
          return null;
        }
      },
      res,
      () => {
        res.json({ token: 'segredo', ok: true });
        res.end();
        listeners.finish();
      }
    );
    const snapshot = PerformanceMonitor.getSnapshot();
    assert.equal(headers['x-cds-performance-id'] != null, true);
    assert.match(String(headers['server-timing'] || ''), /cds_total/);
    assert.ok(snapshot.requests.some((event) => event.endpoint === '/api/clientes/:id'));
    const recorded = PerformanceMonitor.getReport().events.find((event) => event.token);
    assert.ok(!recorded || recorded.token === '[redacted]');
  });

  it('measureSync preserva retorno e captura I/O síncrono', () => {
    PerformanceMonitor.enable();
    const value = PerformanceMonitor.measureSync('dashboard:backup-sync-io', () => 7, { limit: 1000 });
    assert.equal(value, 7);
    const events = PerformanceMonitor.getReport({ type: 'dashboard:backup-sync-io' }).events;
    assert.ok(events.some((event) => event.type === 'dashboard:backup-sync-io:end'));
  });

  it('installSqlite envolve callbacks sem alterar resultado', () => {
    PerformanceMonitor.enable();
    const db = {
      all(sql, params, callback) {
        callback(null, [{ id: 1 }, { id: 2 }]);
      }
    };
    assert.equal(PerformanceMonitor.installSqlite(db), true);
    let rows = null;
    db.all('SELECT id FROM clientes ORDER BY nome', [], (err, data) => {
      rows = data;
    });
    assert.equal(rows.length, 2);
    const sqlite = PerformanceMonitor.getSnapshot().sqlite;
    assert.ok(sqlite.some((event) => event.type === 'sqlite:query:end' && event.rows === 2));
  });
});
