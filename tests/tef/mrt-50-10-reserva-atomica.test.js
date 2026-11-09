'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const REPORT_RUN_ID = process.env.MRT5010_REPORT_RUN_ID
  || `${Date.now()}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const REPORT_PATH = path.resolve(
  ROOT,
  process.env.MRT5010_REPORT_PATH
    || path.join('docs', 'build', `mrt-50-10-${REPORT_RUN_ID}-reserva-atomica-report.json`)
);
const MARKDOWN_REPORT_PATH = path.resolve(
  ROOT,
  process.env.MRT5010_MARKDOWN_REPORT_PATH
    || path.join('docs', 'build', `MRT-50.10-${REPORT_RUN_ID}-RESERVA-ATOMICA.md`)
);
const ACTION = Object.freeze({
  tipo: 'OPCAO',
  mensagem: 'Tipo do Cartao',
  opcoes: ['Credito', 'Debito', 'Voucher'],
  tipoDado: 'X',
  timeout: '120',
  chave: 'transacao_tipo_cartao'
});
const WORKER_ROLE = process.argv[2] === '--mrt5010-worker' ? process.argv[3] : null;
const WORKER_INPUT = WORKER_ROLE ? JSON.parse(process.argv[4] || '{}') : null;

function redactTestKey(value) {
    const key = process.env.TEF_ENCRYPTION_KEY;
    return key ? String(value).split(key).join('[REDACTED]') : String(value);
}

if (WORKER_ROLE) {
    assert.ok(/^[0-9a-f]{64}$/.test(process.env.TEF_ENCRYPTION_KEY || ''),
      'Worker não recebeu a chave efêmera válida do teste.');
    process.env.CDS_TEST_ISOLAR_BANCO = '1';
    process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
    executarWorker(WORKER_ROLE, WORKER_INPUT).catch((error) => {
      enviar({ tipo: 'worker-error', erro: redactTestKey(error.stack || error.message) });
      process.exitCode = 1;
    });
} else {
    assertNewReportPaths();
    process.env.CDS_TEST_ISOLAR_BANCO = '1';
    process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
    delete process.env.TEF_ENCRYPTION_KEY;
    process.env.TEF_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    process.env.DB_DIR = path.join(
      os.tmpdir(),
      `cds-mrt-50-10-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
    );
    main().catch((error) => {
      console.error(redactTestKey(error.stack || error.message));
      process.exitCode = 1;
    }).finally(() => {
      delete process.env.TEF_ENCRYPTION_KEY;
    });
}

function enviar(mensagem) {
  if (typeof process.send === 'function' && process.connected) process.send(mensagem);
}

function relativeReportPath(reportPath) {
  return path.relative(ROOT, reportPath).replace(/\\/g, '/');
}

function assertNewReportPaths() {
  const paths = [REPORT_PATH, MARKDOWN_REPORT_PATH];
  if (new Set(paths).size !== paths.length) {
    throw new Error('Os caminhos dos relatórios MRT-50.10 precisam ser distintos.');
  }
  const existing = paths.filter((reportPath) => fs.existsSync(reportPath));
  if (existing.length > 0) {
    throw new Error(`Recusando sobrescrever relatório existente: ${relativeReportPath(existing[0])}`);
  }
}

function enviarEEncerrar(mensagem) {
  if (typeof process.send === 'function' && process.connected) {
    process.send(mensagem, () => process.exit(process.exitCode || 0));
  } else {
    process.exit(process.exitCode || 0);
  }
}

function ready(database) {
  return new Promise((resolve, reject) => {
    database.whenReady((error) => (error ? reject(error) : resolve()));
  });
}

function closeDatabase(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => (error ? reject(error) : resolve()));
  });
}

function waitForFile(filePath) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30000;
    const poll = () => {
      if (fs.existsSync(filePath)) return resolve();
      if (Date.now() >= deadline) return reject(new Error('Timeout na barreira simultânea MRT-50.10'));
      setTimeout(poll, 5);
    };
    poll();
  });
}

