/**
 * CDS Design System V2 — Adaptive Label System (UX-001)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

function loadServices(mockFiscalAtivo) {
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
  for (const file of ['AdaptiveLabelRegistry.js', 'AdaptiveLabelContext.js', 'AdaptiveLabelService.js']) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    vm.runInNewContext(code, sandbox, { filename: file });
  }
  return sandbox.AdaptiveLabelService;
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

console.log('\n=== Adaptive Label System UX-001 ===\n');

test('Arquivos do Adaptive Label System existem', () => {
  const root = path.join(__dirname, '../../frontend/shared/services');
  ['AdaptiveLabelService.js', 'AdaptiveLabelContext.js', 'AdaptiveLabelRegistry.js'].forEach((f) => {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  });
});

test('F12 ON — labels neutras sem Fiscal/Não Fiscal', () => {
  const ALS = loadServices(true);
  assert.strictEqual(ALS.getLabel('vendas'), 'Vendas');
  assert.strictEqual(ALS.getLabel('caixa'), 'Caixa');
  assert.strictEqual(ALS.getLabel('estoque'), 'Estoque');
  assert.strictEqual(ALS.getLabel('entradas'), 'Entradas NF');
  assert.strictEqual(ALS.getLabel('pix'), 'PIX');
  assert.strictEqual(ALS.getBadge('fiscal'), '');
  assert.strictEqual(ALS.getBadge('nao_fiscal'), '');
  assert.strictEqual(ALS.shouldShowNaoFiscal(), false);
  assert.ok(!/fiscal/i.test(ALS.getLabel('vendas')));
  assert.ok(!/fiscal/i.test(ALS.getLabel('aba.fiscal')));
});

test('F12 OFF — labels explícitas Fiscal / Não Fiscal', () => {
  const ALS = loadServices(false);
  assert.strictEqual(ALS.getLabel('vendas'), 'Vendas Fiscal');
  assert.strictEqual(ALS.getLabel('vendas', { scope: 'nao_fiscal' }), 'Vendas Não Fiscal');
  assert.strictEqual(ALS.getLabel('caixa', { scope: 'nao_fiscal' }), 'Caixa Não Fiscal');
  assert.strictEqual(ALS.getBadge('fiscal'), 'Fiscal');
  assert.strictEqual(ALS.getBadge('nao_fiscal'), 'Não Fiscal');
  assert.strictEqual(ALS.shouldShowNaoFiscal(), true);
});

test('labelForWidget usa registry de widgets', () => {
  const ALS = loadServices(true);
  assert.strictEqual(ALS.labelForWidget({ id: 'fiscal.vendas', title: 'Vendas Fiscais' }), 'Vendas');
  const ALS2 = loadServices(false);
  assert.strictEqual(ALS2.labelForWidget({ id: 'fiscal.vendas_nao_fiscal', scope: 'nao_fiscal' }), 'Vendas Não Fiscal');
});

test('sanitize remove Fiscal/Não Fiscal no modo fiscal', () => {
  const ALS = loadServices(true);
  assert.strictEqual(ALS.sanitize('Vendas Fiscais'), 'Vendas');
  assert.ok(!/não fiscal/i.test(ALS.sanitize('Caixa Não Fiscal está abaixo')));
  const ALS2 = loadServices(false);
  assert.strictEqual(ALS2.sanitize('Vendas Fiscal'), 'Vendas Fiscal');
});

test('registerDomain permite novos domínios', () => {
  const ALS = loadServices(false);
  assert.ok(ALS.registerDomain('producao', {
    base: 'Produção',
    fiscal: 'Produção Fiscal',
    naoFiscal: 'Produção Não Fiscal',
    i18nKey: 'labels.producao'
  }));
  assert.strictEqual(ALS.getLabel('producao'), 'Produção Fiscal');
  const ALSOn = loadServices(true);
  ALSOn.registerDomain('industria', {
    base: 'Indústria',
    fiscal: 'Indústria Fiscal',
    naoFiscal: 'Indústria Não Fiscal',
    i18nKey: 'labels.industria'
  });
  assert.strictEqual(ALSOn.getLabel('industria'), 'Indústria');
});

test('Monitoring UI consome AdaptiveLabelService', () => {
  const ui = fs.readFileSync(
    path.join(__dirname, '../../frontend/erp/js/cds-monitoring-engine.js'),
    'utf8'
  );
  assert.ok(ui.includes('AdaptiveLabelService'));
  assert.ok(ui.includes('getLabel(') || ui.includes('labelForWidget'));
  assert.ok(ui.includes('sanitizeText'));
  assert.ok(!ui.includes('Vendas fiscais'));
  assert.ok(!ui.includes('Receber fiscal'));
  assert.ok(!ui.includes('Caixa fiscal'));
});

test('ERP carrega scripts Adaptive Label', () => {
  const index = fs.readFileSync(path.join(__dirname, '../../frontend/erp/index.html'), 'utf8');
  assert.ok(index.includes('AdaptiveLabelRegistry.js'));
  assert.ok(index.includes('AdaptiveLabelContext.js'));
  assert.ok(index.includes('AdaptiveLabelService.js'));
});

test('i18n hook preparado (i18nKey + AdaptiveI18n)', () => {
  const svc = fs.readFileSync(
    path.join(__dirname, '../../frontend/shared/services/AdaptiveLabelService.js'),
    'utf8'
  );
  assert.ok(svc.includes('i18nKey'));
  assert.ok(svc.includes('AdaptiveI18n'));
});

console.log(`\nResultado: ${ok} ok, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
