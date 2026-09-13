'use strict';

/**
 * Auditoria de Integridade — pós-atualizações (MIB/CIP/CIA/Plugins/STABLE)
 * Gera docs/build/integrity-audit-report.{json,md}
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const OUT_JSON = path.join(ROOT, 'docs/build/integrity-audit-report.json');
const OUT_MD = path.join(ROOT, 'docs/build/integrity-audit-report.md');

const report = {
  codigo: 'INTEGRITY-AUDIT',
  geradoEm: new Date().toISOString(),
  checks: [],
  suites: [],
  warnings: [],
  falhas: [],
  resultado: 'PENDENTE'
};

function ok(id, detalhe) {
  report.checks.push({ id, ok: true, detalhe });
  console.log('OK', id, detalhe || '');
}

function fail(id, detalhe) {
  report.checks.push({ id, ok: false, detalhe });
  report.falhas.push({ id, detalhe });
  console.error('FAIL', id, detalhe || '');
}

function warn(id, detalhe) {
  report.warnings.push({ id, detalhe });
  console.warn('WARN', id, detalhe || '');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function mustExist(id, rel) {
  if (exists(rel)) ok(id, rel);
  else fail(id, `ausente: ${rel}`);
}

function mustContain(id, rel, needle) {
  if (!exists(rel)) return fail(id, `ausente: ${rel}`);
  const txt = read(rel);
  if (txt.includes(needle)) ok(id, `${rel} contém ${needle}`);
  else fail(id, `${rel} sem "${needle}"`);
}

function tryRequire(id, rel) {
  try {
    const mod = require(path.join(ROOT, rel));
    ok(id, `require ${rel} → ${typeof mod}`);
    return mod;
  } catch (err) {
    fail(id, `require ${rel}: ${err.message}`);
    return null;
  }
}

function runSuite(nome, scriptRel) {
  const script = path.join(ROOT, scriptRel);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 300000
  });
  const entry = {
    nome,
    script: scriptRel,
    exitCode: r.status,
    ms: Date.now() - t0,
    ok: r.status === 0
  };
  if (r.status !== 0) {
    entry.stderr = String(r.stderr || r.stdout || '').slice(-800);
    report.falhas.push({ id: `suite:${nome}`, detalhe: entry.stderr });
    console.error('FAIL suite', nome, 'exit', r.status);
  } else {
    console.log('OK suite', nome, `${entry.ms}ms`);
  }
  report.suites.push(entry);
  return entry.ok;
}

function main() {
  console.log('\n=== AUDITORIA ESTÁTICA ===\n');

  // Motores
  mustExist('mib.dir', 'backend/motores/mib/index.js');
  mustExist('cip.dir', 'backend/motores/cip/index.js');
  mustExist('cia.dir', 'backend/motores/cia/index.js');
  mustExist('plugins.dir', 'backend/plugins/index.js');

  const mib = tryRequire('mib.require', 'backend/motores/mib/index.js');
  const cip = tryRequire('cip.require', 'backend/motores/cip/index.js');
  const cia = tryRequire('cia.require', 'backend/motores/cia/index.js');
  const plugins = tryRequire('plugins.require', 'backend/plugins/index.js');

  if (mib) {
    assert.ok(mib.obterMib || mib.MibService);
    ok('mib.exports', `MIB ${mib.MIB_CODIGO || mib.MIB_VERSION || ''}`);
  }
  if (cip) ok('cip.exports', `CIP ${cip.CIP_CODIGO || ''}`);
  if (cia) ok('cia.exports', `CIA ${cia.CIA_CODIGO || ''}`);
  if (plugins) ok('plugins.exports', `APPS ${plugins.CIA_APPS_CODIGO || ''}`);

  // Rotas
  for (const r of [
    'backend/rotas/search.js',
    'backend/rotas/intelligence.js',
    'backend/rotas/agent.js',
    'backend/rotas/plugins.js',
    'backend/rotas/business-monitor.js'
  ]) {
    mustExist(`rota.${path.basename(r)}`, r);
    tryRequire(`rota.require.${path.basename(r, '.js')}`, r);
  }

  // Server mounts
  mustContain('server.search', 'backend/server.js', "/api/search");
  mustContain('server.intelligence', 'backend/server.js', "/api/intelligence");
  mustContain('server.agent', 'backend/server.js', "/api/agent");
  mustContain('server.plugins', 'backend/server.js', "/api/plugins");
  mustContain('server.businessMonitor', 'backend/server.js', "/api/business-monitor");

  // Plugins oficiais
  const pluginIds = [
    'commercial-copilot',
    'inventory-copilot',
    'financial-copilot',
    'fiscal-copilot',
    'catalog-copilot',
    'smart-dashboard',
    'business-monitor'
  ];
  for (const id of pluginIds) {
    mustExist(`plugin.${id}.manifest`, `backend/plugins/${id}/manifest.json`);
    mustExist(`plugin.${id}.js`, `backend/plugins/${id}/plugin.js`);
    mustExist(`plugin.${id}.perms`, `backend/plugins/${id}/permissions.json`);
  }

  // UI
  for (const f of [
    'frontend/erp/js/cds-copiloto.js',
    'frontend/erp/js/cip-insights.js',
    'frontend/erp/js/mib-analytics.js',
    'frontend/erp/js/enterprise-search.js',
    'frontend/erp/js/knowledge-center.js',
    'frontend/shared/js/AgentSDK.js',
    'frontend/shared/js/SearchSDK.js',
    'frontend/shared/js/cds-copiloto-widget.js',
    'frontend/plugins/smart-dashboard/index.html',
    'frontend/plugins/business-monitor/index.html',
    'frontend/plugins/cia-apps-panel/index.html'
  ]) {
    mustExist(`ui.${path.basename(f)}`, f);
  }

  mustContain('erp.nav.copiloto', 'frontend/erp/index.html', 'cds-copiloto');
  mustContain('pdv.widget', 'frontend/pdv/index.html', 'cds-copiloto-widget.js');
  mustContain('app.copiloto', 'frontend/erp/js/app.js', 'cds-copiloto');

  // Hot-path SQL anti-patterns (QueryOptimizer strategies)
  try {
    const qo = read('backend/motores/mib/core/QueryOptimizer.js');
    const strat = qo.match(/const strategies\s*=\s*\[([\s\S]*?)\];/);
    const body = strat ? strat[1] : '';
    if (/nome_contem|porMarca\s*\(/.test(body)) {
      fail('sql.hotpath', 'estratégias legado ainda ativas no QueryOptimizer');
    } else {
      ok('sql.hotpath', 'QueryOptimizer sem LIKE%/LOWER/REPLACE ativos');
    }
  } catch (err) {
    fail('sql.hotpath', err.message);
  }

  // Package scripts
  const pkg = JSON.parse(read('package.json'));
  for (const s of [
    'test:mib', 'test:cip', 'test:cia', 'test:cia-apps',
    'test:smart-dashboard', 'test:business-monitor', 'test:stable'
  ]) {
    if (pkg.scripts && pkg.scripts[s]) ok(`script.${s}`, pkg.scripts[s]);
    else fail(`script.${s}`, 'script ausente no package.json');
  }

  // Discover plugins runtime
  if (plugins && plugins.PluginManager) {
    try {
      const pm = new plugins.PluginManager();
      const found = pm.discover().map((p) => p.id);
      for (const id of pluginIds) {
        if (found.includes(id)) ok(`discover.${id}`, 'encontrado');
        else fail(`discover.${id}`, 'não descoberto');
      }
    } catch (err) {
      fail('discover', err.message);
    }
  }

  // Enterprise SQL warn (não bloqueia)
  if (exists('backend/motores/mib/enterprise/providers/BaseSqlProvider.js')) {
    const base = read('backend/motores/mib/enterprise/providers/BaseSqlProvider.js');
    if (/LOWER\s*\(/.test(base) || /REPLACE\s*\(/.test(base)) {
      warn('enterprise.sql', 'BaseSqlProvider ainda usa LOWER/REPLACE (fora do hot-path PDV)');
    }
  }

  console.log('\n=== SUITES AUTOMATIZADAS ===\n');

  const suites = [
    ['mib-rc10', 'tests/mib/mib-rc10-motor-busca.test.js'],
    ['mib-rc11', 'tests/mib/mib-rc11-catalogo-atomico.test.js'],
    ['mib-rc20', 'tests/mib/mib-rc20-motor-cognitivo.test.js'],
    ['mib-rc30', 'tests/mib/mib-rc30-enterprise-search.test.js'],
    ['mib-rc40', 'tests/mib/mib-rc40-knowledge-graph.test.js'],
    ['cip-rc10', 'tests/cip/cip-rc10-intelligence.test.js'],
    ['cia-rc10', 'tests/cia/cia-rc10-agent.test.js'],
    ['cia-apps-rc10', 'tests/cia-apps/cia-apps-rc10-plugins.test.js'],
    ['smart-dashboard', 'tests/cia-apps/smart-dashboard-rc10.test.js'],
    ['business-monitor', 'tests/cia-apps/business-monitor-rc10.test.js'],
    ['stable-10', 'tests/stable/stable-10-certificacao.test.js']
  ];

  let suitesOk = 0;
  for (const [nome, script] of suites) {
    if (runSuite(nome, script)) suitesOk += 1;
  }

  const staticOk = report.checks.filter((c) => c.ok).length;
  const staticFail = report.checks.filter((c) => !c.ok).length;
  const apto = report.falhas.length === 0;

  report.resumo = {
    checksOk: staticOk,
    checksFail: staticFail,
    suitesOk,
    suitesTotal: suites.length,
    warnings: report.warnings.length
  };
  report.resultado = apto ? 'INTEGRIDADE OK' : 'INTEGRIDADE COM FALHAS';

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const md = [
    `# Auditoria de Integridade — Pós-atualizações`,
    ``,
    `**Resultado: ${report.resultado}**`,
    ``,
    `- Gerado em: ${report.geradoEm}`,
    `- Checks OK: ${staticOk} | Fail: ${staticFail}`,
    `- Suites: ${suitesOk}/${suites.length}`,
    `- Warnings: ${report.warnings.length}`,
    ``,
    `## Suites`,
    ...report.suites.map((s) => `- ${s.ok ? '✔' : '✖'} **${s.nome}** (${s.ms}ms) exit=${s.exitCode}`),
    ``,
    `## Warnings`,
    report.warnings.length
      ? report.warnings.map((w) => `- ${w.id}: ${w.detalhe}`).join('\n')
      : '- Nenhum',
    ``,
    `## Falhas`,
    report.falhas.length
      ? report.falhas.map((f) => `- ${f.id}: ${String(f.detalhe).slice(0, 300)}`).join('\n')
      : '- Nenhuma',
    ``,
    `## Escopo verificado`,
    `- Motores: MIB, CIP, CIA`,
    `- Plugins: 5 copilotos + smart-dashboard + business-monitor`,
    `- APIs: /api/search, /intelligence, /agent, /plugins, /business-monitor`,
    `- UI ERP/PDV + painéis plugin`,
    `- STABLE-1.0 certificação`,
    ``
  ].join('\n');
  fs.writeFileSync(OUT_MD, md);

  console.log('\n=== RESULTADO ===');
  console.log(report.resultado);
  console.log('Relatório:', OUT_MD);
  process.exit(apto ? 0 : 1);
}

try {
  main();
} catch (err) {
  console.error(err);
  report.resultado = 'INTEGRIDADE COM FALHAS';
  report.falhas.push({ id: 'fatal', detalhe: err.message });
  try {
    fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  } catch (_) { /* ignore */ }
  process.exit(1);
}
