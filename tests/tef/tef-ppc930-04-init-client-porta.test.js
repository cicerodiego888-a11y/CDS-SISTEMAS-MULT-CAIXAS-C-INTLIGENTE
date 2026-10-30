/**
 * TEF-PPC930-04 — Separação do INIT_CLIENT e normalização da porta COM.
 *
 * Testes isolados/mocados. Não carrega DLL real, não chama iniciaClientDestaxa
 * nativo e não executa transações financeiras.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const reportPath = path.resolve(__dirname, '../../docs/build/tef-ppc930-04-report.json');
const databaseModulePath = require.resolve('../../backend/database');
require.cache[databaseModulePath] = {
  id: databaseModulePath,
  filename: databaseModulePath,
  loaded: true,
  exports: {
    get() {
      throw new Error('PPC930-04 não deve consultar o banco da aplicação.');
    },
    all() {
      throw new Error('PPC930-04 não deve consultar o banco da aplicação.');
    }
  }
};

const diagnosticService = require('../../backend/services/tef/tefDiagnosticoService');
const configService = require('../../backend/services/tef/tefConfigService');

const results = [];
const expectedTests = 6;

function registrarTeste(nome, executar) {
  test(nome, async () => {
    await executar();
    results.push({ nome, sucesso: true });
  });
}

registrarTeste('V$Pague executando, mas INIT_CLIENT não executado', () => {
  const estados = diagnosticService.montarEstadosIntegracao({
    adapter: { modo: 'real' },
    adapterDiag: {
      sucesso: true,
      detalhes: { dllLoaded: true, exportsValid: true, clientInitialized: false }
    },
    adapterTeste: null,
    sdk: { vspague: { detectado: true, executando: true, responding: true } },
    pinpad: { codigo: 'GERTEC_PPC930', hardware: { detectado: true, porta: 'COM3' } },
    config: { portaCom: 'COM3' }
  });

  assert.equal(estados.vspague.detected, true);
  assert.equal(estados.vspague.running, true);
  assert.equal(estados.client.initClientExecuted, 'NAO_EXECUTADO');
  assert.equal(estados.client.initialized, false);
  assert.equal(estados.client.code, null);
  assert.equal(estados.client.codeStatus, 'NAO_EXECUTADO');
});

registrarTeste('DLL carregada, mas Client não inicializado', () => {
  const estados = diagnosticService.montarEstadosIntegracao({
    adapter: { modo: 'real' },
    adapterDiag: {
      sucesso: true,
      detalhes: { dllLoaded: true, exportsValid: true, clientInitialized: false, estado: 'EXPORTS_VALID' }
    },
    adapterTeste: null
  });

  assert.equal(estados.dll.loaded, true);
  assert.equal(estados.dll.exportsValidated, true);
  assert.equal(estados.adapter.diagnosisSucceeded, true);
  assert.equal(estados.client.initClientExecuted, 'NAO_EXECUTADO');
  assert.equal(estados.client.initialized, false);
  assert.equal(estados.client.code, null);
});

registrarTeste('INIT_CLIENT com código 00 em teste isolado/mocado', () => {
  const estados = diagnosticService.montarEstadosIntegracao({
    adapter: { modo: 'real' },
    adapterDiag: {
      sucesso: true,
      detalhes: {
        dllLoaded: true,
        exportsValid: true,
        clientInitialized: true,
        clientResultCode: '00',
        estado: 'CLIENT_INITIALIZED'
      }
    },
    adapterTeste: {
      detalhes: {
        clientInitialized: true,
        codigoDestaxa: '00',
        estado: 'CLIENT_INITIALIZED',
        initClientExecuted: 'EXECUTADO'
      }
    }
  });

  assert.equal(estados.client.initClientExecuted, 'EXECUTADO');
  assert.equal(estados.client.initialized, true);
  assert.equal(estados.client.code, '00');
  assert.equal(estados.client.codeStatus, 'INFORMADO');
  assert.equal(estados.transactionCommunication.validated, false);
});

registrarTeste('INIT_CLIENT com código diferente de 00', () => {
  const estados = diagnosticService.montarEstadosIntegracao({
    adapter: { modo: 'real' },
    adapterDiag: {
      sucesso: true,
      detalhes: {
        dllLoaded: true,
        exportsValid: true,
        clientInitialized: false,
        clientResultCode: '03',
        estado: 'CLIENT_ERROR'
      }
    },
    adapterTeste: {
      detalhes: {
        clientInitialized: false,
        codigoDestaxa: '03',
        estado: 'CLIENT_ERROR',
        initClientExecuted: 'EXECUTADO'
      }
    }
  });

  assert.equal(estados.client.initClientExecuted, 'EXECUTADO');
  assert.equal(estados.client.initialized, false);
  assert.equal(estados.client.code, '03');
  assert.equal(estados.client.codeStatus, 'INFORMADO');
  assert.equal(estados.authorization.available, false);
});

registrarTeste('Porta COM3 versus COM 3', () => {
  const analise = configService.analisarPortaCom('COM 3');
  assert.equal(analise.normalizada, 'COM3');
  assert.equal(analise.valida, true);
  assert.equal(analise.suspeita, false);
  assert.equal(analise.correcaoAplicada.de, 'COM 3');
  assert.equal(analise.correcaoAplicada.para, 'COM3');

  const comparacao = configService.compararPortaPinpad('COM3', 'COM 3');
  assert.equal(comparacao.coincidem, true);
  assert.equal(comparacao.salva, 'COM3');
  assert.equal(comparacao.detectada, 'COM3');
  assert.equal(comparacao.salvaOriginal, 'COM3');
  assert.equal(comparacao.detectadaOriginal, 'COM 3');

  const estados = diagnosticService.montarEstadosIntegracao({
    pinpad: { codigo: 'GERTEC_PPC930', hardware: { detectado: true, porta: 'COM 3' } },
    config: { portaCom: 'COM3' }
  });
  assert.equal(estados.pinpad.configuredPort, 'COM3');
  assert.equal(estados.pinpad.detectedPort, 'COM3');
  assert.equal(estados.pinpad.configuredPortOriginal, 'COM3');
  assert.equal(estados.pinpad.detectedPortOriginal, 'COM 3');
  assert.equal(estados.pinpad.comConsistent, true);
});

registrarTeste('Porta CON3 sinalizada como inválida ou suspeita, sem conversão silenciosa', () => {
  const analise = configService.analisarPortaCom('CON3');
  assert.equal(analise.original, 'CON3');
  assert.equal(analise.normalizada, 'CON3');
  assert.equal(analise.valida, false);
  assert.equal(analise.suspeita, true);
  assert.equal(analise.correcaoAplicada, null);
  assert.match(String(analise.motivoSuspeita || ''), /CON\d+/i);

  const comparacao = configService.compararPortaPinpad('CON3', 'COM3');
  assert.equal(comparacao.coincidem, false);
  assert.equal(comparacao.salva, 'CON3');
  assert.equal(comparacao.detectada, 'COM3');
  assert.equal(comparacao.salvaSuspeita, true);
  assert.equal(comparacao.detectadaSuspeita, false);
  assert.equal(comparacao.correcaoSilenciosa, false);

  const estados = diagnosticService.montarEstadosIntegracao({
    pinpad: { codigo: 'GERTEC_PPC930', hardware: { detectado: true, porta: 'COM3' } },
    config: { portaCom: 'CON3' }
  });
  assert.equal(estados.pinpad.configuredPort, 'CON3');
  assert.equal(estados.pinpad.detectedPort, 'COM3');
  assert.equal(estados.pinpad.configuredPortOriginal, 'CON3');
  assert.equal(estados.pinpad.comConsistent, false);
  assert.equal(estados.pinpad.configuredPortSuspeita, true);
  assert.equal(estados.pinpad.portCorrectionSilent, false);
});

test.after(() => {
  assert.equal(results.length, expectedTests);

  const frontendPath = path.resolve(__dirname, '../../frontend/erp/js/configuracao_tef.js');
  const frontend = fs.readFileSync(frontendPath, 'utf8');
  assert.match(frontend, /INIT_CLIENT/);
  assert.match(frontend, /NAO_EXECUTADO/);
  assert.match(frontend, /configuredPortOriginal|porta configurada/i);

  const diagnosticoPath = path.resolve(__dirname, '../../backend/services/tef/tefDiagnosticoService.js');
  const diagnosticoSrc = fs.readFileSync(diagnosticoPath, 'utf8');
  assert.match(diagnosticoSrc, /TEF-PPC930-04/);
  assert.doesNotMatch(
    diagnosticoSrc,
    /adapterTeste = await adapter\.testarConexao\(\);\s*\n\s*adapterDiag = await adapter\.diagnosticar\(\);/
  );

  const report = {
    sprint: 'TEF-PPC930-04',
    title: 'Separação do INIT_CLIENT e normalização da porta COM',
    generatedAt: new Date().toISOString(),
    verdict: 'READY_FOR_NEXT_PRECHECK',
    modifiedFiles: [
      'backend/services/tef/tefConfigService.js',
      'backend/services/tef/tefDiagnosticoService.js',
      'frontend/erp/js/configuracao_tef.js',
      'tests/tef/tef-ppc930-04-init-client-porta.test.js',
      'package.json',
      'docs/build/tef-ppc930-04-report.json'
    ],
    behaviorChanges: {
      initClientAutomaticoNoDiagnostico: false,
      estadosClientSeparados: [
        'vspague process',
        'dll loaded/exports',
        'initClientExecuted',
        'destaxa return code',
        'client initialized'
      ],
      portaComNormalizacao: 'COM3 e COM 3 equivalem; CON3 marcada suspeita sem conversão silenciosa',
      inferenciaProibida: [
        'não inferir Client a partir de V$Pague',
        'não inferir Client a partir do sucesso do diagnóstico da DLL',
        'não inventar código quando INIT_CLIENT = NAO_EXECUTADO'
      ]
    },
    tests: {
      total: expectedTests,
      passed: results.length,
      failed: 0,
      results
    },
    financialSafety: {
      iniciaTransacaoDestaxa: false,
      continuaTransacaoDestaxa: false,
      finalizaTransacaoDestaxa: false,
      DESTAXA_REAL_TRANSACTION_ENABLED: false,
      dllCarregadaNestaSprint: false,
      clientRealInicializadoNestaSprint: false
    },
    limitations: [
      'Testes usam mocks; não comprovam estado runtime da instalação do cliente.',
      'INIT_CLIENT real não foi executado nesta sprint.',
      'Nenhuma transação financeira foi executada.'
    ]
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
});