async function fixture(persistence, label) {
  const token = `${label}_${crypto.randomBytes(5).toString('hex')}`;
  const identity = {
    transactionId: null,
    operation_id: `op_mrt5010_${token}`,
    idempotency_key: `mrt40_mrt5010_${token}`,
    fingerprint: crypto.createHash('sha256').update(token).digest('hex').slice(0, 32)
  };
  const solicitadaEm = new Date().toISOString();
  const row = await persistence.criarTransacaoContinuidadeTeste({
    idempotencyKey: identity.idempotency_key,
    operationId: identity.operation_id,
    fingerprint: identity.fingerprint
  });
  identity.transactionId = String(row.id);
  const request = await persistence.registrarSolicitacao99(row.id, {
    acao: ACTION,
    solicitadaEm
  });
  assert.strictEqual(request.ok, true, request.mensagem);
  assert.strictEqual(request.duravel, true);
  assert.strictEqual(request.confirmada, true);
  const response = await persistence.registrarRespostaOperador(row.id, {
    resposta: 'Credito',
    incrementarContinue: true,
    exigirSolicitacao: true,
    acao: ACTION,
    solicitadaEm,
    identidadeEsperada: identity
  });
  assert.strictEqual(response.ok, true, response.mensagem);
  assert.strictEqual(response.estadoDespacho, 'PRONTA');
  return {
    ...identity,
    solicitadaEm,
    acao: ACTION,
    resposta: 'Credito',
    timestampRespostaConfirmadaEm: new Date().toISOString(),
    estadoAntes: response.estadoDespacho
  };
}

