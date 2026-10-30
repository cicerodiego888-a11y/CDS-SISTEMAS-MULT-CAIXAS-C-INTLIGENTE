/**
 * TEF-PPC930-05 — testes estáticos do precheck.
 * Não carrega DLL real e não invoca funções nativas Destaxa.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const report04 = path.join(root, 'docs/build/tef-ppc930-04-report.json');
const adapterPath = path.join(root, 'backend/services/tef/adapters/DestaxaRealAdapter.js');
const hostPath = path.join(root, 'backend/services/tef/destaxa/DestaxaNativeHost.js');
const diagPath = path.join(root, 'backend/services/tef/tefDiagnosticoService.js');
const bridgePath = path.join(root, 'backend/services/tef/destaxa/DestaxaNativeBridge.js');
const dllX64 = path.join(root, 'resources/tef/destaxa/win-x64/libdll-integracao-tef.dll');

test('PPC930-04 report exists and disables automatic INIT_CLIENT', () => {
  assert.equal(fs.existsSync(report04), true);
  const data = JSON.parse(fs.readFileSync(report04, 'utf8'));
  assert.equal(data.behaviorChanges.initClientAutomaticoNoDiagnostico, false);
});

test('diagnosticar loads DLL only when not loaded; does not call iniciarClient', () => {
  const src = fs.readFileSync(adapterPath, 'utf8');
  const diagnostico = src.match(/async diagnosticar\(\) \{[\s\S]*?\n  async testarConexao/);
  assert.ok(diagnostico, 'bloco diagnosticar deve existir');
  assert.match(diagnostico[0], /isLoaded\(\)/);
  assert.match(diagnostico[0], /bridge\.load\(\)/);
  assert.doesNotMatch(diagnostico[0], /iniciarClient\(/);
  const teste = src.match(/async testarConexao\(\) \{[\s\S]*?\n  _normalizarRespostaProtocolo/);
  assert.ok(teste, 'bloco testarConexao deve existir');
  assert.match(teste[0], /iniciarClient\(/);
});

test('executarDiagnosticoCompleto does not auto-call testarConexao/INIT_CLIENT', () => {
  const src = fs.readFileSync(diagPath, 'utf8');
  assert.match(src, /TEF-PPC930-04/);
  assert.match(src, /adapterTeste = null/);
  assert.doesNotMatch(
    src,
    /adapterTeste = await adapter\.testarConexao\(\);\s*\n\s*adapterDiag = await adapter\.diagnosticar\(\);/
  );
});

test('Native Host LOAD can reset clientInitialized; INIT_CLIENT is separate operation', () => {
  const bridge = fs.readFileSync(bridgePath, 'utf8');
  const host = fs.readFileSync(hostPath, 'utf8');
  assert.match(bridge, /this\._clientInitialized = false/);
  assert.match(bridge, /iniciaClientDestaxa/);
  assert.match(host, /OPERACOES_HOST\.LOAD/);
  assert.match(host, /OPERACOES_HOST\.INIT_CLIENT/);
});

test('checkout x64 DLL exists and contains required export names as bytes', () => {
  assert.equal(fs.existsSync(dllX64), true);
  const bytes = fs.readFileSync(dllX64);
  const text = bytes.toString('binary');
  for (const name of [
    'iniciaClientDestaxa',
    'iniciaTransacaoDestaxa',
    'continuaTransacaoDestaxa',
    'finalizaTransacaoDestaxa'
  ]) {
    assert.equal(text.includes(name), true, `export name missing in file scan: ${name}`);
  }
});

test('financial gate helper remains off unless env equals 1', () => {
  const { transacaoRealHabilitada, REAL_TRANSACTION_ENV } = require('../../backend/services/tef/destaxa/destaxaConstantes');
  assert.equal(REAL_TRANSACTION_ENV, 'DESTAXA_REAL_TRANSACTION_ENABLED');
  const previous = process.env[REAL_TRANSACTION_ENV];
  delete process.env[REAL_TRANSACTION_ENV];
  assert.equal(transacaoRealHabilitada(), false);
  process.env[REAL_TRANSACTION_ENV] = '0';
  assert.equal(transacaoRealHabilitada(), false);
  if (previous === undefined) delete process.env[REAL_TRANSACTION_ENV];
  else process.env[REAL_TRANSACTION_ENV] = previous;
});
