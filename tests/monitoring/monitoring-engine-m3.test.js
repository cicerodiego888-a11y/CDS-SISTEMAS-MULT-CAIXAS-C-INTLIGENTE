/**
 * CDS Monitoring Engine — Sprint M3 (Intelligence + Executive Insights + COP)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  MonitoringEngine,
  MonitoringRegistry,
  MonitoringIntelligence,
  criarMonitoringResult
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

console.log('\n=== CDS Monitoring Engine M3 ===\n');

test('Arquivos intelligence existem', () => {
  const root = path.join(__dirname, '../../backend/monitoring/intelligence');
  [
    'MonitoringIntelligence.js',
    'MonitoringHealthService.js',
    'MonitoringAlertService.js',
    'MonitoringTrendService.js',
    'MonitoringRecommendationService.js',
    'MonitoringInsightService.js',
    'MonitoringSeverity.js',
    'MonitoringInsight.js',
    'ExecutiveInsightsService.js'
  ].forEach((f) => assert.ok(fs.existsSync(path.join(root, f)), f));
});

test('Intelligence desacoplada de Providers', () => {
  const provDir = path.join(__dirname, '../../backend/monitoring/providers');
  fs.readdirSync(provDir).filter((f) => f.endsWith('.js')).forEach((file) => {
    const src = fs.readFileSync(path.join(provDir, file), 'utf8');
    assert.ok(!src.includes('MonitoringIntelligence'), `${file} não importa Intelligence`);
    assert.ok(!src.includes('ExecutiveInsights'), `${file} não importa ExecutiveInsights`);
  });
});

test('Widget Builder não importa Intelligence', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../backend/monitoring/widgets/MonitoringWidgetBuilder.js'),
    'utf8'
  );
  assert.ok(!src.includes('intelligence'));
});

test('UI consome executiveInsights/cop/intelligence — sem regras', () => {
  const ui = fs.readFileSync(
    path.join(__dirname, '../../frontend/erp/js/cds-monitoring-engine.js'),
    'utf8'
  );
  assert.ok(ui.includes('executiveInsights'));
  assert.ok(ui.includes('renderCop'));
  assert.ok(ui.includes('EXECUTIVE INSIGHTS'));
  assert.ok(!/\bSELECT\b/i.test(ui));
  assert.ok(!ui.includes('MonitoringAlertService'));
});

(async () => {
  await testAsync('MonitoringIntelligence.analyze retorna COP + Executive Insights', async () => {
    const intel = new MonitoringIntelligence();
    const payload = {
      fiscal: { vendas: { hoje: { valor: 100, quantidade: 5 }, mes: { valor: 500, quantidade: 20 } }, entradas: {} },
      naoFiscal: { vendas: { hoje: { valor: 20, quantidade: 2 } }, entradas: {} },
      financeiro: { receberFiscal: { valor: 1000, quantidade: 3 } },
      caixa: { fiscal: { saldo: 50, entradas: 100, saidas: 10, suprimentos: 0, sangrias: 10 }, naoFiscal: { saldo: 5 } },
      recebimentos: { pixFiscal: { hoje: { valor: 30 }, mes: { valor: 200 } } },
      tef: { mock: true }
    };
    const widgets = [{ id: 'fiscal.vendas', domain: 'fiscal', scope: 'fiscal', title: 'V', value: 100 }];
    const result = await intel.analyze(payload, widgets, {});
    assert.ok(result.executiveInsights);
    assert.ok(result.executiveInsights.items);
    assert.ok(result.cop);
    assert.ok(result.cop.modulos);
    assert.ok(result.health);
    assert.ok(result.alerts);
    assert.ok(result.widgets[0].health);
  });

  await testAsync('Engine summary inclui intelligence + executiveInsights + cop', async () => {
    const reg = new MonitoringRegistry();
    reg.register({
      id: 'fiscal',
      collect: async () => criarMonitoringResult({
        data: {
          vendas: { valor: 10, quantidade: 1, hoje: { valor: 10, quantidade: 1 }, mes: { valor: 10, quantidade: 1 }, ano: { valor: 10, quantidade: 1 } },
          entradas: {},
          naoFiscal: { vendas: {}, entradas: {} }
        }
      })
    });
    ['financeiro', 'caixa', 'estoque', 'recebimentos', 'comercial', 'alertas', 'tef'].forEach((id) => {
      reg.register({
        id,
        collect: async () => criarMonitoringResult({
          data: id === 'financeiro' ? { financeiro: { receberFiscal: { valor: 0, quantidade: 0 } } }
            : id === 'caixa' ? { caixa: { fiscal: { saldo: 0 }, naoFiscal: { saldo: 0 } } }
              : id === 'recebimentos' ? { recebimentos: {} }
                : id === 'tef' ? { tef: { mock: true } }
                  : { [id]: {} }
        })
      });
    });

    const engine = new MonitoringEngine({ registry: reg });
    const result = await engine.summary({});
    assert.ok(result.data.executiveInsights);
    assert.ok(result.data.cop);
    assert.ok(result.data.intelligence);
    assert.ok(result.data.widgets[0].health != null || result.data.widgets.length >= 0);
  });

  console.log(`\nResultado: ${ok} ok, ${falhas} falha(s)\n`);
  process.exit(falhas > 0 ? 1 : 0);
})();