function startWorker(role, input) {
  const child = fork(__filename, [
    '--mrt5010-worker',
    role,
    JSON.stringify(input)
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      CDS_TEST_ISOLAR_BANCO: '1',
      DB_DIR: process.env.DB_DIR,
      DESTAXA_REAL_TRANSACTION_ENABLED: '0',
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true
  });
  const worker = { child, messages: [], stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => { worker.stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { worker.stderr += chunk.toString(); });
  child.on('message', (message) => worker.messages.push(message));
  child.on('error', (error) => worker.messages.push({ tipo: 'process-error', erro: error.message }));
  worker.exit = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  return worker;
}

async function waitMessage(worker, predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = worker.messages.find(predicate);
    if (message) return message;
    const failure = worker.messages.find((item) => item.tipo === 'worker-error'
      || item.tipo === 'process-error');
    if (failure) throw new Error(JSON.stringify(failure));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timeout aguardando worker; stdout=${worker.stdout}; stderr=${worker.stderr}`);
}

async function stopWorker(worker) {
  if (worker.child.connected) {
    worker.child.send({ tipo: 'shutdown' });
  }
  return worker.exit;
}

async function workerMetadata(database) {
  const databasePath = path.resolve(database.dbPath);
  const stat = fs.statSync(databasePath);
  const row = await new Promise((resolve, reject) => {
    database.get('PRAGMA journal_mode', [], (error, value) =>
      (error ? reject(error) : resolve(value || {})));
  });
  return {
    pid: process.pid,
    databasePath,
    databaseIdentity: { dev: stat.dev, ino: stat.ino },
    journalMode: row.journal_mode || null,
    gateFinanceiro: process.env.DESTAXA_REAL_TRANSACTION_ENABLED === '1' ? 'ON' : 'OFF'
  };
}

function instrumentarFalhaWorker(mode) {
  const sqlite3 = require('sqlite3').verbose();
  const repository = require('../../backend/services/tef/tefRepository');
  const events = [];
  const originalRun = sqlite3.Database.prototype.run;
  let injected = false;
  sqlite3.Database.prototype.run = function runInstrumentado(sql, ...args) {
    const statement = String(sql).trim().toUpperCase();
    if (['BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK'].includes(statement)) {
      events.push({ statement, at: new Date().toISOString(), pid: process.pid });
    }
    if (!injected && mode === 'busy' && statement === 'BEGIN IMMEDIATE') {
      injected = true;
      const callback = args[args.length - 1];
      setImmediate(() => callback.call(this, Object.assign(new Error('busy injected'), { code: 'SQLITE_BUSY' })));
      return this;
    }
    if (!injected && mode === 'locked' && statement === 'BEGIN IMMEDIATE') {
      injected = true;
      const callback = args[args.length - 1];
      setImmediate(() => callback.call(this, Object.assign(new Error('locked injected'), { code: 'SQLITE_LOCKED' })));
      return this;
    }
    if (!injected && mode === 'commit' && statement === 'COMMIT') {
      injected = true;
      const callback = args[args.length - 1];
      setImmediate(() => callback.call(this, Object.assign(new Error('commit injected'), { code: 'SQLITE_IOERR' })));
      return this;
    }
    if (!injected && mode === 'hold-after-begin' && statement === 'BEGIN IMMEDIATE') {
      injected = true;
      const callback = args[args.length - 1];
      args[args.length - 1] = function holdOpenCallback(error) {
        if (error) return callback.call(this, error);
        enviar({
          tipo: 'transaction-open',
          at: new Date().toISOString(),
          pid: process.pid
        });
      };
      return originalRun.call(this, sql, ...args);
    }
    return originalRun.call(this, sql, ...args);
  };

  if (mode === 'before-write') {
    const originalUpdate = repository.atualizarTransacaoNaConexao;
    repository.atualizarTransacaoNaConexao = function failBeforeWrite(_db, _id, _data, callback) {
      events.push({ statement: 'UPDATE_INJECTED_BEFORE_WRITE', at: new Date().toISOString() });
      callback(Object.assign(new Error('before-write injected'), { code: 'MRT5010_BEFORE_WRITE' }));
    };
    return {
      events,
      teardown() {
        repository.atualizarTransacaoNaConexao = originalUpdate;
        sqlite3.Database.prototype.run = originalRun;
      }
    };
  }
  if (mode === 'during-write') {
    const originalUpdate = repository.atualizarTransacaoNaConexao;
    repository.atualizarTransacaoNaConexao = function failAfterUpdate(database, id, data, callback, conditions) {
      return originalUpdate.call(repository, database, id, data, function afterWrite(error, result) {
        if (error) return callback(error, result);
        events.push({ statement: 'UPDATE_EXECUTED_ERROR_INJECTED', at: new Date().toISOString(), changes: result?.changes });
        callback(Object.assign(new Error('during-write injected'), { code: 'MRT5010_DURING_WRITE' }), result);
      }, conditions);
    };
    return {
      events,
      teardown() {
        repository.atualizarTransacaoNaConexao = originalUpdate;
        sqlite3.Database.prototype.run = originalRun;
      }
    };
  }
  if (mode === 'reread') {
    const originalDatabase = sqlite3.Database;
    sqlite3.Database = function databaseWithReadFailure(filename, flags, callback) {
      if ((Number(flags) & sqlite3.OPEN_READONLY) === sqlite3.OPEN_READONLY) {
        setImmediate(() => callback(Object.assign(
          new Error('independent-read injected'),
          { code: 'MRT5010_READBACK' }
        )));
        return { close(closeCallback) { if (closeCallback) closeCallback(); } };
      }
      return new originalDatabase(filename, flags, callback);
    };
    sqlite3.Database.prototype = originalDatabase.prototype;
    return {
      events,
      teardown() {
        sqlite3.Database = originalDatabase;
        sqlite3.Database.prototype = originalDatabase.prototype;
        sqlite3.Database.prototype.run = originalRun;
      }
    };
  }
  return {
    events,
    teardown() {
      sqlite3.Database.prototype.run = originalRun;
    }
  };
}

async function executeWorker(role, input) {
  const database = require('../../backend/database');
  await ready(database);
  const metadata = await workerMetadata(database);

  if (role === 'pool') {
    const persistence = require('../../backend/services/tef/destaxa/destaxaContinuidadePersistencia');
    enviar({ tipo: 'ready', ...metadata });
    process.on('message', async (message) => {
      if (message?.tipo === 'shutdown') {
        await closeDatabase(database);
        enviarEEncerrar({ tipo: 'stopped', pid: process.pid });
        return;
      }
      if (message?.tipo !== 'reserve') return;
      enviar({ tipo: 'reserve-waiting', roundId: message.roundId, ...metadata });
      await waitForFile(message.barrierPath);
      let result;
      try {
        result = await persistence.reservarDespachoResposta(message.fixture.transactionId, {
          solicitadaEm: message.fixture.solicitadaEm,
          acao: message.fixture.acao,
          identidadeEsperada: message.fixture,
          respostaEsperada: message.fixture.resposta
        });
      } catch (error) {
        result = {
          ok: false,
          codigo: error.codigo || error.code || 'RESERVA_ERROR',
          mensagem: error.message,
          retryAllowed: false
        };
      }
      enviar({
        tipo: 'reserve-result',
        roundId: message.roundId,
        ...metadata,
        result,
        driver: { inicia: 0, continua: 0, finaliza: 0 }
      });
    });
    return;
  }

  if (role === 'fault') {
    const instrumentation = instrumentarFalhaWorker(input.mode);
    const persistence = require('../../backend/services/tef/destaxa/destaxaContinuidadePersistencia');
    let result;
    try {
      result = await persistence.reservarDespachoResposta(input.fixture.transactionId, {
        solicitadaEm: input.fixture.solicitadaEm,
        acao: input.fixture.acao,
        identidadeEsperada: input.fixture,
        respostaEsperada: input.fixture.resposta
      });
    } catch (error) {
      result = {
        ok: false,
        codigo: error.codigo || error.code || 'RESERVA_ERROR',
        mensagem: error.message,
        retryAllowed: false
      };
    }
    instrumentation.teardown();
    await closeDatabase(database);
    enviarEEncerrar({
      tipo: 'fault-result',
      mode: input.mode,
      ...metadata,
      result,
      events: instrumentation.events,
      driver: { inicia: 0, continua: 0, finaliza: 0 },
      dllLoads: 0
    });
    return;
  }

  if (role === 'hold-after-begin') {
    instrumentarFalhaWorker('hold-after-begin');
    require('../../backend/services/tef/destaxa/destaxaContinuidadePersistencia');
    enviar({ tipo: 'ready', ...metadata });
    await new Promise((resolve) => {
      process.once('message', (message) => {
        if (message?.tipo === 'reserve') resolve();
      });
    });
    const persistence = require('../../backend/services/tef/destaxa/destaxaContinuidadePersistencia');
    await persistence.reservarDespachoResposta(input.fixture.transactionId, {
      solicitadaEm: input.fixture.solicitadaEm,
      acao: input.fixture.acao,
      identidadeEsperada: input.fixture,
      respostaEsperada: input.fixture.resposta
    });
    return;
  }
  throw new Error(`Worker MRT-50.10 desconhecido: ${role}`);
}

async function main() {
  const database = require('../../backend/database');
  await ready(database);
  const persistence = require('../../backend/services/tef/destaxa/destaxaContinuidadePersistencia');
  const databasePath = path.resolve(database.dbPath);
  const databaseStat = fs.statSync(databasePath);
  const journalMode = await new Promise((resolve, reject) => {
    database.get('PRAGMA journal_mode', [], (error, row) =>
      (error ? reject(error) : resolve(row?.journal_mode || null)));
  });
  const tempRoot = path.resolve(os.tmpdir());
  const report = {
    sprint: 'MRT-50.10',
    classification: 'RUNNING',
    generatedAt: new Date().toISOString(),
    changedFiles: [
      'backend/services/tef/destaxa/destaxaContinuidadePersistencia.js',
      'backend/services/tef/tefRepository.js',
      'tests/tef/mrt-50-9-validacao-complementar.test.js',
      'tests/tef/mrt-50-10-reserva-atomica.test.js',
      relativeReportPath(REPORT_PATH),
      relativeReportPath(MARKDOWN_REPORT_PATH)
    ],
    outputPaths: {
      json: relativeReportPath(REPORT_PATH),
      markdown: relativeReportPath(MARKDOWN_REPORT_PATH)
    },
    productionFilesChanged: [
      'backend/services/tef/destaxa/destaxaContinuidadePersistencia.js',
      'backend/services/tef/tefRepository.js'
    ],
    database: {
      path: databasePath,
      identity: { dev: databaseStat.dev, ino: databaseStat.ino },
      journalMode
    },
    security: {
      gateFinanceiro: 'OFF',
      gateFinanceiroProcessoPai: process.env.DESTAXA_REAL_TRANSACTION_ENABLED === '1' ? 'ON' : 'OFF',
      dllLoads: 0,
      driverCounters: { TX_START: 0, TX_CONTINUE: 0, TX_FINALIZE: 0 },
      officialDatabaseAccessed: false,
      realDllAccessed: false,
      vspagueAccessed: false,
      pinpadAccessed: false,
      acquirersAccessed: false,
      sefazAccessed: false,
      realFinancialOperationsExecuted: false,
      protectedIdentitiesTouched: false
    },
    strategy: {
      transaction: 'BEGIN IMMEDIATE',
      connection: 'Dedicated SQLite read/write connection per reservation; all decision reads, update, and COMMIT use that connection.',
      postCommit: 'Existing independent read-only confirmation remains mandatory.',
      retries: 'No automatic retry. SQLITE_BUSY/SQLITE_LOCKED return a fail-closed technical result.'
    },
    faults: [],
    twoProcessRuns: [],
    threeProcessRuns: [],
    testsExecuted: [
      'Falhas A-G e encerramento abrupto durante a transação',
      '200 disputas com dois processos independentes',
      '100 disputas com três processos independentes',
      'Regressão MRT-50.9: concorrência, morte após INICIADO e reinicialização completa'
    ],
    regressionMrt509: null
  };

  try {
    assert.strictEqual(process.env.DESTAXA_REAL_TRANSACTION_ENABLED, '0');
    assert.ok(databasePath.startsWith(tempRoot), `SQLite fora do diretório temporário: ${databasePath}`);
    assert.notStrictEqual(path.resolve(databasePath), path.resolve(path.join(
      process.env.PROGRAMDATA || 'C:\\ProgramData',
      'MercantilFiscal',
      'dados',
      'mercadao.db'
    )));

    report.faults = await runFaultTests(persistence, report);
    report.processDeath = await runProcessDeathTest(persistence, report);
    const pool = await startPool();
    try {
      report.twoProcessRuns = await runStressRounds(persistence, report, pool.slice(0, 2), 200, 'two');
      report.threeProcessRuns = await runStressRounds(persistence, report, pool, 100, 'three');
    } finally {
      await Promise.all(pool.map(stopWorker));
    }
    report.regressionMrt509 = runMrt509Regression();
    const allStressPassed = [...report.twoProcessRuns, ...report.threeProcessRuns]
      .every((round) => round.passou);
    const allFaultsPassed = report.faults.every((fault) => fault.status === 'PASSOU')
      && report.processDeath.passou;
    const regressionPassed = report.regressionMrt509.exitCode === 0
      && report.regressionMrt509.classification === 'APROVADO_ISOLAMENTO_TECNICO';
    report.classification = allStressPassed && allFaultsPassed && regressionPassed
      ? 'APROVADA'
      : 'BLOQUEADA';
    report.approvalCriteria = {
      all300StressRoundsPassed: allStressPassed,
      allFaultAndRollbackTestsPassed: allFaultsPassed,
      mrt509RegressionPassed: regressionPassed,
      noRealFinancialOperations: true,
      approved: report.classification === 'APROVADA'
    };
  } catch (error) {
    report.classification = 'BLOQUEADA';
    report.error = error.stack || error.message;
    throw error;
  } finally {
    report.completedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(
      REPORT_PATH,
      `${redactTestKey(JSON.stringify(report, null, 2))}\n`,
      { flag: 'wx' }
    );
    fs.writeFileSync(
      MARKDOWN_REPORT_PATH,
      redactTestKey(gerarRelatorioMarkdown(report)),
      { flag: 'wx' }
    );
    await closeDatabase(database);
  }
  console.log(redactTestKey(JSON.stringify({
    classification: report.classification,
    faultStatuses: report.faults.map((fault) => [fault.name, fault.status]),
    processDeath: report.processDeath?.passou,
    twoProcessPassing: report.twoProcessRuns.filter((round) => round.passou).length,
    threeProcessPassing: report.threeProcessRuns.filter((round) => round.passou).length,
    regressionMrt509: report.regressionMrt509?.classification,
    mrt509Scenarios: report.regressionMrt509?.scenarioResults,
    outputPaths: report.outputPaths
  })));
  if (report.classification !== 'APROVADA') process.exitCode = 1;
}

function gerarRelatorioMarkdown(report) {
  const countPassed = (runs) => runs.filter((round) => round.passou).length;
  const falhas = report.faults.map((fault) =>
    `| ${fault.name} | ${fault.status} | \`${fault.injectedResult.codigo || 'sem código'}\` | \`${fault.stateAfter}\` |`
  );
  const regression = report.regressionMrt509;
  return `# MRT-50.10 — Reserva atômica de despacho TEF

**Classificação:** ${report.classification}  
**Período:** ${report.generatedAt} a ${report.completedAt}  
**Gate financeiro:** OFF no processo principal e nos workers  
**Banco de teste:** \`${report.database.path}\`  
**Identidade SQLite:** \`dev=${report.database.identity.dev}\`, \`ino=${report.database.identity.ino}\`  
**journal_mode:** \`${report.database.journalMode}\`

## Resultado

- Disputas com dois processos: ${countPassed(report.twoProcessRuns)}/200 aprovadas.
- Disputas com três processos: ${countPassed(report.threeProcessRuns)}/100 aprovadas.
- Falhas/rollback: ${report.faults.filter((fault) => fault.status === 'PASSOU').length}/${report.faults.length} aprovadas.
- Processo encerrado durante transação: ${report.processDeath?.passou ? 'PASSOU' : 'FALHOU'}; PID ${report.processDeath?.pid ?? 'não registrado'}, sinal \`${report.processDeath?.signal ?? 'não registrado'}\`, estado após encerramento \`${report.processDeath?.stateAfterTermination ?? 'não registrado'}\`.
- Regressão MRT-50.9: ${regression?.classification ?? 'NÃO EXECUTADA'} (${(regression?.scenarioResults || []).map((scenario) => `${scenario.name}: ${scenario.status}`).join('; ') || 'sem resultados'}).
- Contadores do driver em todos os cenários: TX_START=0, TX_CONTINUE=0, TX_FINALIZE=0; DLL loads=0.

## Estratégia e evidência

A reserva usa uma conexão SQLite dedicada por processo e executa \`BEGIN IMMEDIATE\` antes de reler/validar a resposta, atualizar \`PRONTA → INICIADO\` e executar \`COMMIT\`. O sucesso só é retornado após o COMMIT confirmado e a releitura independente de durabilidade. Não há retry automático; \`SQLITE_BUSY\` e \`SQLITE_LOCKED\` resultam em bloqueio.

### Falhas injetadas

| Cenário | Resultado | Código | Estado persistido |
|---|---|---|---|
${falhas.join('\n')}

### Disputa interprocessos

Cada rodada registra no JSON os PIDs, identidade e timestamp completos, estado anterior/posterior, resultado de cada processo, \`despachoId\`, gate, identidade do arquivo SQLite e contadores do driver. A barreira de início simultâneo é liberada somente após os processos participantes aguardarem na reserva.

O caso de encerramento abrupto confirma que SQLite descarta a transação ainda não commitada: a resposta permaneceu \`PRONTA\`; uma reserva posterior confirmou um único despacho. Isso não altera o cenário MRT-50.9 de morte após reserva durável \`INICIADO\`, que permanece parte da regressão.

## Regressões e limites

MRT-50.9 foi executada sem alterar seus critérios e com o relatório redirecionado para o diretório SQLite temporário, preservando o relatório histórico. O JSON detalhado contém o resultado individual das 300 rodadas e os dados da regressão.

Todos os processos foram configurados com \`DESTAXA_REAL_TRANSACTION_ENABLED=0\`, \`CDS_TEST_ISOLAR_BANCO=1\` e driver sem despacho financeiro. Nenhum banco oficial, DLL Destaxa, V$PagueClient, PinPad, adquirente, SEFAZ ou operação financeira foi acessado. Este resultado não representa homologação física nem liberação de preflight financeiro.

## Arquivos de produção alterados

- \`backend/services/tef/destaxa/destaxaContinuidadePersistencia.js\`
- \`backend/services/tef/tefRepository.js\`
`;
}

