/**
 * CDS Monitoring Engine — Sprint M4 (COP Action Center)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  MonitoringEngine,
  MonitoringRegistry,
  MonitoringActionCenter,
  MonitoringActionRegistry,
  MonitoringActionBuilder,
  criarMonitoringResult,
  criarAction
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

console.log('\n=== CDS Monitoring Engine M4 ===\n');

test('Arquivos Action Center existem', () => {
  const root = path.join(__dirname, '../../backend/monitoring/actions');
  [
    'MonitoringActionCenter.js',
    'MonitoringActionRegistry.js',
    'MonitoringActionBuilder.js',
    'MonitoringActionResult.js',
    'MonitoringActionContext.js',
    'MonitoringActionPermissions.js'
  ].forEach((f) => assert.ok(fs.existsSync(path.join(root, f)), f));
});

test('Actions não consultam banco', () => {
  const root = path.join(__dirname, '../../backend/monitoring/actions');
  fs.readdirSync(root).filter((f) => f.endsWith('.js')).forEach((file) => {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!/\brequire\(['"].*database/.test(src), `${file} sem database`);
    assert.ok(!/\bSELECT\b/i.test(src), `${file} sem SQL`);
  });
});

test('Intelligence não importa Action Center', () => {
  const root = path.join(__dirname, '../../backend/monitoring/intelligence');
  fs.readdirSync(root).filter((f) => f.endsWith('.js')).forEach((file) => {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!src.includes('/actions'), `${file} não deve importar actions`);
    assert.ok(!src.includes('MonitoringAction'), `${file} não deve conhecer Action`);
  });
});

test('Providers não conhecem Actions', () => {
  const root = path.join(__dirname, '../../backend/monitoring/providers');
  fs.readdirSync(root).filter((f) => f.endsWith('.js')).forEach((file) => {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!src.includes('MonitoringAction'), `${file}`);
    assert.ok(!src.includes('page:'), `${file} não deve ter page navigation`);
  });
});

test('Action Builder mapeia alert → page sem mutar insight', () => {
  const builder = new MonitoringActionBuilder();
  const actions = builder.buildForSignal({ id: 'alert.tef.offline', titulo: 'TEF' }, 'alerta');
  assert.ok(actions.length >= 2);
  assert.ok(actions.every((a) => a.page || a.route));
  assert.ok(actions.every((a) => a.action === 'navigate' || a.action === 'open_route'));
});

test('Action Center enriquece COP sem auto-execute', () => {
  const center = new MonitoringActionCenter();
  const intelligence = {
    health: { geral: 'ATENCAO' },
    trends: { global: { label: '▬ Estável' } },
    alerts: [
      { id: 'alert.caixa.negativo', titulo: 'Caixa negativo', severidade: 'CRITICO', dominio: 'caixa' },
      { id: 'alert.tef.offline', titulo: 'TEF offline', severidade: 'ATENCAO', dominio: 'recebimentos' }
    ],
    insights: [{ id: 'insight.vendas.vs_ontem', mensagem: 'subiu', dominio: 'fiscal' }],
    recommendations: [{ id: 'rec.alert.caixa.negativo', titulo: 'Suprimento', dominio: 'caixa' }],
    updatedAt: new Date().toISOString(),
    cop: { titulo: 'COP', meta: { versao: 'M3' } }
  };
  const bundle = center.build(intelligence, { perfil: 'SUPER_ADMIN' }, {});
  assert.ok(bundle.recommendedActions.length > 0);
  assert.ok(bundle.workQueue.length > 0);
  assert.ok(bundle.timeline.length > 0);
  assert.strictEqual(bundle.meta.autoExecute, false);
  assert.ok(bundle.alerts[0].actions.length > 0);
  const cop = center.enrichCop(intelligence.cop, bundle);
  assert.ok(cop.recommendedActions);
  assert.strictEqual(cop.meta.versao, 'M4');
});

test('UI Action Center sem SQL / com navegação', () => {
  const ui = fs.readFileSync(
    path.join(__dirname, '../../frontend/erp/js/cds-monitoring-engine.js'),
    'utf8'
  );
  assert.ok(!/\bSELECT\b/i.test(ui));
  assert.ok(ui.includes('recommendedActions') || ui.includes('Ações Recomendadas'));
  assert.ok(ui.includes('Fila de Trabalho'));
  assert.ok(ui.includes('Timeline Global'));
  assert.ok(ui.includes('executarAction'));
  assert.ok(ui.includes('M4'));
});

(async () => {
  await testAsync('Engine summary inclui actionCenter', async () => {
    const reg = new MonitoringRegistry();
    reg.register({
      id: 'fiscal',
      collect: async () => criarMonitoringResult({
        data: {
          vendas: { valor: 0, quantidade: 0, hoje: { valor: 0, quantidade: 0 }, mes: { valor: 0, quantidade: 0 }, ano: { valor: 0, quantidade: 0 } },
          entradas: {},
          naoFiscal: { vendas: {}, entradas: {} }
        }
      })
    });
    ['financeiro', 'caixa', 'estoque', 'recebimentos', 'comercial', 'alertas', 'tef'].forEach((id) => {
      reg.register({
        id,
        collect: async () => criarMonitoringResult({
          data: id === 'tef'
            ? { tef: { mock: true } }
            : id === 'caixa'
              ? { caixa: { fiscal: { saldo: -10 }, naoFiscal: { saldo: 0 } } }
              : id === 'financeiro'
                ? { financeiro: { receberFiscal: { valor: 0 } } }
                : id === 'recebimentos'
                  ? { recebimentos: {} }
                  : { [id]: {} }
        })
      });
    });

    const engine = new MonitoringEngine({ registry: reg });
    const result = await engine.summary({ perfil: 'SUPER_ADMIN', permissoes: [] });
    assert.ok(result.data.actionCenter);
    assert.ok(Array.isArray(result.data.recommendedActions));
    assert.ok(Array.isArray(result.data.workQueue));
    assert.ok(Array.isArray(result.data.timeline));
    assert.ok(result.data.cop.recommendedActions);
  });

  console.log(`\nResultado: ${ok} ok, ${falhas} falha(s)\n`);
  process.exit(falhas > 0 ? 1 : 0);
})();
