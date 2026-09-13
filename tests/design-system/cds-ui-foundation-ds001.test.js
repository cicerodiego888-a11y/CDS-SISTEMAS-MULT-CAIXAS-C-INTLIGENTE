/**
 * CDS Design System V2 — UI Foundation (DS-001)
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const DS_ROOT = path.join(__dirname, '../../frontend/shared/design-system');
const manifest = require(path.join(DS_ROOT, 'script-manifest.js'));

function loadFoundation() {
  const sandbox = {
    window: {},
    global: {},
    localStorage: {
      store: {},
      getItem(k) { return this.store[k] || null; },
      setItem(k, v) { this.store[k] = String(v); }
    },
    console,
    module: { exports: {} },
    exports: {}
  };
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  sandbox.modoFiscalAtivoSistema = () => true;

  // Adaptive Labels (integração oficial)
  const labelsRoot = path.join(__dirname, '../../frontend/shared/services');
  for (const f of [
    'AdaptiveLabelRegistry.js',
    'AdaptiveLabelContext.js',
    'AdaptiveLabelService.js',
    'AdaptiveLabelProvider.js'
  ]) {
    vm.runInNewContext(fs.readFileSync(path.join(labelsRoot, f), 'utf8'), sandbox, { filename: f });
  }

  const bundle = fs.readFileSync(path.join(DS_ROOT, 'cds-ui-foundation.bundle.js'), 'utf8');
  vm.runInNewContext(bundle, sandbox, { filename: 'cds-ui-foundation.bundle.js' });
  sandbox.CDSUIFoundation?.init?.();
  return sandbox;
}

let ok = 0;
let falhas = 0;
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

console.log('\n=== CDS UI Foundation DS-001 ===\n');

test('Estrutura foundation/tokens/components/hooks/utils existe', () => {
  [
    'tokens/color.tokens.js',
    'foundation/theme.js',
    'components/CDSHero.js',
    'components/CDSKPI.js',
    'components/CDSNotification.js',
    'hooks/useAdaptiveLabel.js',
    'utils/IconResolver.js',
    'cds-ui-foundation.css',
    'cds-ui-foundation.bundle.js',
    'index.js'
  ].forEach((f) => assert.ok(fs.existsSync(path.join(DS_ROOT, f)), f));
  assert.ok(manifest.length >= 50);
});

test('Bundle inicializa CDS.UI', () => {
  const sb = loadFoundation();
  assert.ok(sb.CDS?.UI);
  assert.ok(sb.CDS.UI.components.CDSHero);
  assert.ok(sb.CDS.UI.components.CDSKPI);
  assert.ok(sb.CDS.UI.hooks.useAdaptiveLabel);
  assert.ok(sb.CDS.UI.labels);
});

test('Componentes renderizam HTML oficial cds-ui', () => {
  const sb = loadFoundation();
  const hero = sb.CDSHero.render({ title: 'Teste', subtitle: 'Sub', icon: 'fa-home' });
  assert.ok(hero.includes('cds-ui-hero'));
  const kpi = sb.CDSKPI.render({ label: 'Vendas', value: 'R$ 10', tone: 'ok' });
  assert.ok(kpi.includes('cds-ui-kpi'));
  const badge = sb.CDSBadge.render({ text: 'OK', tone: 'success' });
  assert.ok(badge.includes('cds-ui-badge'));
  const empty = sb.CDSEmptyState.render({ kind: 'empty', title: 'Sem dados' });
  assert.ok(empty.includes('cds-ui-empty'));
});

test('Adaptive Labels incorporados (useAdaptiveLabel + CDS.UI.labels)', () => {
  const sb = loadFoundation();
  const labels = sb.useAdaptiveLabel();
  assert.strictEqual(labels.getLabel('vendas'), 'Vendas');
  assert.ok(sb.CDS.UI.AdaptiveLabels || sb.CDS.DesignSystem.AdaptiveLabels);
});

test('Breakpoints oficiais Desktop/Notebook/Tablet/Mobile', () => {
  const sb = loadFoundation();
  assert.strictEqual(sb.CDSBreakpoints.tablet, 768);
  assert.strictEqual(sb.CDSBreakpoints.notebook, 1024);
  assert.strictEqual(sb.CDSBreakpoints.desktop, 1280);
  assert.ok(['mobile', 'tablet', 'notebook', 'desktop', 'wide'].includes(sb.CDSBreakpoints.current()));
});

test('Ícones via Font Awesome (emoji não é ícone oficial)', () => {
  const sb = loadFoundation();
  assert.ok(sb.CDSIcons.forbidEmojiAsIcon);
  assert.ok(sb.IconResolver.resolve('ok').includes('fa-'));
});

test('ERP carrega CSS + bundle da Foundation', () => {
  const index = fs.readFileSync(path.join(__dirname, '../../frontend/erp/index.html'), 'utf8');
  assert.ok(index.includes('cds-ui-foundation.css'));
  assert.ok(index.includes('cds-ui-foundation.bundle.js'));
});

test('Monitoring consome CDS UI (apresentação)', () => {
  const ui = fs.readFileSync(
    path.join(__dirname, '../../frontend/erp/js/cds-monitoring-engine.js'),
    'utf8'
  );
  assert.ok(ui.includes('CDS.UI') || ui.includes('CDSUIComponents'));
  assert.ok(ui.includes('CDSHero') || ui.includes('CDSKPI'));
  assert.ok(ui.includes('CDSNotification') || ui.includes('notify('));
});

test('Tokens padronizam radius/shadow/spacing de Card/KPI/Hero', () => {
  const sb = loadFoundation();
  assert.strictEqual(sb.CDSRadiusTokens.card, '10px');
  assert.strictEqual(sb.CDSRadiusTokens.hero, '12px');
  assert.ok(sb.CDSShadowTokens.card);
  assert.ok(sb.CDSSpacingTokens.cardPadding);
});

console.log(`\nResultado: ${ok} ok, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