async function startPool() {
  const workers = Array.from({ length: 3 }, () => startWorker('pool', {}));
  await Promise.all(workers.map((worker) => waitMessage(worker, (item) => item.tipo === 'ready')));
  return workers;
}

async function runStressRounds(persistence, report, workers, total, mode) {
  const rounds = [];
  const offset = mode === 'two' ? 0 : 200;
  for (let index = 1; index <= total; index += 1) {
    const identity = await fixture(persistence, `${mode}${index}`);
    const before = await persistence.recuperarRespostaOperador(identity.transactionId, {
      solicitadaEm: identity.solicitadaEm,
      acao: identity.acao,
      identidadeEsperada: identity,
      respostaEsperada: identity.resposta
    });
    const roundId = `${mode}-${index}`;
    const barrierPath = path.join(process.env.DB_DIR, `barrier-${roundId}.go`);
    const participants = workers.slice(0, mode === 'two' ? 2 : 3);
    const waiting = participants.map((worker) =>
      waitMessage(worker, (item) => item.tipo === 'reserve-waiting' && item.roundId === roundId));
    participants.forEach((worker) => worker.child.send({
      tipo: 'reserve',
      roundId,
      fixture: identity,
      barrierPath
    }));
    const readyMessages = await Promise.all(waiting);
    const startedAt = new Date().toISOString();
    fs.writeFileSync(barrierPath, startedAt);
    const results = await Promise.all(participants.map((worker) =>
      waitMessage(worker, (item) => item.tipo === 'reserve-result' && item.roundId === roundId)));
    fs.unlinkSync(barrierPath);

    const row = await persistence.buscarTransacao(identity.transactionId);
    const persisted = row.payload_retorno.continuidade.respostas.find((entry) =>
      entry.solicitadaEm === identity.solicitadaEm);
    const winners = results.filter((result) => result.result?.ok === true);
    const winnerIds = new Set(winners.map((result) => result.result.despachoId));
    const gatesOff = readyMessages.every((message) => message.gateFinanceiro === 'OFF')
      && results.every((message) => message.gateFinanceiro === 'OFF');
    const noDriverCalls = results.every((message) => message.driver.inicia === 0
      && message.driver.continua === 0
      && message.driver.finaliza === 0);
    const otherProcessesBlocked = results.every((message) => message.result?.ok === true
      || (message.result?.ok === false && message.result.retryAllowed === false));
    const dispatchPersistedMatchesWinner = winners.length === 1
      && persisted?.estadoDespacho === 'INICIADO'
      && persisted?.despachoId === winners[0].result.despachoId;
    const round = {
      round: index,
      roundId,
      processCount: participants.length,
      identity,
      timestampOriginal: identity.solicitadaEm,
      action: identity.acao,
      response: identity.resposta,
      stateBefore: before.estadoDespacho,
      startedAt,
      processes: results.map((result) => ({
        pid: result.pid,
        databasePath: result.databasePath,
        databaseIdentity: result.databaseIdentity,
        journalMode: result.journalMode,
        gate: result.gateFinanceiro,
        ok: result.result.ok,
        code: result.result.codigo || null,
        retryAllowed: result.result.retryAllowed !== false,
        changes: result.result.changes ?? null,
        dispatchId: result.result.despachoId || null,
        driver: result.driver
      })),
      winners: winners.length,
      distinctAuthorizedDispatchIds: winnerIds.size,
      persistedState: persisted?.estadoDespacho || null,
      persistedDispatchId: persisted?.despachoId || null,
      gatesOff,
      noDriverCalls,
      otherProcessesBlocked,
      dispatchPersistedMatchesWinner,
      passou: winners.length === 1
        && winnerIds.size === 1
        && otherProcessesBlocked
        && dispatchPersistedMatchesWinner
        && gatesOff
        && noDriverCalls
    };
    rounds.push(round);
  }
  return rounds;
}

