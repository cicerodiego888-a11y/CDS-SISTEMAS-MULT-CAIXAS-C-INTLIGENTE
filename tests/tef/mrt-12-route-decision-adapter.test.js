'use strict';

/**
 * MRT-12 — Seleção de adapter orientada pelo RouteDecision
 * (sem INIT real / TX financeira / migration / gates).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  SELECTION_CODES,
  inspecionarSelecaoPorRouteDecision,
  selecionarAdapterPorRouteDecision
} = require('../../backend/services/tef/tefAdapterSelection');

const { criarAdapter, PROVEDORES } = require('../../backend/services/tef/tefFactory');
const { MODOS_ROUTER, criarRouteDecision } = require('../../backend/services/tef/terminalRouter/contracts');
const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');

function test(nome, fn) {
  const ret = fn();
  if (ret && typeof ret.then === 'function') {
    return ret.then(() => console.log(`  OK  ${nome}`)).catch((err) => {
      console.error(`  FAIL ${nome}`);
      throw err;
    });
  }
  console.log(`  OK  ${nome}`);
  return Promise.resolve();
}

function ler(rel) {
  return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
}

function decisionDestaxaSingleton(extras = {}) {
  return criarRouteDecision({
    sucesso: true,
    codigo: 'SINGLETON_FALLBACK',
    mensagem: 'compat singleton',
    modo: MODOS_ROUTER.COMPAT_SINGLETON,
    pdvId: null,
    provedor: 'destaxa',
    ambiente: 'simulacao',
    terminalTefId: 'singleton:instalacao',
    adapterBinding: {
      fonte: 'tef_configuracao_singleton',
      modo: 'COMPAT_SINGLETON',
      registro: {
        provedor: 'destaxa',
        ambiente: 'simulacao',
        empresa_codigo: 'EST-1',
        loja_codigo: 'LJ-1',
        terminal_codigo: 'TRM-1'
      },
      executionMode: 'native-host',
      terminalTefId: null,
      dispositivoId: null
    },
    executionContext: { topologia: 'ESTACAO_UNICA_PDV_UNICO' },
    ...extras
  });
}

function decisionRegistry(provedor, terminalId) {
  return criarRouteDecision({
    sucesso: true,
    codigo: 'REGISTRY_RESOLVED',
    mensagem: 'registry',
    modo: MODOS_ROUTER.REGISTRY_RESOLVE,
    pdvId: '1',
    provedor,
    ambiente: 'simulacao',
    terminalTefId: terminalId,
    adapterBinding: {
      fonte: 'tef_terminal_registry',
      modo: 'REGISTRY_RESOLVE',
      registro: {
        provedor,
        ambiente: 'simulacao',
        terminal_codigo: `LOGICO-${provedor}`
      },
      executionMode: provedor === 'destaxa' ? 'native-host' : 'adapter-default',
      terminalTefId: terminalId,
      dispositivoId: 'dev-1'
    },
    executionContext: { topologia: 'ESTACAO_UNICA_MULTI_PDV' }
  });
}

console.log('=== MRT-12 — RouteDecision → adapter ===\n');

(async () => {
  await test('1) RouteDecision seleciona adapter correspondente (Registry destaxa)', () => {
    const d = decisionRegistry('destaxa', 'tef-dx-1');
    const sel = selecionarAdapterPorRouteDecision(d);
    assert.strictEqual(sel.codigo, SELECTION_CODES.ADAPTER_OK);
    assert.strictEqual(sel.provedor, 'destaxa');
    assert.strictEqual(sel.terminalTefId, 'tef-dx-1');
    assert.strictEqual(sel.fonte, 'tef_terminal_registry');
    assert.ok(sel.adapter);
    assert.strictEqual(String(sel.adapter.nome).toLowerCase(), 'destaxa');
    assert.ok(sel.executionContext);
  });

  await test('1b) RouteDecision com provedor distinto do singleton (paygo simulado — sem cutover financeiro)', () => {
    const d = decisionRegistry('paygo', 'tef-pg-1');
    const sel = selecionarAdapterPorRouteDecision(d);
    assert.strictEqual(sel.provedor, 'paygo');
    assert.strictEqual(sel.adapter.nome, 'PayGo');
    assert.strictEqual(sel.terminalTefId, 'tef-pg-1');
  });

  await test('2) Destaxa continua pelo caminho singleton (COMPAT_SINGLETON)', () => {
    const d = decisionDestaxaSingleton();
    const sel = selecionarAdapterPorRouteDecision(d);
    assert.strictEqual(sel.modo, MODOS_ROUTER.COMPAT_SINGLETON);
    assert.strictEqual(sel.fonte, 'tef_configuracao_singleton');
    assert.strictEqual(sel.provedor, 'destaxa');
    assert.strictEqual(String(sel.adapter.nome).toLowerCase(), 'destaxa');
    assert.strictEqual(sel.executionMode, 'native-host');
  });

  await test('3) Provedor ausente → erro explícito', () => {
    const d = decisionDestaxaSingleton();
    d.provedor = null;
    d.adapterBinding.registro = { ambiente: 'simulacao' };
    const insp = inspecionarSelecaoPorRouteDecision(d);
    assert.strictEqual(insp.ok, false);
    assert.strictEqual(insp.codigo, SELECTION_CODES.PROVEDOR_AUSENTE);
    assert.throws(
      () => selecionarAdapterPorRouteDecision(d),
      (e) => e.codigo === SELECTION_CODES.PROVEDOR_AUSENTE
    );
  });

  await test('4) Adapter/provedor inexistente → erro explícito', () => {
    const d = decisionRegistry('provedor_fantasma_xyz', 'tef-x');
    const insp = inspecionarSelecaoPorRouteDecision(d);
    assert.strictEqual(insp.ok, false);
    assert.strictEqual(insp.codigo, SELECTION_CODES.PROVEDOR_NAO_RECONHECIDO);
    assert.throws(
      () => selecionarAdapterPorRouteDecision(d),
      (e) => e.codigo === SELECTION_CODES.PROVEDOR_NAO_RECONHECIDO
    );
  });

  await test('5) Sem fallback arbitrário LIMIT 1 (binding ausente / decisão falhou)', () => {
    const semBinding = decisionDestaxaSingleton();
    semBinding.adapterBinding = null;
    assert.throws(
      () => selecionarAdapterPorRouteDecision(semBinding),
      (e) => e.codigo === SELECTION_CODES.BINDING_AUSENTE
        && /sem fallback LIMIT 1/i.test(e.message)
    );

    const falhou = criarRouteDecision({
      sucesso: false,
      codigo: 'TERMINAL_AMBIGUO',
      mensagem: 'ambíguo',
      adapterBinding: null
    });
    assert.throws(
      () => selecionarAdapterPorRouteDecision(falhou),
      (e) => e.codigo === SELECTION_CODES.ROUTE_DECISION_FALHOU
    );

    assert.throws(
      () => selecionarAdapterPorRouteDecision(null),
      (e) => e.codigo === SELECTION_CODES.ROUTE_DECISION_AUSENTE
    );

    // Autorização no TefManager não chama obterAdapter
    const tm = ler('backend/services/tef/TefManager.js');
    assert.match(tm, /selecionarAdapterPorRouteDecision\(routeDecision\)/);
    const iAut = tm.indexOf('async autorizar');
    const iCancel = tm.indexOf('async cancelar(');
    assert.ok(iAut >= 0 && iCancel > iAut);
    const autorizarSlice = tm.slice(iAut, iCancel);
    assert.ok(
      !/await obterAdapter\(\)/.test(autorizarSlice),
      'autorizar não deve chamar obterAdapter()'
    );
    // Cancel/consulta preservam singleton
    assert.match(tm.slice(iCancel), /await obterAdapter\(\)/);
    assert.match(tm, /async consultar[\s\S]*?await obterAdapter\(\)/);
  });

  await test('6) Identidade do terminal permanece correta', () => {
    const d = decisionRegistry('destaxa', 'tef-id-77');
    const sel = selecionarAdapterPorRouteDecision(d);
    assert.strictEqual(sel.terminalTefId, 'tef-id-77');
    assert.strictEqual(sel.registro.terminal_codigo, 'LOGICO-destaxa');
    assert.strictEqual(d.terminalTefId, 'tef-id-77');
    assert.notStrictEqual(sel.terminalTefId, d.pdvId);
  });

  await test('7) Inconclusivos / TEF-14 bloqueios preservados (estático + política)', () => {
    const tm = ler('backend/services/tef/TefManager.js');
    assert.match(tm, /TRAVADO_RESULTADO_TARDIO/);
    assert.match(tm, /forcarInconclusivo/);
    assert.match(tm, /FINANCIAL_STATES\.UNKNOWN/);
    assert.match(tm, /garantirRecuperacao/);
    assert.match(tm, /idempotency_key/);
    assert.match(tm, /cancelamentoConfirmado/);
    assert.ok(FINANCIAL_STATES.UNKNOWN);
    assert.ok(FINANCIAL_STATES.PENDING);
  });

  await test('8) Regressões direcionadas MRT-02..11 / factory', () => {
    assert.ok(PROVEDORES.includes('destaxa'));
    assert.ok(criarAdapter({ provedor: 'destaxa', ambiente: 'simulacao' }));
    assert.ok(criarAdapter({ provedor: 'sitef', ambiente: 'simulacao' }));

    const contracts = ler('backend/services/tef/terminalRouter/contracts.js');
    assert.match(contracts, /adapterSelection/);
    assert.match(contracts, /MRT-12/);

    const selSrc = ler('backend/services/tef/tefAdapterSelection.js');
    assert.ok(!/buscarConfiguracaoPrincipal\s*\(/.test(selSrc), 'seleção não consulta LIMIT 1');
    assert.ok(!/obterAdapter\s*\(/.test(selSrc), 'seleção não chama obterAdapter');
    assert.match(selSrc, /selecionarAdapterPorRouteDecision/);

    const factory = ler('backend/services/tef/tefFactory.js');
    assert.match(factory, /MRT-12/);

    const ui = ler('frontend/erp/js/configuracao_tef.js');
    assert.match(ui, /Empresa \/ Mapeamento TEF/);
  });

  console.log('\nMRT-12 testes OK — sem INIT/TX/migration.\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
