'use strict';

/**
 * RC12.4 — Alert Engine (regras + dedupe + API read-only).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const root = path.resolve(__dirname, '..');
const obs = require(path.join(root, 'backend', 'observabilidade'));
const alertEngine = require(path.join(root, 'backend', 'observabilidade', 'alertEngine'));
const observabilidadeRoutes = require(path.join(root, 'backend', 'rotas', 'observabilidade'));

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

async function main() {
  console.log('\n=== RC12.4 — Alert Engine ===\n');

  obs._resetForTests();
  alertEngine._resetForTests();
  alertEngine.start();

  const requiredRules = [
    'BOOT_LENTO',
    'LOGIN_LENTO',
    'MODULE_LENTO',
    'MIIP_LENTO',
    'CENTRAL_PARADA',
    'SOAP_TIMEOUT',
    'NFE_FILA_ALTA',
    'RESOURCE_MEMORY_HIGH',
    'RESOURCE_CPU_HIGH',
    'EVENT_LOOP_HIGH'
  ];
  for (const code of requiredRules) {
    assert.ok(alertEngine.RULES[code], `regra ${code}`);
  }
  console.log('  OK  10 regras oficiais presentes');

  // BOOT_LENTO
  alertEngine.evaluateEnvelope({
    event_name: obs.EVENT_NAMES.BOOT_HTTP_LISTENING,
    duracao_ms: 6000,
    origem: 'test',
    payload: {}
  });
  let ativos = alertEngine.listAlerts({ status: 'ativo' });
  assert.ok(ativos.some((a) => a.rule === 'BOOT_LENTO'));
  console.log('  OK  BOOT_LENTO');

  // Dedupe
  const before = alertEngine.listAlerts({ status: 'historico' }).filter((a) => a.rule === 'BOOT_LENTO').length;
  alertEngine.evaluateEnvelope({
    event_name: obs.EVENT_NAMES.BOOT_HTTP_LISTENING,
    duracao_ms: 7000,
    origem: 'test',
    payload: {}
  });
  const after = alertEngine.listAlerts({ status: 'historico' }).filter((a) => a.rule === 'BOOT_LENTO' && a.status === 'ativo').length;
  assert.ok(after <= before + 0 || alertEngine.listAlerts({ status: 'ativo' }).find((a) => a.rule === 'BOOT_LENTO').occurrences >= 2);
  const boot = alertEngine.listAlerts({ status: 'ativo' }).find((a) => a.rule === 'BOOT_LENTO');
  assert.ok(boot.fingerprint);
  assert.ok(boot.occurrences >= 2);
  console.log('  OK  dedupe (fingerprint + janela) incrementa occurrences');

  // LOGIN / MODULE / MIIP
  alertEngine.evaluateEnvelope({
    event_name: obs.EVENT_NAMES.AUTH_LOGIN_DURATION,
    duracao_ms: 5000,
    origem: 'test',
    payload: {}
  });
  alertEngine.evaluateEnvelope({
    event_name: obs.EVENT_NAMES.MODULE_LAZY_CREATED,
    duracao_ms: 8000,
    origem: 'test',
    payload: { page: 'produtos' }
  });
  alertEngine.evaluateEnvelope({
    event_name: obs.EVENT_NAMES.MIIP_IDENTIFY_FINISHED,
    duracao_ms: 3500,
    origem: 'test',
    payload: {}
  });
  ativos = alertEngine.listAlerts({ status: 'ativo' });
  assert.ok(ativos.some((a) => a.rule === 'LOGIN_LENTO'));
  assert.ok(ativos.some((a) => a.rule === 'MODULE_LENTO'));
  assert.ok(ativos.some((a) => a.rule === 'MIIP_LENTO'));
  console.log('  OK  LOGIN_LENTO / MODULE_LENTO / MIIP_LENTO');

  // CENTRAL_PARADA via erro
  alertEngine.evaluateEnvelope({
    event_name: obs.EVENT_NAMES.CENTRAL_SYNC_ERRO,
    origem: 'test',
    payload: {}
  });
  assert.ok(alertEngine.listAlerts({ status: 'ativo' }).some((a) => a.rule === 'CENTRAL_PARADA'));
  console.log('  OK  CENTRAL_PARADA');

  // SOAP_TIMEOUT
  alertEngine.evaluateEnvelope({
    event_name: obs.EVENT_NAMES.SOAP_TIMEOUT,
    duracao_ms: 5000,
    origem: 'test',
    payload: {}
  });
  assert.ok(alertEngine.listAlerts({ status: 'ativo' }).some((a) => a.rule === 'SOAP_TIMEOUT'));
  console.log('  OK  SOAP_TIMEOUT');

  // NFE_FILA_ALTA
  for (let i = 0; i < 10; i += 1) {
    alertEngine.evaluateEnvelope({
      event_name: obs.EVENT_NAMES.SOAP_INICIADO,
      origem: 'test',
      payload: {}
    });
  }
  assert.ok(alertEngine.listAlerts({ status: 'ativo' }).some((a) => a.rule === 'NFE_FILA_ALTA'));
  console.log('  OK  NFE_FILA_ALTA (proxy SOAP in-flight)');

  // Recursos
  alertEngine.evaluateEnvelope({
    event_name: obs.EVENT_NAMES.RESOURCE_SAMPLE,
    origem: 'test',
    payload: {
      heap_rss_mb: 1500,
      heap_used_mb: 800,
      cpu_percent: 90,
      event_loop_delay_ms: 250,
      uptime_s: 100,
      sample_n: 1
    }
  });
  ativos = alertEngine.listAlerts({ status: 'ativo' });
  assert.ok(ativos.some((a) => a.rule === 'RESOURCE_MEMORY_HIGH'));
  assert.ok(ativos.some((a) => a.rule === 'RESOURCE_CPU_HIGH'));
  assert.ok(ativos.some((a) => a.rule === 'EVENT_LOOP_HIGH'));
  console.log('  OK  RESOURCE_MEMORY_HIGH / RESOURCE_CPU_HIGH / EVENT_LOOP_HIGH');

  const summary = alertEngine.getAlertsSummary();
  assert.ok(summary.ativos >= 1);
  assert.ok(summary.por_severidade);
  assert.ok(Array.isArray(summary.regras));
  assert.strictEqual(summary.read_only, true);
  console.log('  OK  alerts summary contadores');

  // Filtro severidade
  const altas = alertEngine.listAlerts({ status: 'ativo', severidade: 'alta' });
  assert.ok(altas.every((a) => a.severidade === 'alta'));
  console.log('  OK  filtro por severidade');

  // API
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1, perfil: 'SUPER_ADMIN' }; next(); });
  app.use('/api/observabilidade', observabilidadeRoutes);

  const listRes = await request(app, 'GET', '/api/observabilidade/alerts?status=ativo&limit=20');
  assert.strictEqual(listRes.status, 200);
  assert.ok(listRes.body.ok);
  assert.ok(Array.isArray(listRes.body.alerts));
  assert.strictEqual(listRes.body.read_only, true);

  const sumRes = await request(app, 'GET', '/api/observabilidade/alerts/summary');
  assert.strictEqual(sumRes.status, 200);
  assert.ok(sumRes.body.ok);
  assert.ok(sumRes.body.ativos >= 1);

  const dash = await request(app, 'GET', '/api/observabilidade/summary');
  assert.strictEqual(dash.status, 200);
  assert.ok(dash.body.alerts);
  assert.ok(dash.body.alerts.ativos_lista);
  console.log('  OK  GET /alerts e /alerts/summary (+ summary.alerts)');

  const denied = express();
  denied.use((req, _res, next) => { req.user = { id: 2, perfil: 'ADMIN' }; next(); });
  denied.use('/api/observabilidade', observabilidadeRoutes);
  const no = await request(denied, 'GET', '/api/observabilidade/alerts');
  assert.strictEqual(no.status, 403);
  console.log('  OK  alerts restrito a SUPER_ADMIN');

  // UI
  const html = fs.readFileSync(path.join(root, 'frontend', 'erp', 'pages', 'observabilidade.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'frontend', 'erp', 'js', 'observabilidade.js'), 'utf8');
  assert.ok(html.includes('cdsObsAlertsBody'));
  assert.ok(html.includes('cdsObsAlertSev'));
  assert.ok(js.includes('/observabilidade/alerts'));
  assert.ok(js.includes('carregarAlerts'));
  assert.ok(fs.existsSync(path.join(root, 'backend', 'observabilidade', 'alertEngine.js')));
  console.log('  OK  dashboard com alertas ativos/histórico/filtros');

  // Sem escrita nas rotas de alerts
  const rotaSrc = fs.readFileSync(path.join(root, 'backend', 'rotas', 'observabilidade.js'), 'utf8');
  assert.ok(!rotaSrc.match(/router\.(post|put|patch|delete)\(['"]\/alerts/));
  console.log('  OK  API de alertas somente leitura');

  obs._resetForTests();
  console.log('\n=== RC12.4 — TODOS OS TESTES APROVADOS ===\n');
}

main().catch((err) => {
  console.error('\nFALHA RC12.4:', err);
  process.exit(1);
});
