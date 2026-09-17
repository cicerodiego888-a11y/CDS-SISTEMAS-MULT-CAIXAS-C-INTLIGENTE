/**
 * Cadastro de produtos (ERP): F12 ativo oculta saldo não fiscal.
 */
'use strict';

const path = require('path');
const assert = require('assert');

const helpersPath = path.join(
  __dirname,
  '../../frontend/shared/js/modoFiscalHelpers.js'
);

function loadHelpers(globals = {}) {
  const root = {
    localStorage: {
      _d: Object.assign({ pdv_modo_fiscal_ativo: '1' }, globals.localStorage || {}),
      getItem(k) { return this._d[k] != null ? this._d[k] : null; },
      setItem(k, v) { this._d[k] = String(v); }
    },
    CDS_MODULE: globals.CDS_MODULE || 'erp',
    implantacaoPermiteFiscal: globals.implantacaoPermiteFiscal,
    modoFiscalAtivoSistema: globals.modoFiscalAtivoSistema
  };
  delete require.cache[require.resolve(helpersPath)];
  const fs = require('fs');
  const code = fs.readFileSync(helpersPath, 'utf8');
  const sandbox = { window: root, module: { exports: {} }, exports: {}, console };
  Object.assign(sandbox, {
    modoFiscalAtivoSistema: root.modoFiscalAtivoSistema,
    implantacaoPermiteFiscal: root.implantacaoPermiteFiscal,
    localStorage: root.localStorage,
    document: { body: { classList: { toggle() {} } }, getElementById: () => null, querySelector: () => null }
  });
  const fn = new Function(
    'window',
    'module',
    'exports',
    'console',
    'localStorage',
    'document',
    'modoFiscalAtivoSistema',
    'implantacaoPermiteFiscal',
    `${code}\nreturn { gestaoEstoqueDuploHabilitada, modoFiscalQueryParamGestaoProdutos, isModoFiscalSomenteCadastroEstoque, isModoFiscalVisualizacaoAtivo, modoFiscalQueryParam, f12OcultaNaoFiscal };`
  );
  return fn(
    root,
    sandbox.module,
    sandbox.exports,
    console,
    root.localStorage,
    sandbox.document,
    root.modoFiscalAtivoSistema || (() => root.localStorage.getItem('pdv_modo_fiscal_ativo') === '1'),
    root.implantacaoPermiteFiscal || (() => true)
  );
}

function test(nome, fn) {
  try {
    fn();
    console.log(`  OK  ${nome}`);
    return true;
  } catch (err) {
    console.error(`  FALHOU  ${nome}`);
    console.error(`    ${err.message}`);
    return false;
  }
}

let ok = 0;
let fail = 0;

if (test('Com F12 ativo, cadastro ERP fica somente fiscal', () => {
  const h = loadHelpers({
    modoFiscalAtivoSistema: () => true,
    implantacaoPermiteFiscal: () => true
  });
  assert.strictEqual(h.isModoFiscalVisualizacaoAtivo(), true);
  assert.strictEqual(h.f12OcultaNaoFiscal(), true);
  assert.strictEqual(h.modoFiscalQueryParamGestaoProdutos(), '1');
  assert.strictEqual(h.gestaoEstoqueDuploHabilitada(), false);
  assert.strictEqual(h.isModoFiscalSomenteCadastroEstoque(), true);
})) ok++; else fail++;

if (test('Com F12 inativo, cadastro ERP mostra os dois saldos', () => {
  const h = loadHelpers({
    modoFiscalAtivoSistema: () => false,
    implantacaoPermiteFiscal: () => true
  });
  assert.strictEqual(h.f12OcultaNaoFiscal(), false);
  assert.strictEqual(h.gestaoEstoqueDuploHabilitada(), true);
  assert.strictEqual(h.isModoFiscalSomenteCadastroEstoque(), false);
  assert.strictEqual(h.modoFiscalQueryParamGestaoProdutos(), '0');
})) ok++; else fail++;

console.log(`Resultado: ${ok} OK, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
