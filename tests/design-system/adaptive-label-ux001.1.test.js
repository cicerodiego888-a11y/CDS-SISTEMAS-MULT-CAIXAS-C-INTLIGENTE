/**
 * CDS Design System V2 — Adaptive Label System (UX-001.1 consolidação)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

function loadAll(mockFiscalAtivo) {
  const sandbox = {
    window: {},
    global: {},
    localStorage: {
      store: { pdv_modo_fiscal_ativo: mockFiscalAtivo ? '1' : '0' },
      getItem(k) { return this.store[k] || null; },
      setItem(k, v) { this.store[k] = String(v); }
    },
    module: { exports: {} },
    exports: {},
    console
  };
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  sandbox.modoFiscalAtivoSistema = () => mockFiscalAtivo;

  const root = path.join(__dirname, '../../frontend/shared/services');
  for (const file of [
    'AdaptiveLabelRegistry.js',
    'AdaptiveLabelContext.js',
    'AdaptiveLabelService.js',
    'AdaptiveLabelProvider.js'
  ]) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    vm.runInNewContext(code, sandbox, { filename: file });
  }
  return sandbox;
}

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

console.log('\n=== Adaptive Label System UX-001.1 ===\n');

test('Arquivos oficiais existem (Service/Registry/Context/Provider)', () => {
  const root = path.join(__dirname, '../../frontend/shared/services');
  [
    'AdaptiveLabelService.js',
    'AdaptiveLabelRegistry.js',
    'AdaptiveLabelContext.js',
    'AdaptiveLabelProvider.js'
  ].forEach((f) => assert.ok(fs.existsSync(path.join(root, f)), f));
});

test('Provider inicializa CDS.DesignSystem.AdaptiveLabels', () => {
  const sb = loadAll(true);
  assert.ok(sb.AdaptiveLabelProvider.ready());
  assert.ok(sb.CDS.DesignSystem.AdaptiveLabels);
  assert.strictEqual(sb.CDS.DesignSystem.AdaptiveLabels.version.includes('ux001.1'), true);
  assert.strictEqual(sb.AdaptiveLabelProvider.labels('vendas'), 'Vendas');
});

test('API getLabel / getPlural / getShortLabel / getDescription', () => {
  const ALS = loadAll(false).AdaptiveLabelService;
  assert.strictEqual(ALS.getLabel('tef'), 'TEF Fiscal');
  assert.strictEqual(ALS.getLabel('tef', { scope: 'nao_fiscal' }), 'TEF Não Fiscal');
  assert.strictEqual(ALS.getShortLabel('receber'), 'Receber Fiscal');
  assert.strictEqual(ALS.getShortLabel('receber', { scope: 'nao_fiscal' }), 'Receber Não Fiscal');
  assert.strictEqual(ALS.getPlural('vendas'), 'Vendas Fiscais');
  assert.ok(ALS.getDescription('caixa').length > 0);

  const ALSOn = loadAll(true).AdaptiveLabelService;
  assert.strictEqual(ALSOn.getLabel('tef'), 'TEF');
  assert.strictEqual(ALSOn.getShortLabel('receber'), 'Receber');
  assert.strictEqual(ALSOn.getPlural('vendas'), 'Vendas');
  assert.ok(!/fiscal/i.test(ALSOn.getLabel('vendas')));
});

test('Domínios oficiais registrados (incl. monitoramento/workflow/cop)', () => {
  const reg = loadAll(true).AdaptiveLabelRegistry;
  [
    'vendas', 'entradas', 'caixa', 'estoque', 'pix', 'cartao', 'tef',
    'receber', 'pagar', 'financeiro', 'comercial', 'alertas', 'indicadores',
    'monitoramento', 'workflow', 'cop'
  ].forEach((d) => assert.ok(reg.get(d), d));
});

test('Context expõe F12 + perfil + idioma', () => {
  const ctx = loadAll(true).AdaptiveLabelContext;
  assert.strictEqual(ctx.getModoOperacional(), 'fiscal');
  assert.strictEqual(ctx.getIdioma(), 'pt-BR');
  ctx.setIdioma('en-US');
  assert.strictEqual(ctx.getIdioma(), 'en-US');
  assert.ok(ctx.snapshot().modoFiscalAtivo === true);
});

test('F12 ON oculta dualidade; F12 OFF revela Fiscal × Não Fiscal', () => {
  const on = loadAll(true).AdaptiveLabelService;
  const off = loadAll(false).AdaptiveLabelService;
  assert.strictEqual(on.getLabel('vendas'), 'Vendas');
  assert.strictEqual(on.getBadge('nao_fiscal'), '');
  assert.strictEqual(off.getLabel('vendas', { scope: 'nao_fiscal' }), 'Vendas Não Fiscal');
  assert.strictEqual(off.getBadge('fiscal'), 'Fiscal');
});

test('Novos domínios via registerDomain (Produção/Indústria)', () => {
  const ALS = loadAll(false).AdaptiveLabelService;
  ALS.registerDomain('logistica', {
    base: 'Logística',
    fiscal: 'Logística Fiscal',
    naoFiscal: 'Logística Não Fiscal',
    shortBase: 'Log',
    i18nKey: 'labels.logistica'
  });
  assert.strictEqual(ALS.getLabel('logistica'), 'Logística Fiscal');
  assert.strictEqual(ALS.getShortLabel('logistica'), 'Logística Fiscal');
});

test('Monitoring UI sem decisão local de nomenclatura F12', () => {
  const ui = fs.readFileSync(
    path.join(__dirname, '../../frontend/erp/js/cds-monitoring-engine.js'),
    'utf8'
  );
  assert.ok(ui.includes('AdaptiveLabelService'));
  assert.ok(ui.includes('getLabel('));
  assert.ok(!ui.includes('geral_fixo'));
  assert.ok(!ui.includes('recebimentos_fixo'));
  assert.ok(!/\bif\s*\([^)]*F12[^)]*\)/.test(ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')));
  assert.ok(!ui.includes("paneStub('Estoque'"));
  assert.ok(ui.includes("getLabel('monitoramento')"));
  assert.ok(ui.includes("getLabel('acoes_recomendadas')"));
});

test('ERP carrega Provider após Service', () => {
  const index = fs.readFileSync(path.join(__dirname, '../../frontend/erp/index.html'), 'utf8');
  const iReg = index.indexOf('AdaptiveLabelRegistry.js');
  const iCtx = index.indexOf('AdaptiveLabelContext.js');
  const iSvc = index.indexOf('AdaptiveLabelService.js');
  const iProv = index.indexOf('AdaptiveLabelProvider.js');
  assert.ok(iReg > 0 && iCtx > iReg && iSvc > iCtx && iProv > iSvc);
});

test('i18n preparado (i18nKey + AdaptiveI18n + locale no Context)', () => {
  const svc = fs.readFileSync(
    path.join(__dirname, '../../frontend/shared/services/AdaptiveLabelService.js'),
    'utf8'
  );
  assert.ok(svc.includes('AdaptiveI18n'));
  assert.ok(svc.includes('getPlural'));
  assert.ok(svc.includes('getShortLabel'));
  assert.ok(svc.includes('getDescription'));
});

console.log(`\nResultado: ${ok} ok, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
