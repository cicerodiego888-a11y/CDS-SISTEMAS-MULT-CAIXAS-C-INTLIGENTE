'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const reportPath = path.resolve(__dirname, '../../docs/build/tef-destaxa-07g-adapter-status-report.json');
const databaseModulePath = require.resolve('../../backend/database');
require.cache[databaseModulePath] = {
  id: databaseModulePath,
  filename: databaseModulePath,
  loaded: true,
  exports: {
    get() {
      throw new Error('07G não deve consultar o banco da aplicação.');
    },
    all() {
      throw new Error('07G não deve consultar o banco da aplicação.');
    }
  }
};

const diagnosticService = require('../../backend/services/tef/tefDiagnosticoService');
const configService = require('../../backend/services/tef/tefConfigService');
const tefFactory = require('../../backend/services/tef/tefFactory');

const results = [];
const expectedTests = 8;

function registrarTeste(nome, executar) {
  test(nome, async () => {
    await executar();
    results.push({ nome, sucesso: true });
  });
}

registrarTeste('adapter instanciado não falha por comunicação não testada', async () => {
  const estados = diagnosticService.montarEstadosIntegracao({
    adapter: { modo: 'real' },
    adapterDiag: {
      sucesso: true,
      detalhes: { dllLoaded: true, exportsValid: true, clientInitialized: true, clientResultCode: '00' }
    },
    adapterTeste: { detalhes: { clientInitialized: true, codigoDestaxa: '00' } }
  });

  assert.equal(estados.adapter.instantiated, true);
  assert.equal(estados.adapter.diagnosisSucceeded, true);
  assert.equal(estados.dll.loaded, true);
  assert.equal(estados.client.initialized, true);
  assert.equal(estados.transactionCommunication.validated, false);
  assert.equal(estados.authorization.available, false);
});

registrarTeste('DLL carregada com Client não inicializado mantém estados separados', async () => {
  const estados = diagnosticService.montarEstadosIntegracao({
    adapter: { modo: 'real' },
    adapterDiag: {
      sucesso: true,
      detalhes: { dllLoaded: true, exportsValid: true, clientInitialized: false }
    },
    adapterTeste: { detalhes: { clientInitialized: false, estado: 'CLIENT_NOT_INITIALIZED' } }
  });

  assert.equal(estados.adapter.instantiated, true);
  assert.equal(estados.dll.loaded, true);
  assert.equal(estados.dll.exportsValidated, true);
  assert.equal(estados.client.initialized, false);
  assert.equal(estados.client.snapshotsConsistent, true);
  assert.equal(estados.transactionCommunication.validated, false);
});

registrarTeste('Client com código diferente de 00 preserva o código sem validar comunicação', async () => {
  const estados = diagnosticService.montarEstadosIntegracao({
    adapter: { modo: 'real' },
    adapterDiag: {
      sucesso: true,
      detalhes: { dllLoaded: true, exportsValid: true, clientInitialized: true, clientResultCode: '03' }
    },
    adapterTeste: { detalhes: { clientInitialized: true, codigoDestaxa: '03' } }
  });

  assert.equal(estados.client.initialized, true);
  assert.equal(estados.client.code, '03');
  assert.equal(estados.client.snapshotsConsistent, true);
  assert.equal(estados.transactionCommunication.validated, false);
  assert.equal(estados.authorization.available, false);
});

registrarTeste('adapter real indisponível não é tratado como instanciado', async () => {
  assert.throws(
    () => tefFactory.criarAdapter(
      { provedor: 'destaxa', ambiente: 'homologacao' },
      { verificarDisponibilidadeReal: () => ({ disponivel: false, mensagem: 'DLL ausente no mock' }) }
    ),
    (error) => error.codigo === 'DESTAXA_REAL_ADAPTER_INDISPONIVEL'
  );

  const erro = 'DESTAXA_REAL_ADAPTER_INDISPONIVEL: DLL ausente no mock';
  const estados = diagnosticService.montarEstadosIntegracao({ adapter: null, erroAdapter: erro });
  assert.equal(estados.adapter.instantiated, false);
  assert.equal(estados.adapter.diagnosisSucceeded, false);
  assert.equal(estados.adapter.error, erro);
});

registrarTeste('snapshots divergentes ficam sinalizados como inconsistentes', async () => {
  const estados = diagnosticService.montarEstadosIntegracao({
    adapter: { modo: 'real' },
    adapterDiag: { detalhes: { clientInitialized: false, clientResultCode: null } },
    adapterTeste: { detalhes: { clientInitialized: true, codigoDestaxa: '00' } }
  });
  assert.equal(estados.adapter.instantiated, true);
  assert.equal(estados.client.snapshotsConsistent, false);
});

registrarTeste('campo genérico de INI é não aplicável à Destaxa, sem invalidar configuração', async () => {
  const estado = diagnosticService.resolverValidacaoMiddleware('destaxa', {
    configuracaoValida: false,
    sitef: { configuracaoValida: false },
    paygo: { configuracaoValida: false }
  });
  assert.equal(estado.aplicavel, false);
  assert.equal(estado.valida, null);
  assert.match(estado.explicacao, /agrega somente.*SiTef e PayGo/i);
});

