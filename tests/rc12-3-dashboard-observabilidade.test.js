'use strict';

/**
 * RC12.3 — Dashboard Oficial de Observabilidade (READ-ONLY).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const root = path.resolve(__dirname, '..');
const obs = require(path.join(root, 'backend', 'observabilidade'));
const telemetryCollector = require(path.join(root, 'backend', 'observabilidade', 'telemetryCollector'));
const {
  enrichSummaryForDashboard,
  buildStatus,
  buildKpis,
  buildRecent,
  STATUS
} = require(path.join(root, 'backend', 'observabilidade', 'dashboardView'));
const observabilidadeRoutes = require(path.join(root, 'backend', 'rotas', 'observabilidade'));

function request(app, method, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: url,
        method,
        headers
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
      req.end();
    });
  });
}

function assertFileContains(filePath, snippets) {
  const text = fs.readFileSync(filePath, 'utf8');
  for (const s of snippets) {
    assert.ok(text.includes(s), `${path.basename(filePath)} deve conter: ${s}`);
  }
}

async function main() {
  console.log('\n=== RC12.3 — Dashboard Observabilidade ===\n');

  obs._resetForTests();
  telemetryCollector._resetForTests();
  telemetryCollector.start();

  // Seed métricas
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.BOOT_HTTP_LISTENING,
    duracao_ms: 120,
    timestamp: new Date().toISOString(),
    payload: {}
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.AUTH_LOGIN_DURATION,
    duracao_ms: 180,
    timestamp: new Date().toISOString(),
    payload: {}
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.MODULE_LAZY_CREATED,
    duracao_ms: 90,
    timestamp: new Date().toISOString(),
    payload: {}
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.MIIP_IDENTIFY_FINISHED,
    duracao_ms: 40,
    timestamp: new Date().toISOString(),
    payload: {}
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.CENTRAL_SYNC_CONCLUIDA,
    duracao_ms: 70,
    timestamp: new Date().toISOString(),
    payload: {}
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.SOAP_FINALIZADO,
    duracao_ms: 250,
    timestamp: new Date().toISOString(),
    payload: {}
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.BOOT_BACKGROUND_READY,
    duracao_ms: 400,
    timestamp: new Date().toISOString(),
    payload: {}
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.RESOURCE_SAMPLE,
    timestamp: new Date().toISOString(),
    payload: {
      heap_rss_mb: 180,
      heap_used_mb: 90,
      cpu_percent: 12,
      event_loop_delay_ms: 3,
      uptime_s: 20,
      sample_n: 1
    }
  });

  // Publica no bus para histórico recent
  obs._publishSyncForTests({
    event_name: obs.EVENT_NAMES.BOOT_STARTED,
    categoria: obs.CATEGORIAS.PLATFORM,
    origem: 'test',
    payload: {}
  });
  obs._publishSyncForTests({
    event_name: obs.EVENT_NAMES.AUTH_LOGIN_DURATION,
    categoria: obs.CATEGORIAS.SECURITY,
    origem: 'test',
    duracao_ms: 100,
    payload: { phase: 'auth_login' }
  });
  obs._publishSyncForTests({
    event_name: obs.EVENT_NAMES.MODULE_OPEN,
    categoria: obs.CATEGORIAS.UX,
    origem: 'test',
    payload: { page: 'dashboard' }
  });
  obs._publishSyncForTests({
    event_name: obs.EVENT_NAMES.RESOURCE_SAMPLE,
    categoria: obs.CATEGORIAS.PLATFORM,
    origem: 'test',
    payload: { heap_rss_mb: 100, heap_used_mb: 50, cpu_percent: 1, event_loop_delay_ms: 1, uptime_s: 1, sample_n: 2 }
  });

  const summary = enrichSummaryForDashboard(telemetryCollector.getSummary());
  assert.strictEqual(summary.read_only, true);
  assert.ok(summary.kpis);
  assert.ok(summary.status);
  assert.ok(Array.isArray(summary.recent));

  for (const key of ['boot', 'login', 'erp', 'miip', 'nfe', 'central', 'recursos']) {
    assert.ok(summary.kpis[key], `kpi ${key}`);
  }
  for (const key of ['boot', 'login', 'erp', 'miip', 'nfe', 'central', 'recursos']) {
    assert.ok(summary.status.por_dominio[key], `status ${key}`);
  }
  assert.ok([STATUS.SAUDAVEL, STATUS.ATENCAO, STATUS.CRITICO].includes(summary.status.geral));
  console.log('  OK  KPIs + status (saudável/atenção/crítico)');

  const recent = buildRecent(50);
  const grupos = new Set(recent.map((r) => r.grupo));
  assert.ok(grupos.has('BOOT') || grupos.has('LOGIN') || grupos.has('MODULE') || grupos.has('RESOURCE_SAMPLE'));
  console.log('  OK  histórico recent filtrado por grupos oficiais');

  // Status crítico sintético
  const crit = buildStatus({
    boot: { duration_ms: { p95: 9000, avg: 9000, max: 9000, count: 1 } },
    login: { duration_ms: { p95: 100, avg: 100, max: 100, count: 1 } },
    lazy: { first_open_ms: { p95: 100 }, created: 0, reused: 0, errors: 0 },
    miip: { duration_ms: { p95: 10 } },
    nfe: { duration_ms: { p95: 10 } },
    central: { duration_ms: { p95: 10 } },
    recursos: { ultimo: { heap_rss_mb: 100, heap_used_mb: 40, cpu_percent: 5, event_loop_delay_ms: 2 } }
  });
  assert.strictEqual(crit.por_dominio.boot, STATUS.CRITICO);
  assert.strictEqual(crit.geral, STATUS.CRITICO);
  console.log('  OK  limiares de status baseados só em métricas');

  const kpis = buildKpis(summary);
  assert.ok(kpis.boot);
  assert.ok('media' in kpis.boot && 'p50' in kpis.boot && 'p95' in kpis.boot && 'maximo' in kpis.boot);
  console.log('  OK  cartões KPI com média/p50/p95/máximo');

  // API SUPER_ADMIN
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1, perfil: 'SUPER_ADMIN' }; next(); });
  app.use('/api/observabilidade', observabilidadeRoutes);
  const ok = await request(app, 'GET', '/api/observabilidade/summary');
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.ok, true);
  assert.ok(ok.body.kpis);
  assert.ok(ok.body.status);
  assert.ok(Array.isArray(ok.body.recent));
  assert.strictEqual(ok.body.read_only, true);
  console.log('  OK  GET /summary SUPER_ADMIN');

  const appNo = express();
  appNo.use((req, _res, next) => { req.user = { id: 2, perfil: 'ADMIN' }; next(); });
  appNo.use('/api/observabilidade', observabilidadeRoutes);
  const no = await request(appNo, 'GET', '/api/observabilidade/summary');
  assert.strictEqual(no.status, 403);
  console.log('  OK  GET /summary negado para ADMIN (somente SUPER_ADMIN)');

  // Frontend wiring
  assertFileContains(path.join(root, 'frontend', 'erp', 'index.html'), [
    'data-page="observabilidade"',
    'nav-observabilidade',
    '/erp/js/observabilidade.js'
  ]);
  assertFileContains(path.join(root, 'frontend', 'erp', 'js', 'app.js'), [
    "observabilidade: ['/erp/js/observabilidade.js']",
    "case 'observabilidade':",
    'loadObservabilidade'
  ]);
  assertFileContains(path.join(root, 'frontend', 'shared', 'js', 'access-control.js'), [
    "page === 'observabilidade'"
  ]);
  assertFileContains(path.join(root, 'frontend', 'erp', 'js', 'observabilidade.js'), [
    '/observabilidade/summary',
    'READ-ONLY',
    'isSuperAdminUser'
  ]);
  assertFileContains(path.join(root, 'frontend', 'erp', 'pages', 'observabilidade.html'), [
    'cdsObsKpis',
    'cdsObsRecentBody',
    'Lazy Created'
  ]);
  assert.ok(fs.existsSync(path.join(root, 'frontend', 'erp', 'pages', 'observabilidade.html')));
  console.log('  OK  menu Administração + tela ERP SUPER_ADMIN');

  // Sem escrita na rota summary (método)
  assert.ok(!String(fs.readFileSync(path.join(root, 'backend', 'rotas', 'observabilidade.js'), 'utf8'))
    .match(/router\.(post|put|patch|delete)\(['"]\/summary/));
  console.log('  OK  summary é somente leitura');

  obs._resetForTests();
  console.log('\n=== RC12.3 — TODOS OS TESTES APROVADOS ===\n');
}

main().catch((err) => {
  console.error('\nFALHA RC12.3:', err);
  process.exit(1);
});