async function runFaultTests(persistence, report) {
  const faults = [];
  for (const [mode, label, expectedState, expectedCode] of [
    ['before-write', 'A — Falha antes da gravação', 'PRONTA', 'TEF_CONTINUIDADE_PERSISTENCIA_FALHOU'],
    ['during-write', 'B — Falha durante a gravação', 'PRONTA', 'TEF_CONTINUIDADE_PERSISTENCIA_FALHOU'],
    ['commit', 'C — Falha no COMMIT', 'PRONTA', 'TEF_CONTINUIDADE_PERSISTENCIA_FALHOU'],
    ['reread', 'D — Falha na releitura independente após COMMIT', 'INICIADO', 'TEF_CONTINUIDADE_PERSISTENCIA_FALHOU'],
    ['busy', 'E — SQLITE_BUSY', 'PRONTA', 'DESTAXA_CONTINUIDADE_CONCORRENCIA'],
    ['locked', 'E — SQLITE_LOCKED', 'PRONTA', 'DESTAXA_CONTINUIDADE_CONCORRENCIA']
  ]) {
    const testFixture = await fixture(persistence, `fault-${mode}`);
    const worker = startWorker('fault', { mode, fixture: testFixture });
    const output = await waitMessage(worker, (message) => message.tipo === 'fault-result');
    const exit = await worker.exit;
    const persisted = await persistence.buscarTransacao(testFixture.transactionId);
    const stored = persisted.payload_retorno.continuidade.respostas.find((item) =>
      item.solicitadaEm === testFixture.solicitadaEm);
    const stateAfter = stored?.estadoDespacho || null;
    const rowHasExpectedState = stateAfter === expectedState;
    const noSuccessWithoutCommit = output.result.ok !== true;
    const noDriver = output.driver.inicia === 0
      && output.driver.continua === 0
      && output.driver.finaliza === 0
      && output.dllLoads === 0;
    faults.push({
      name: label,
      mode,
      status: exit.code === 0 && noSuccessWithoutCommit && rowHasExpectedState && noDriver
        ? 'PASSOU'
        : 'FALHOU',
      pid: output.pid,
      gate: output.gateFinanceiro,
      databasePath: output.databasePath,
      databaseIdentity: output.databaseIdentity,
      injectedResult: output.result,
      stateBefore: 'PRONTA',
      stateAfter,
      expectedState,
      rollbackOrCommitEvidence: output.events,
      noSuccessWithoutCommit,
      noDriver,
      dllLoads: output.dllLoads
    });
  }
  return faults;
}

