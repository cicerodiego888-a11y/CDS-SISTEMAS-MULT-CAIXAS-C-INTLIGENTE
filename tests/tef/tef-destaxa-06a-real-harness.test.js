/**
 * TEF-DESTAXA-06A — Harness de Homologação Real.
 *
 * Permitido: carregar DLL, validar exports e chamar iniciaClientDestaxa().
 * Proibido: qualquer chamada transacional real.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  DestaxaRealHarnessService,
  HARNESS_ENV,
  TRANSACTION_ENV,
  TRANSACTION_BLOCK_CODE,
  EXPECTED_CLIENT_INPUT,
  caminhoRelatorio
} = require('../../backend/services/tef/destaxa/destaxaRealHarnessService');

let passou = 0;
let falhou = 0;

async function test(nome, fn) {
  try {
    await fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.stack || error.message}`);
  }
}

function totalChamadas(transaction) {
  return Number(transaction.iniciaCalls || 0)
    + Number(transaction.continuaCalls || 0)
    + Number(transaction.finalizaCalls || 0);
}

async function main() {
  console.log('\nTEF-DESTAXA-06A — HARNESS DE HOMOLOGAÇÃO REAL\n');

  if (String(process.env[HARNESS_ENV] || '').trim() !== '1') {
    console.error(`BLOQUEADO: execute somente com ${HARNESS_ENV}=1`);
    process.exit(2);
  }
  if (String(process.env[TRANSACTION_ENV] || '').trim() === '1') {
    console.error(`BLOQUEADO: ${TRANSACTION_ENV} deve permanecer desabilitada`);
    process.exit(2);
  }

  const service = new DestaxaRealHarnessService();
  let execucaoNode = null;

  await test('harness recusa execução sem DESTAXA_REAL_HARNESS=1', () => {
    const valorAnterior = process.env[HARNESS_ENV];
    delete process.env[HARNESS_ENV];
    try {
      assert.throws(
        () => service.validarGate(),
        (error) => error.code === 'DESTAXA_REAL_HARNESS_DISABLED'
      );
    } finally {
      process.env[HARNESS_ENV] = valorAnterior;
    }
  });

  await test('gate explícito de homologação está ativo e gate financeiro desabilitado', () => {
    assert.doesNotThrow(() => service.validarGate());
    assert.notStrictEqual(String(process.env[TRANSACTION_ENV] || '').trim(), '1');
  });

  await test('tentativa conceitual de CRT é bloqueada antes do adapter/bridge/DLL', () => {
    const bloqueio = service.bloquearSolicitacaoFinanceira({ operacao: 'CRT', valor: 1 });
    assert.strictEqual(bloqueio.codigo, TRANSACTION_BLOCK_CODE);
    assert.strictEqual(bloqueio.attempted, false);
    assert.strictEqual(bloqueio.reachedAdapter, false);
    assert.strictEqual(bloqueio.reachedBridge, false);
    assert.strictEqual(bloqueio.reachedDll, false);
  });

  await test('harness Node percorre arquitetura real somente até CLIENT_INITIALIZED', async () => {
    execucaoNode = await service.executar();
    assert.strictEqual(execucaoNode.relatorio.result, 'READY_FOR_REAL_PINPAD');
  });

  if (execucaoNode) {
    const nodeReport = execucaoNode.relatorio;

    await test('ambiente Node é Windows x64', () => {
      assert.strictEqual(nodeReport.environment.platform, 'win32');
      assert.strictEqual(nodeReport.environment.arch, 'x64');
      assert.ok(nodeReport.environment.node);
      assert.ok(nodeReport.environment.koffi);
    });

    await test('cadeia Manager/Factory/Adapter/Orquestrador/Bridge/Loader está presente', () => {
      assert.strictEqual(nodeReport.architectureChain.manager, 'TefManager');
      assert.strictEqual(nodeReport.architectureChain.factory, 'TefFactory');
      assert.strictEqual(nodeReport.architectureChain.adapter, 'DestaxaRealAdapter');
      assert.strictEqual(nodeReport.architectureChain.orchestrator, 'DestaxaTransacaoOrquestrador');
      assert.strictEqual(nodeReport.architectureChain.bridge, 'DestaxaNativeBridge');
      assert.strictEqual(nodeReport.architectureChain.loader, 'destaxaKoffiLoader');
    });

    await test('DLL oficial 1.83 x64 íntegra, carregada e com quatro exports', () => {
      assert.strictEqual(nodeReport.dll.exists, true);
      assert.strictEqual(nodeReport.dll.loaded, true);
      assert.strictEqual(nodeReport.dll.architecture, 'x64');
      assert.strictEqual(nodeReport.dll.packageVersion, '1.83');
      assert.strictEqual(nodeReport.dll.exports, 4);
      assert.match(nodeReport.dll.path.replace(/\\/g, '/'), /resources\/tef\/destaxa\/win-x64\/libdll-integracao-tef\.dll$/);
    });

    await test('Client real retorna 00 / CLIENT_INITIALIZED com entrada oficial', () => {
      assert.strictEqual(nodeReport.client.initialized, true);
      assert.strictEqual(nodeReport.client.code, '00');
      assert.strictEqual(nodeReport.client.state, 'CLIENT_INITIALIZED');
      assert.strictEqual(nodeReport.client.input, EXPECTED_CLIENT_INPUT);
    });

    await test('VSPagueClient já existente está ativo e respondendo, com PID', () => {
      assert.strictEqual(nodeReport.vspague.found, true);
      assert.strictEqual(nodeReport.vspague.running, true);
      assert.strictEqual(nodeReport.vspague.responding, true);
      assert.ok(nodeReport.vspague.pid);
      assert.strictEqual(nodeReport.vspague.startedByHarness, false);
    });

    await test('PPC930 ausente é registrado como NOT_DETECTED', () => {
      assert.strictEqual(nodeReport.pinpad.status, 'NOT_DETECTED');
      assert.strictEqual(nodeReport.pinpad.detected, false);
    });

    await test('nenhum transactionId financeiro e zero chamadas transacionais', () => {
      assert.strictEqual(nodeReport.financialTransactionId, null);
      assert.strictEqual(nodeReport.transaction.attempted, false);
      assert.strictEqual(totalChamadas(nodeReport.transaction), 0);
      assert.deepStrictEqual(nodeReport.transaction.transactionCalls, {
        inicia: 0,
        continua: 0,
        finaliza: 0
      });
    });
  }

  let electronResult = null;
  await test('harness executa no Electron real e encerra antes de transação', () => {
    const electronPath = require('electron');
    electronResult = spawnSync(electronPath, ['.'], {
      cwd: require('path').resolve(__dirname, '../..'),
      env: {
        ...process.env,
        DESTAXA_REAL_HARNESS: '1',
        DESTAXA_REAL_HARNESS_ELECTRON: '1',
        DESTAXA_REAL_TRANSACTION_ENABLED: '0'
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024
    });

    if (electronResult.stdout) process.stdout.write(electronResult.stdout);
    if (electronResult.stderr) process.stderr.write(electronResult.stderr);
    assert.strictEqual(electronResult.error, undefined);
    assert.strictEqual(electronResult.status, 0);
  });

  await test('relatório final contém runtime Electron 22.3.27/Node 16.17.1/ABI 110', () => {
    const arquivo = caminhoRelatorio();
    assert.strictEqual(fs.existsSync(arquivo), true);
    const report = JSON.parse(fs.readFileSync(arquivo, 'utf8'));

    assert.strictEqual(report.sprint, 'TEF-DESTAXA-06A');
    assert.strictEqual(report.environment.platform, 'win32');
    assert.strictEqual(report.environment.arch, 'x64');
    assert.strictEqual(report.environment.electron, '22.3.27');
    assert.strictEqual(report.environment.node, '16.17.1');
    assert.strictEqual(report.environment.abi, '110');
    assert.ok(report.runs.node);
    assert.ok(report.runs.electron);
    assert.strictEqual(report.result, 'READY_FOR_REAL_PINPAD');
    assert.strictEqual(totalChamadas(report.transaction), 0);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
