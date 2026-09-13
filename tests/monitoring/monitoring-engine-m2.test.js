/**
 * CDS Monitoring Engine — Sprint M2 (Widget Builder + Financeiro/Caixa/Recebimentos)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  MonitoringEngine,
  MonitoringRegistry,
  criarMonitoringResult,
  MonitoringWidgetBuilder
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

console.log('\n=== CDS Monitoring Engine M2 ===\n');

test('Widget Builder produz DTO oficial', () => {
  const builder = new MonitoringWidgetBuilder();
  const widgets = builder.build({
    fiscal: { vendas: { valor: 10, quantidade: 1, hoje: { valor: 10, quantidade: 1 }, mes: { valor: 20, quantidade: 2 }, ano: { valor: 30, quantidade: 3 } }, entradas: {} },
    naoFiscal: { vendas: {}, entradas: {} },
    financeiro: {
      receberFiscal: { valor: 1, quantidade: 1, hoje: { valor: 0, quantidade: 0 }, mes: { valor: 0, quantidade: 0 }, ano: { valor: 0, quantidade: 0 } },
      pagarFiscal: { valor: 0, quantidade: 0 },
      receberNaoFiscal: { valor: 0, quantidade: 0 },
      pagarNaoFiscal: { valor: 0, quantidade: 0 }
    },
    caixa: { fiscal: { saldo: 100, entradas: 50, saidas: 0, suprimentos: 0, sangrias: 0, abertura: 50 }, naoFiscal: { saldo: 0, entradas: 0, saidas: 0, suprimentos: 0, sangrias: 0, abertura: 0 } },
    recebimentos: {
      pixFiscal: { valor: 5, quantidade: 1 },
      dinheiroFiscal: {},
      cartaoFiscal: {},
      pixNaoFiscal: {},
      dinheiroNaoFiscal: {},
      cartaoNaoFiscal: {}
    },
    tef: { aprovadas: 0, mock: true }
  });

  assert.ok(widgets.length >= 10);
  widgets.forEach((w) => {
    assert.ok(w.title, 'title');
    assert.ok(w.icon, 'icon');
    assert.ok(Object.prototype.hasOwnProperty.call(w, 'value'), 'value');
    assert.ok(Object.prototype.hasOwnProperty.call(w, 'subtitle'), 'subtitle');
    assert.ok(Object.prototype.hasOwnProperty.call(w, 'badge'), 'badge');
    assert.ok(Object.prototype.hasOwnProperty.call(w, 'trend'), 'trend');
    assert.ok(w.updatedAt, 'updatedAt');
  });

  const fiscais = MonitoringWidgetBuilder.filter(widgets, { domain: 'fiscal', includeNaoFiscal: false });
  assert.ok(fiscais.every((w) => w.scope !== 'nao_fiscal'));
});

test('Widget Builder desacoplado — sem SQL', () => {
  const root = path.join(__dirname, '../../backend/monitoring/widgets');
  fs.readdirSync(root).forEach((file) => {
    if (!file.endsWith('.js')) return;
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!/\brequire\(['"].*database/.test(src), `${file} não deve acessar database`);
    assert.ok(!/\bSELECT\b/i.test(src), `${file} não deve ter SQL`);
  });
});

test('Arquivos Widget M2 existem', () => {
  const root = path.join(__dirname, '../../backend/monitoring/widgets');
  [
    'MonitoringWidgetBuilder.js',
    'FiscalWidget.js',
    'FinanceiroWidget.js',
    'CaixaWidget.js',
    'RecebimentosWidget.js',
    'TefWidget.js'
  ].forEach((f) => assert.ok(fs.existsSync(path.join(root, f)), f));
});

test('UI renderiza widgets sem SQL/cálculo de indicadores', () => {
  const ui = fs.readFileSync(
    path.join(__dirname, '../../frontend/erp/js/cds-monitoring-engine.js'),
    'utf8'
  );
  assert.ok(!/\bSELECT\b/i.test(ui));
  assert.ok(ui.includes('summary.widgets') || ui.includes('widgets'));
  assert.ok(ui.includes('data-mon-nao-fiscal'));
  assert.ok(ui.includes('renderWidgetCard') || ui.includes('filtrarWidgets'));
});

(async () => {
  await testAsync('Engine summary inclui widgets + financeiro/caixa/recebimentos/tef', async () => {
    const reg = new MonitoringRegistry();
    reg.register({
      id: 'fiscal',
      collect: async () => criarMonitoringResult({
        data: {
          vendas: { valor: 1, quantidade: 1, hoje: { valor: 1, quantidade: 1 }, mes: { valor: 1, quantidade: 1 }, ano: { valor: 1, quantidade: 1 } },
          entradas: { valor: 0, quantidade: 0 },
          naoFiscal: { vendas: { valor: 2, quantidade: 1 }, entradas: {} }
        }
      })
    });
    reg.register({
      id: 'financeiro',
      collect: async () => criarMonitoringResult({
        data: {
          financeiro: {
            receberFiscal: { valor: 10, quantidade: 1, hoje: { valor: 1, quantidade: 1 }, mes: { valor: 5, quantidade: 2 }, ano: { valor: 10, quantidade: 3 }, percentual: 20 },
            pagarFiscal: { valor: 0, quantidade: 0 },
            receberNaoFiscal: { valor: 3, quantidade: 1 },
            pagarNaoFiscal: { valor: 0, quantidade: 0 }
          }
        }
      })
    });
    reg.register({
      id: 'caixa',
      collect: async () => criarMonitoringResult({
        data: {
          caixa: {
            fiscal: { saldo: 100, entradas: 40, saidas: 10, suprimentos: 5, sangrias: 10, abertura: 65, status: 'aberto' },
            naoFiscal: { saldo: 20, entradas: 20, saidas: 0, suprimentos: 0, sangrias: 0, abertura: 0 }
          }
        }
      })
    });
    reg.register({
      id: 'recebimentos',
      collect: async () => criarMonitoringResult({
        data: {
          recebimentos: {
            pixFiscal: { valor: 8, quantidade: 2 },
            dinheiroFiscal: { valor: 1, quantidade: 1 },
            cartaoFiscal: { valor: 4, quantidade: 1 },
            pixNaoFiscal: { valor: 1, quantidade: 1 },
            dinheiroNaoFiscal: {},
            cartaoNaoFiscal: {}
          }
        }
      })
    });
    ['estoque', 'comercial', 'alertas', 'tef'].forEach((id) => {
      reg.register({
        id,
        collect: async () => criarMonitoringResult({
          data: { [id]: id === 'tef' ? { mock: true, aprovadas: 0 } : {} }
        })
      });
    });

    const engine = new MonitoringEngine({ registry: reg });
    const result = await engine.summary({});
    assert.ok(result.data.financeiro.receberFiscal);
    assert.ok(result.data.caixa.fiscal);
    assert.ok(result.data.recebimentos.pixFiscal);
    assert.ok(result.data.tef);
    assert.ok(Array.isArray(result.data.widgets));
    const domains = new Set(result.data.widgets.map((w) => w.domain));
    assert.ok(domains.has('fiscal'));
    assert.ok(domains.has('financeiro'));
    assert.ok(domains.has('caixa'));
    assert.ok(domains.has('recebimentos'));
  });

  console.log(`\nResultado: ${ok} ok, ${falhas} falha(s)\n`);
  process.exit(falhas > 0 ? 1 : 0);
})();