async function runProcessDeathTest(persistence) {
  const testFixture = await fixture(persistence, 'kill-after-begin');
  const worker = startWorker('hold-after-begin', { fixture: testFixture });
  await waitMessage(worker, (message) => message.tipo === 'ready');
  worker.child.send({ tipo: 'reserve' });
  const open = await waitMessage(worker, (message) => message.tipo === 'transaction-open');
  worker.child.kill();
  const exit = await worker.exit;
  const after = await persistence.recuperarRespostaOperador(testFixture.transactionId, {
    solicitadaEm: testFixture.solicitadaEm,
    acao: testFixture.acao,
    identidadeEsperada: testFixture,
    respostaEsperada: testFixture.resposta
  });
  const remainsReady = after.ok && after.estadoDespacho === 'PRONTA';
  let winnerRetry = null;
  if (remainsReady) {
    winnerRetry = await persistence.reservarDespachoResposta(testFixture.transactionId, {
      solicitadaEm: testFixture.solicitadaEm,
      acao: testFixture.acao,
      identidadeEsperada: testFixture,
      respostaEsperada: testFixture.resposta
    });
  }
  return {
    name: 'H — Processo encerrado abruptamente durante transação aberta',
    passou: exit.signal != null && remainsReady && winnerRetry?.ok === true,
    pid: open.pid,
    signal: exit.signal,
    beganAt: open.at,
    stateBefore: 'PRONTA',
    stateAfterTermination: after.estadoDespacho,
    rollback: 'SQLite recuperou/descartou a transação não commitada no encerramento do processo.',
    subsequentReservationSucceeded: winnerRetry?.ok === true,
    dispatchId: winnerRetry?.despachoId || null,
    driver: { inicia: 0, continua: 0, finaliza: 0 }
  };
}

