'use strict';

/**
 * RC12.5 — Histórico, retenção, agregação e exportação.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const root = path.resolve(__dirname, '..');
const obs = require(path.join(root, 'backend', 'observabilidade'));
const { ensureHistorySchema, retencaoParaNivel, RETENCAO_POR_NIVEL: _ } = require(path.join(root, 'backend', 'observabilidade', 'historySchema'));
const { createHistoryRepository } = require(path.join(root, 'backend', 'observabilidade', 'historyRepository'));
const historyService = require(path.join(root, 'backend', 'observabilidade', 'historyService'));
const telemetryCollector = require(path.join(root, 'backend', 'observabilidade', 'telemetryCollector'));
const alertEngine = require(path.join(root, 'backend', 'observabilidade', 'alertEngine'));
const { RETENCAO_POR_NIVEL } = require(path.join(root, 'backend', 'observabilidade', 'eventPolicies'));
const observabilidadeRoutes = require(path.join(root, 'backend', 'rotas', 'observabilidade'));

function openMemoryDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(db)));
  });
}

function request(app, method, url) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: url,
        method
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          server.close();
          const buf = Buffer.concat(chunks);
          const text = buf.toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch (_) { json = text; }
          resolve({ status: res.statusCode, body: json, text, headers: res.headers });
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

async function main() {
  console.log('\n=== RC12.5 — Histórico e Retenção ===\n');

  obs._resetForTests();
  historyService._resetForTests();
  telemetryCollector._resetForTests();
  alertEngine._resetForTests();
  telemetryCollector.start();
  alertEngine.start();

  // Políticas oficiais
  assert.strictEqual(RETENCAO_POR_NIVEL.DEBUG, 3);
  assert.strictEqual(RETENCAO_POR_NIVEL.INFO, 30);
  assert.strictEqual(RETENCAO_POR_NIVEL.WARN, 90);
  assert.strictEqual(RETENCAO_POR_NIVEL.ERROR, 180);
  assert.strictEqual(RETENCAO_POR_NIVEL.CRITICAL, 365);
  assert.strictEqual(retencaoParaNivel('INFO'), 30);
  console.log('  OK  políticas DEBUG/INFO/WARN/ERROR/CRITICAL');

  const db = await openMemoryDb();
  await ensureHistorySchema(db);
  const repo = createHistoryRepository(db);
  historyService._setRepoForTests(repo);

  // Seed collector
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.BOOT_HTTP_LISTENING,
    duracao_ms: 120,
    timestamp: new Date().toISOString(),
    payload: {}
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.AUTH_LOGIN_DURATION,
    duracao_ms: 200,
    timestamp: new Date().toISOString(),
    payload: {}
  });
  telemetryCollector.onEvent({
    event_name: obs.EVENT_NAMES.RESOURCE_SAMPLE,
    timestamp: new Date().toISOString(),
    payload: {
      heap_rss_mb: 220,
      heap_used_mb: 110,
      cpu_percent: 15,
      event_loop_delay_ms: 4,
      uptime_s: 50,
      sample_n: 1
    }
  });

  // Snapshot
  const snap = await historyService.takeSnapshot();
  assert.ok(snap && snap.id);
  const count = await repo.countSnapshots();
  assert.ok(count >= 1);
  console.log('  OK  snapshot periódico (KPIs/alertas/recursos)');

  // Mais snapshots sintéticos para agregação
  const now = Date.now();
  for (let i = 0; i < 5; i += 1) {
    await repo.insertSnapshot({
      created_at: new Date(now - i * 3600 * 1000).toISOString(),
      nivel: 'INFO',
      retencao_dias: 30,
      boot_ms: 100 + i * 10,
      login_ms: 150 + i * 5,
      lazy_first_ms: 80 + i,
      lazy_reuse_ms: 5,
      lazy_created: 1,
      lazy_reused: i,
      recursos_rss_mb: 200 + i,
      recursos_heap_mb: 100,
      recursos_cpu: 10 + i,
      recursos_el_ms: 2 + i,
      recursos_uptime_s: 100,
      miip_ms: 40,
      central_ms: 50,
      nfe_ms: 60,
      background_ms: 70,
      alerts_ativos: i,
      payload_json: '{}'
    });
  }

  const agg = await historyService.runAggregation();
  assert.ok(agg);
  assert.ok(agg.hora >= 1 || agg.dia >= 1);
  const aggs = await repo.listAggregates({ periodo_tipo: 'hora', limit: 100 });
  assert.ok(aggs.length >= 1);
  const sample = aggs[0];
  assert.ok('avg_value' in sample && 'min_value' in sample && 'max_value' in sample);
  assert.ok('p50_value' in sample && 'p95_value' in sample);
  console.log('  OK  agregação hora/dia/semana/mês (avg/min/max/p50/p95)');

  // Retenção: inserir snapshot antigo com retencao_dias=0 → delete
  await repo.insertSnapshot({
    created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    nivel: 'DEBUG',
    retencao_dias: 1,
    boot_ms: 1,
    login_ms: null,
    lazy_first_ms: null,
    lazy_reuse_ms: null,
    lazy_created: 0,
    lazy_reused: 0,
    recursos_rss_mb: null,
    recursos_heap_mb: null,
    recursos_cpu: null,
    recursos_el_ms: null,
    recursos_uptime_s: null,
    miip_ms: null,
    central_ms: null,
    nfe_ms: null,
    background_ms: null,
    alerts_ativos: 0,
    payload_json: '{}'
  });
  const before = await repo.countSnapshots();
  const cleaned = await historyService.runRetention();
  assert.ok(cleaned);
  const after = await repo.countSnapshots();
  assert.ok(after <= before);
  assert.ok((cleaned.snapshots_removed || 0) >= 1);
  console.log('  OK  retenção automática remove expirados');

  // History summary + compare + export
  const hist = await historyService.getHistorySummary({
    from: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    to: new Date().toISOString(),
    periodo_tipo: 'hora'
  });
  assert.ok(hist.series);
  assert.ok(hist.series.boot_ms);
  console.log('  OK  history summary com séries');

  const cmp = await historyService.comparePeriods(
    { from: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), to: new Date().toISOString() },
    { from: new Date(Date.now() - 48 * 3600 * 1000).toISOString(), to: new Date(Date.now() - 24 * 3600 * 1000).toISOString() }
  );
  assert.ok(cmp.metrics);
  console.log('  OK  comparação entre períodos');

  const jsonExp = await historyService.exportHistory({ format: 'json', tipo: 'snapshots' });
  assert.ok(jsonExp.body.includes('"ok": true') || jsonExp.body.includes('"ok":true'));
  const csvExp = await historyService.exportHistory({ format: 'csv', tipo: 'snapshots' });
  assert.ok(csvExp.body.includes('created_at'));
  assert.ok(csvExp.contentType.includes('csv'));
  console.log('  OK  exportação JSON/CSV');

  // API
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1, perfil: 'SUPER_ADMIN' }; next(); });
  app.use('/api/observabilidade', observabilidadeRoutes);

  const hRes = await request(app, 'GET', '/api/observabilidade/history?hours=48');
  assert.strictEqual(hRes.status, 200);
  assert.ok(hRes.body.ok);
  assert.ok(hRes.body.series);

  const aRes = await request(app, 'GET', '/api/observabilidade/history/aggregates?periodo_tipo=hora');
  assert.strictEqual(aRes.status, 200);
  assert.ok(Array.isArray(aRes.body.rows));

  const eRes = await request(app, 'GET', '/api/observabilidade/history/export?format=csv&tipo=snapshots&hours=48');
  assert.strictEqual(eRes.status, 200);
  assert.ok(String(eRes.text).includes('created_at'));
  console.log('  OK  API history / aggregates / export');

  // UI
  const html = fs.readFileSync(path.join(root, 'frontend', 'erp', 'pages', 'observabilidade.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'frontend', 'erp', 'js', 'observabilidade.js'), 'utf8');
  assert.ok(html.includes('cdsObsHistoryPanel'));
  assert.ok(html.includes('cdsObsHistChart'));
  assert.ok(js.includes('/observabilidade/history'));
  assert.ok(js.includes('exportHistory'));
  console.log('  OK  dashboard período/gráficos/exportação');

  // Sem escrita nas rotas history
  const rota = fs.readFileSync(path.join(root, 'backend', 'rotas', 'observabilidade.js'), 'utf8');
  assert.ok(!rota.match(/router\.(post|put|patch|delete)\(['"]\/history/));
  console.log('  OK  history API somente leitura');

  db.close();
  obs._resetForTests();
  console.log('\n=== RC12.5 — TODOS OS TESTES APROVADOS ===\n');
}

main().catch((err) => {
  console.error('\nFALHA RC12.5:', err);
  process.exit(1);
});
