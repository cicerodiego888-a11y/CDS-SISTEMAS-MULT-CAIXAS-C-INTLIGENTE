'use strict';

/**
 * RC12.2 — Telemetria / RUM / agregadores / summary API (observe-only).
 */

const assert = require('assert');
const path = require('path');
const http = require('http');
const express = require('express');

const root = path.resolve(__dirname, '..');
const obs = require(path.join(root, 'backend', 'observabilidade'));
const { createMetricsStore, aggregate } = require(path.join(root, 'backend', 'observabilidade', 'metricsAggregator'));
const { createResourceSampler } = require(path.join(root, 'backend', 'observabilidade', 'resourceSampler'));
const telemetryCollector = require(path.join(root, 'backend', 'observabilidade', 'telemetryCollector'));
const { ingestRumBatch, RUM_ALLOWED } = require(path.join(root, 'backend', 'observabilidade', 'rumIngest'));
const observabilidadeRoutes = require(path.join(root, 'backend', 'rotas', 'observabilidade'));
const { isPublicApiPath } = require(path.join(root, 'backend', 'middleware', 'apiPublicPaths'));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function request(app, method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const payload = body != null ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: url,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers
        }
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          server.close();
          let json = null;
          try { json = JSON.parse(data); } catch (_) { json = data; }
          resolve({ status: res.statusCode, body: json });
        });
      });
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

