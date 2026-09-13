/**
 * CDS Monitoring Engine — Sprint M1 (fundação)
 * Testes estruturais sem dependência de SEFAZ / sem alterar Fiscal ou Central.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  MonitoringEngine,
  MonitoringRegistry,
  criarMonitoringResult,
  criarMonitoringMetrics,
  MonitoringCache,
  registrarProvidersPadrao
} = require('../../backend/monitoring');

let falhas = 0;
let ok = 0;

function test(nome, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FAIL  ${nome}`);
    console.error(`       ${err.message}`);
  }
}

async function testAsync(nome, fn) {
  try {
    await fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FAIL  ${nome}`);
    console.error(`       ${err.message}`);
  }
}

console.log('\n=== CDS Monitoring Engine M1 ===\n');

test('Registry registra e lista providers', () => {
  const reg = new MonitoringRegistry();
  reg.register({
    id: 'demo',
    collect: async () => criarMonitoringResult({ data: { ok: true } })
  });
  assert.strictEqual(reg.has('demo'), true);
  assert.deepStrictEqual(reg.list(), ['demo']);
});

test('Registry rejeita provider sem collect', () => {
  const reg = new MonitoringRegistry();
  assert.throws(() => reg.register({ id: 'x' }));
});

test('MonitoringResult padronizado', () => {
  const r = criarMonitoringResult({ source: 't', data: { a: 1 } });
  assert.strictEqual(r.success, true);
  assert.ok(r.timestamp);
  assert.strictEqual(r.source, 't');
  assert.deepStrictEqual(r.data, { a: 1 });
  assert.ok(Array.isArray(r.warnings));
  assert.ok(Array.isArray(r.errors));
});

test('MonitoringMetrics snapshot', () => {
  const m = criarMonitoringMetrics();
  m.markCacheHit(false);
  m.addProvider('fiscal', { tempoConsultaMs: 12, success: true });
  const snap = m.snapshot();
  assert.strictEqual(snap.cacheHit, false);
  assert.ok(snap.tempoConsulta >= 0);
  assert.deepStrictEqual(snap.provider, ['fiscal']);
});

test('MonitoringCache M1 sempre miss', () => {
  const cache = new MonitoringCache();
  assert.strictEqual(cache.get('k'), null);
  assert.strictEqual(cache.set('k', { x: 1 }, 1000), false);
});

test('Providers padrão registrados', () => {
  const reg = registrarProvidersPadrao(new MonitoringRegistry());
  const ids = reg.list().sort();
  assert.deepStrictEqual(ids, [
    'alertas',
    'caixa',
    'comercial',
    'estoque',
    'financeiro',
    'fiscal',
    'recebimentos',
    'tef'
  ].sort());
});

(async () => {
  await testAsync('Engine summary monta contrato oficial (providers mock)', async () => {
    const reg = new MonitoringRegistry();
    reg.register({
      id: 'fiscal',
      collect: async () => criarMonitoringResult({
        source: 'FiscalProvider',
        data: {
          vendas: { valor: 10, quantidade: 1, hoje: { valor: 10, quantidade: 1 }, mes: { valor: 10, quantidade: 1 }, ano: { valor: 10, quantidade: 1 } },
          entradas: { valor: 5, quantidade: 1, ultimaNf: null, fornecedor: null },
          naoFiscal: {
            vendas: { valor: 2, quantidade: 1 },
            entradas: { valor: 0, quantidade: 0 }
          }
        }
      })
    });
    ['financeiro', 'caixa', 'estoque', 'recebimentos', 'comercial', 'alertas', 'tef'].forEach((id) => {
      reg.register({
        id,
        collect: async () => criarMonitoringResult({
          data: { [id]: {} }
        })
      });
    });

    const engine = new MonitoringEngine({ registry: reg });
    const result = await engine.summary({});
    assert.ok(result.data.fiscal);
    assert.ok(result.data.widgets);
    assert.ok(Array.isArray(result.data.widgets));
    assert.ok(result.data.widgets.length > 0);
    assert.ok(result.data.widgets.every((w) => w.title && w.icon && w.id));
    assert.ok(Object.prototype.hasOwnProperty.call(result.data, 'tef'));
  });

  test('UI não contém SQL / SELECT / FROM tabelas', () => {
    const ui = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/cds-monitoring-engine.js'),
      'utf8'
    );
    assert.ok(!/\bSELECT\b/i.test(ui));
    assert.ok(!/\bFROM\s+vendas\b/i.test(ui));
    assert.ok(!/\bsqlite\b/i.test(ui));
    assert.ok(ui.includes('/monitoring/summary'));
    assert.ok(ui.includes('data-mon-nao-fiscal'));
    assert.ok(ui.includes('modoFiscalAtivo'));
  });

  test('Arquivos oficiais do motor existem', () => {
    const root = path.join(__dirname, '../../backend/monitoring');
    [
      'MonitoringEngine.js',
      'MonitoringController.js',
      'MonitoringRouter.js',
      'MonitoringMetrics.js',
      'MonitoringCache.js',
      'MonitoringResult.js',
      'MonitoringContext.js',
      'MonitoringRegistry.js',
      'providers/FiscalProvider.js',
      'providers/FinanceiroProvider.js',
      'providers/CaixaProvider.js',
      'providers/EstoqueProvider.js',
      'providers/RecebimentosProvider.js',
      'providers/ComercialProvider.js',
      'providers/AlertasProvider.js'
    ].forEach((rel) => {
      assert.ok(fs.existsSync(path.join(root, rel)), `faltando ${rel}`);
    });
  });

  test('Menu e rota ERP referenciam monitoring', () => {
    const index = fs.readFileSync(path.join(__dirname, '../../frontend/erp/index.html'), 'utf8');
    const app = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/app.js'), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, '../../backend/server.js'), 'utf8');
    assert.ok(index.includes('data-page="monitoring"'));
    assert.ok(index.includes('Central de Monitoramento'));
    assert.ok(app.includes("case 'monitoring'"));
    assert.ok(server.includes("/api/monitoring"));
  });

  console.log(`\nResultado: ${ok} ok, ${falhas} falha(s)\n`);
  process.exit(falhas > 0 ? 1 : 0);
})();