registrarTeste('validações INI SiTef e PayGo continuam específicas por provedor', async () => {
  const sitef = diagnosticService.resolverValidacaoMiddleware('sitef', {
    sitef: { configuracaoValida: true }
  });
  const paygo = diagnosticService.resolverValidacaoMiddleware('paygo', {
    paygo: { configuracaoValida: false }
  });
  const simulacao = diagnosticService.resolverValidacaoMiddleware('rede', {});
  assert.deepEqual(
    { aplicavel: sitef.aplicavel, valida: sitef.valida, fonte: sitef.fonte },
    { aplicavel: true, valida: true, fonte: 'sdk.sitef.configuracaoValida' }
  );
  assert.deepEqual(
    { aplicavel: paygo.aplicavel, valida: paygo.valida, fonte: paygo.fonte },
    { aplicavel: true, valida: false, fonte: 'sdk.paygo.configuracaoValida' }
  );
  assert.equal(simulacao.aplicavel, false);
});

registrarTeste('badge Adapter usa somente instância, não seleção nem operacionalidade', async () => {
  const frontendPath = path.resolve(__dirname, '../../frontend/erp/js/configuracao_tef.js');
  const frontend = fs.readFileSync(frontendPath, 'utf8');
  const mapa = frontend.match(/const mapaBadges = \{([\s\S]*?)\n        \};/);
  assert.ok(mapa, 'mapa de badges deve existir');
  assert.match(mapa[1], /adapter_carregado:\s*'diagAdapter'/);
  assert.equal((mapa[1].match(/'diagAdapter'/g) || []).length, 1);
  assert.doesNotMatch(mapa[1], /adapter_selecionado|adapter_operacional/);
  assert.match(frontend, /Adapter instanciado:/);
  assert.match(frontend, /Diagnóstico do adapter:/);
  assert.match(frontend, /DLL carregada:/);
  assert.match(frontend, /Exports validados:/);
  assert.match(frontend, /Client Destaxa inicializado:/);
  assert.match(frontend, /Código do Client:/);
  assert.match(frontend, /Comunicação transacional:/);
  assert.match(frontend, /Disponibilidade para autorizar:/);
});

test.after(() => {
  const success = results.length === expectedTests;
  const report = {
    sprint: 'TEF-DESTAXA-07G',
    status: success ? 'READY_FOR_07H_PRECHECK' : 'BLOCKED_WITH_FINDINGS',
    generatedAt: new Date().toISOString(),
    visualRule: {
      file: 'frontend/erp/js/configuracao_tef.js',
      function: 'executarDiagnosticoCompleto',
      badge: 'diagAdapter',
      priorMapping: [
        'adapter_selecionado → diagAdapter',
        'adapter_carregado → diagAdapter',
        'adapter_operacional → diagAdapter'
      ],
      priorCondition: 'Each matching item called atualizarStatus(elementId, item.ok) in report order; adapter_operacional=false was last and replaced the loaded state with a red X.',
      correctedRule: 'Only adapter_carregado maps to diagAdapter; operational communication has a distinct state and never overwrites adapter instantiation.',
      adapterLoadedValueIsInstancePresence: true
    },
    middlewareConfiguration: {
      rawField: 'middleware.configuracaoValida',
      source: 'sdkDetector.diagnosticarCompleto returns sitef.configuracaoValida || paygo.configuracaoValida',
      underlyingChecks: {
        sitef: 'INI CliSiTef presence and basic INI format',
        paygo: 'INI PayGo presence and basic INI format',
        destaxa: 'No INI validity field; Destaxa configuration is not evaluated by this aggregate.'
      },
      interpretationForDestaxa: 'Não aplicável; false only means neither SiTef nor PayGo INI validated. It is not the universal TEF configuration result.',
      contextualFieldAdded: 'middleware.configuracaoValidaProvedor',
      configurationValidationSource: 'validacao.valida and validacao.pendencias from tefConfigService'
    },
    stateSeparation: [
      'Adapter instance / adapter diagnosis result',
      'DLL loaded and exports validated',
      'Client initialization flag and code',
      'Provider middleware and VSPague process',
      'PPC930 Windows enumeration and COM consistency',
      'Transaction communication validation',
      'Payment authorization availability'
    ],
    executionEvidence: {
      testMode: 'mock-only',
      applicationDatabaseAccessed: false,
      configurationChanged: false,
      nativeDllLoaded: false,
      clientInitializationNativeCall: false,
      financialNativeCalls: {
        iniciaTransacaoDestaxa: false,
        continuaTransacaoDestaxa: false,
        finalizaTransacaoDestaxa: false
      },
      financialGateEnabledOrChanged: false,
      realClientEvidence: false,
      limitation: 'Mock tests validate the reporting contract and UI rule only; they do not prove runtime state at the customer installation.'
    },
    tests: {
      total: expectedTests,
      passed: results.length,
      failed: Math.max(expectedTests - results.length, 0),
      results
    },
    modifiedFiles: [
      'backend/services/tef/tefDiagnosticoService.js',
      'frontend/erp/js/configuracao_tef.js',
      'tests/tef/tef-destaxa-07g-adapter-status.test.js',
      'package.json',
      'docs/build/tef-destaxa-07g-adapter-status-report.json'
    ],
    findings: success ? [] : ['Um ou mais testes mockados falharam; não liberar pagamentos reais.']
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
});