async function main() {
  console.log('\n=== RC12.2 — Telemetria e RUM ===\n');

  obs._resetForTests();
  telemetryCollector._resetForTests();
  telemetryCollector.start();

  // 1) Agregadores
  const store = createMetricsStore({ maxSamples: 100 });
  [10, 20, 30, 40, 50, 100].forEach((v) => store.push('t', v));
  const st = store.stats('t');
  assert.strictEqual(st.count, 6);
  assert.ok(st.p50 != null && st.p95 != null);
  assert.strictEqual(st.min, 10);
  assert.strictEqual(st.max, 100);
  const a = aggregate([1, 2, 3, 4]);
  assert.strictEqual(a.count, 4);
  assert.ok(a.avg > 0);
  console.log('  OK  agregadores p50/p95/avg/min/max/count');

  // 2) RUM ingest whitelist + sanitização
  assert.ok(RUM_ALLOWED.has(obs.EVENT_NAMES.AUTH_LOGIN_DURATION));
  const rejected = ingestRumBatch({
    event_name: 'HACK_EVENT',
    payload: { token: 'secret', page: 'x' }
  });
  assert.strictEqual(rejected.accepted, 0);

  const syncEvents = [];
  const unsub = obs.subscribe('*', (e) => syncEvents.push(e));
  const okLogin = ingestRumBatch({
    event_name: obs.EVENT_NAMES.AUTH_LOGIN_DURATION,
    duracao_ms: 123.4,
    payload: {
      page: 'login',
      token: 'MUST_NOT_PASS',
      xml: '<NFe>segredo</NFe>',
      cpf: '12345678901',
      phase: 'auth_login',
      ok: true
    }
  });
  assert.strictEqual(okLogin.accepted, 1);
  await sleep(30);
  unsub();

  // publish is async via setImmediate — force sync path for assert
  const syncResult = obs._publishSyncForTests({
    event_name: obs.EVENT_NAMES.MODULE_LAZY_CREATED,
    categoria: obs.CATEGORIAS.PERFORMANCE,
    origem: 'test',
    duracao_ms: 55,
    payload: {
      page: 'produtos',
      token: 'abc',
      xml: '<?xml version="1.0"?><NFe/>',
      first_open: true
    }
  });
  assert.ok(syncResult && syncResult.accepted);
  const syncEnv = syncResult.envelope;
  assert.ok(syncEnv && syncEnv.payload);
  const payloadJson = JSON.stringify(syncEnv.payload || {});
  assert.ok(!payloadJson.includes('<NFe'));
  assert.ok(
    syncEnv.payload.token === '[REDACTED]'
      || String(syncEnv.payload.token || '').includes('REDACTED')
  );
  assert.ok(
    typeof syncEnv.payload.xml === 'string'
      && syncEnv.payload.xml.includes('REDACTED')
  );

  const rumSan = ingestRumBatch({
    event_name: obs.EVENT_NAMES.MODULE_LAZY_CREATED,
    duracao_ms: 10,
    payload: {
      page: 'produtos',
      token: 'MUST_NOT_PASS',
      xml: '<NFe>x</NFe>',
      first_open: true,
      scripts: 2
    }
  });
  assert.strictEqual(rumSan.accepted, 1);
  console.log('  OK  RUM whitelist + sanitização (sem token/XML)');

  // 3) Collector domains
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.BOOT_HTTP_LISTENING,
    duracao_ms: 12,
    timestamp: new Date().toISOString(),
    payload: {}
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.BOOT_BACKGROUND_READY,
    duracao_ms: 200,
    timestamp: new Date().toISOString(),
    payload: {}
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.AUTH_LOGIN_DURATION,
    duracao_ms: 150,
    timestamp: new Date().toISOString(),
    payload: { phase: 'auth_login' }
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.MODULE_LAZY_CREATED,
    duracao_ms: 80,
    timestamp: new Date().toISOString(),
    payload: { page: 'produtos', first_open: true }
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.MODULE_LAZY_REUSED,
    duracao_ms: 5,
    timestamp: new Date().toISOString(),
    payload: { page: 'produtos', reuse: true }
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.MIIP_IDENTIFY_FINISHED,
    duracao_ms: 40,
    timestamp: new Date().toISOString(),
    payload: {}
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.CENTRAL_SYNC_CONCLUIDA,
    duracao_ms: 90,
    timestamp: new Date().toISOString(),
    payload: {}
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.SOAP_FINALIZADO,
    duracao_ms: 300,
    timestamp: new Date().toISOString(),
    payload: {}
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.RESOURCE_SAMPLE,
    timestamp: new Date().toISOString(),
    payload: {
      heap_rss_mb: 100,
      heap_used_mb: 50,
      cpu_percent: 2.5,
      event_loop_delay_ms: 1.2,
      uptime_s: 10,
      sample_n: 1
    }
  });

  const summary = telemetryCollector.getSummary();
  assert.ok(summary.boot);
  assert.ok(summary.login);
  assert.ok(summary.lazy);
  assert.ok(summary.miip);
  assert.ok(summary.central);
  assert.ok(summary.nfe);
  assert.ok(summary.background);
  assert.ok(summary.recursos);
  assert.ok(summary.lazy.created >= 1);
  assert.ok(summary.lazy.reused >= 1);
  assert.ok(summary.recursos.ultimo);
  assert.strictEqual(summary.versao_schema, 'obs.v1');
  console.log('  OK  summary contém Boot/Login/Lazy/MIIP/Central/NF-e/Background/Recursos');

  // 4) Resource sampler
  const published = [];
  const sampler = createResourceSampler({
    intervalMs: 60000,
    publish: (partial) => {
      published.push(partial);
      return obs._publishSyncForTests(partial);
    }
  });
  const sample = sampler.publishSample();
  assert.ok(sample.heap_rss_mb > 0);
  assert.ok(sample.heap_used_mb > 0);
  assert.ok(typeof sample.cpu_percent === 'number');
  assert.ok(sample.uptime_s >= 0);
  assert.strictEqual(published[0].event_name, obs.EVENT_NAMES.RESOURCE_SAMPLE);
  sampler.stop();
  console.log('  OK  resource sampler (RSS/Used/CPU/EL Delay/Uptime)');

  // 5) API GET /summary + POST /rum
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 1, perfil: 'SUPER_ADMIN' };
    next();
  });
  app.use('/api/observabilidade', observabilidadeRoutes);
  const rumRes = await request(app, 'POST', '/api/observabilidade/rum', {
    event_name: 'MODULE_OPEN',
    duracao_ms: 1,
    payload: { page: 'dashboard', phase: 'module_open' }
  });
  assert.ok(rumRes.status === 202 || rumRes.status === 400);
  assert.ok(rumRes.body.accepted >= 1);

  const sumRes = await request(app, 'GET', '/api/observabilidade/summary');
  assert.strictEqual(sumRes.status, 200);
  assert.strictEqual(sumRes.body.ok, true);
  assert.ok(sumRes.body.boot);
  assert.ok(sumRes.body.recursos);
  assert.ok(sumRes.body.kpis);
  assert.ok(sumRes.body.status);
  assert.ok(Array.isArray(sumRes.body.recent));
  console.log('  OK  GET /api/observabilidade/summary + POST /rum');

  const appDenied = express();
  appDenied.use(express.json());
  appDenied.use((req, _res, next) => {
    req.user = { id: 2, perfil: 'USUARIO' };
    next();
  });
  appDenied.use('/api/observabilidade', observabilidadeRoutes);
  const denied = await request(appDenied, 'GET', '/api/observabilidade/summary');
  assert.strictEqual(denied.status, 403);
  console.log('  OK  summary bloqueado para não SUPER_ADMIN');

  // 6) Public path só rum
  assert.strictEqual(isPublicApiPath('/api/observabilidade/rum'), true);
  assert.strictEqual(isPublicApiPath('/api/observabilidade/summary'), false);
  console.log('  OK  rum público; summary autenticado');

  // 7) Event names RC12.2 no catálogo
  for (const name of [
    'AUTH_LOGIN_DURATION',
    'MODULE_OPEN',
    'MODULE_LAZY_CREATED',
    'MODULE_LAZY_REUSED',
    'MODULE_LAZY_ERROR',
    'RESOURCE_SAMPLE'
  ]) {
    assert.ok(obs.EVENT_NAMES[name], name);
  }
  console.log('  OK  catálogo EVENT_NAMES RC12.2');

  // Compat: RC12.1 ainda ok
  const built = obs.buildEnvelope({
    event_name: obs.EVENT_NAMES.BOOT_STARTED,
    categoria: obs.CATEGORIAS.PLATFORM,
    origem: 'test',
    payload: {}
  });
  assert.strictEqual(built.ok, true);
  console.log('  OK  compatibilidade Event Bus RC12.1');

  obs._resetForTests();
  console.log('\n=== RC12.2 — TODOS OS TESTES APROVADOS ===\n');
}

main().catch((err) => {
  console.error('\nFALHA RC12.2:', err);
  process.exit(1);
});
