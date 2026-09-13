/**
 * Cadastro de produtos (ERP) não deve herdar F12/PDV para esconder saldo não fiscal.
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
  // eslint-disable-next-line global-require, import/no-dynamic-require
  delete require.cache[require.resolve(helpersPath)];
  // modoFiscalHelpers uses bare functions + window assignment; eval in sandbox
  const fs = require('fs');
  const code = fs.readFileSync(helpersPath, 'utf8');
  const sandbox = { window: root, module: { exports: {} }, exports: {}, console };
  // Attach expected globals used inside the file
  Object.assign(sandbox, {
    modoFiscalAtivoSistema: root.modoFiscalAtivoSistema,
    implantacaoPermiteFiscal: root.implantacaoPermiteFiscal,
    localStorage: root.localStorage,
    document: { body: { classList: { toggle() {} } }, getElementById: () => null, querySelector: () => null }
  });
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'window',
    'module',
    'exports',
    'console',
    'localStorage',
    'document',
    'modoFiscalAtivoSistema',
    'implantacaoPermiteFiscal',
    `${code}\nreturn { gestaoEstoqueDuploHabilitada, modoFiscalQueryParamGestaoProdutos, isModoFiscalSomenteCadastroEstoque, isModoFiscalVisualizacaoAtivo, modoFiscalQueryParam };`
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

if (test('Com F12/PDV fiscal ON, gestão de produtos continua modo completo (0)', () => {
  const h = loadHelpers({
    modoFiscalAtivoSistema: () => true,
    implantacaoPermiteFiscal: () => true
  });
  assert.strictEqual(h.isModoFiscalVisualizacaoAtivo(), true);
  assert.strictEqual(h.modoFiscalQueryParamGestaoProdutos(), '0');
  assert.strictEqual(h.gestaoEstoqueDuploHabilitada(), true);
  assert.strictEqual(h.isModoFiscalSomenteCadastroEstoque(), false);
})) ok++; else fail++;

if (test('Mesmo com implantação sem fiscal, cadastro ERP não fica “somente fiscal” por F12', () => {
  const h = loadHelpers({
    modoFiscalAtivoSistema: () => true,
    implantacaoPermiteFiscal: () => false
  });
  assert.strictEqual(h.gestaoEstoqueDuploHabilitada(), true);
  assert.strictEqual(h.isModoFiscalSomenteCadastroEstoque(), false);
  assert.strictEqual(h.modoFiscalQueryParamGestaoProdutos(), '0');
})) ok++; else fail++;

console.log(`Resultado: ${ok} OK, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