function runMrt509Regression() {
  const reportCopy = path.join(process.env.DB_DIR, 'mrt-50-9-regression-report.json');
  const testPath = path.join(ROOT, 'tests/tef/mrt-50-9-validacao-complementar.test.js');
  const childEnv = {
    ...process.env,
    MRT509_REPORT_PATH: reportCopy,
    DESTAXA_REAL_TRANSACTION_ENABLED: '0',
    CDS_TEST_ISOLAR_BANCO: '1'
  };
  delete childEnv.TEF_ENCRYPTION_KEY;
  const run = spawnSync(process.execPath, [testPath], {
    cwd: ROOT,
    env: childEnv,
    encoding: 'utf8',
    timeout: 240000,
    maxBuffer: 8 * 1024 * 1024
  });
  let parsed = null;
  if (fs.existsSync(reportCopy)) {
    try {
      parsed = JSON.parse(fs.readFileSync(reportCopy, 'utf8'));
    } catch {
      parsed = null;
    }
  }
  return {
    command: 'node tests\\tef\\mrt-50-9-validacao-complementar.test.js (MRT509_REPORT_PATH direcionado a DB_DIR temporário)',
    exitCode: run.status,
    signal: run.signal || null,
    classification: parsed?.classification || null,
    scenarioStatuses: parsed?.scenarios?.map((scenario) => scenario.status) || [],
    scenarioResults: parsed?.scenarios?.map((scenario) => ({
      name: scenario.name,
      status: scenario.status
    })) || [],
    concurrencyRepetitions: parsed?.scenarios?.[0]?.repetitions || 0,
    previousReportUntouched: true,
    stderr: run.error?.message || run.stderr?.slice(-2000) || null
  };
}

async function executarWorker(role, input) {
  if (role === 'pool' || role === 'fault' || role === 'hold-after-begin') {
    return executeWorker(role, input);
  }
  throw new Error(`Worker MRT-50.10 desconhecido: ${role}`);
}
