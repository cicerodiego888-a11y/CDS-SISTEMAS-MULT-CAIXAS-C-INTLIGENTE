'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const ACTION = Object.freeze({
  tipo: 'OPCAO',
  mensagem: 'Tipo do Cartao',
  opcoes: ['Credito', 'Debito', 'Voucher'],
  tipoDado: 'X',
  timeout: '120',
  chave: 'transacao_tipo_cartao'
});
const REPORT_PATH = process.env.MRT509_REPORT_PATH
  || path.join(ROOT, 'docs/build/mrt-50-9-validacao-complementar-report.json');
const WORKER_ROLE = process.argv[2] === '--mrt509-worker' ? process.argv[3] : null;
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
    process.exitCode = 1;
    enviarEEncerrar({
      tipo: 'worker-error',
      erro: redactTestKey(error.stack || error.message)
    });
  });
} else {
  process.env.CDS_TEST_ISOLAR_BANCO = '1';
  process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
  delete process.env.TEF_ENCRYPTION_KEY;
  process.env.TEF_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  process.env.DB_DIR = path.join(
    os.tmpdir(),
    `cds-mrt-50-9-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  );
  executarSuite().catch((error) => {
    console.error(redactTestKey(error.stack || error.message));
    process.exitCode = 1;
  }).finally(() => {
    delete process.env.TEF_ENCRYPTION_KEY;
  });
}

function enviar(mensagem) {
  if (typeof process.send === 'function' && process.connected) process.send(mensagem);
}

function enviarEEncerrar(mensagem) {
  if (typeof process.send === 'function' && process.connected) {
    process.send(mensagem, () => process.exit(process.exitCode || 0));
  } else {
    process.exit(process.exitCode || 0);
  }
}

function aguardarReady(database) {
  return new Promise((resolve, reject) => {
    database.whenReady((error) => (error ? reject(error) : resolve()));
  });
}

function fecharBanco(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => (error ? reject(error) : resolve()));
  });
}

async function aguardarArquivo(caminho) {
  const limite = Date.now() + 30000;
  while (Date.now() < limite) {
    if (fs.existsSync(caminho)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timeout aguardando barreira de concorrência');
}

async function criarFixture(persistencia, sufixo) {
  const token = `${sufixo}_${crypto.randomBytes(5).toString('hex')}`;
  const idempotencyKey = `mrt40_mrt509_${token}`;
  const operationId = `op_mrt509_${token}`;
  const fingerprint = crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
  const timestamp = new Date().toISOString();
  const row = await persistencia.criarTransacaoContinuidadeTeste({
    idempotencyKey,
    operationId,
    fingerprint
  });
  const fixture = {
    transactionId: String(row.id),
    idempotency_key: idempotencyKey,
    operation_id: operationId,
    fingerprint,
    solicitadaEm: timestamp,
    acao: ACTION
  };
  const requested = await persistencia.registrarSolicitacao99(row.id, {
    acao: ACTION,
    solicitadaEm: timestamp
  });
  assert.strictEqual(requested.ok, true, requested.mensagem);
  assert.strictEqual(requested.duravel, true);
  assert.strictEqual(requested.confirmada, true);
  return fixture;
}

async function persistirResposta(persistencia, fixture) {
  const stored = await persistencia.registrarRespostaOperador(fixture.transactionId, {
    resposta: 'Credito',
    incrementarContinue: true,
    exigirSolicitacao: true,
    acao: fixture.acao,
    solicitadaEm: fixture.solicitadaEm,
    identidadeEsperada: fixture
  });
  assert.strictEqual(stored.ok, true, stored.mensagem);
  assert.strictEqual(stored.estadoDespacho, 'PRONTA');
  return { ...stored, confirmedAt: new Date().toISOString() };
}

function iniciarWorker(role, input) {
  const child = fork(__filename, [
    '--mrt509-worker',
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
  let stdout = '';
  let stderr = '';
  const messages = [];
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('message', (message) => messages.push(message));
  const exit = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal, stdout, stderr, messages }));
  });
  return {
    child,
    messages,
    exit,
    async waitFor(type) {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const found = messages.find((message) => message.tipo === type);
        if (found) return found;
        if (messages.some((message) => message.tipo === 'worker-error')) {
          throw new Error(JSON.stringify(messages.find((message) => message.tipo === 'worker-error')));
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Timeout aguardando ${type}; stderr=${stderr}; stdout=${stdout}`);
    }
  };
}

function instrumentarAtualizacoes(repository) {
  const original = repository.atualizarTransacao;
  return {
    restore() {
      repository.atualizarTransacao = original;
    },
    changes: [],
    instalar(registro) {
      repository.atualizarTransacao = function atualizarInstrumentado(id, dados, callback, condicoes) {
        return original.call(this, id, dados, function callbackInstrumentado(error, resultado) {
          if (String(id) === String(registro.transactionId)) {
            registro.changes.push(resultado?.changes ?? null);
          }
          callback(error, resultado);
        }, condicoes);
      };
    }
  };
}

async function executarWorker(role, input) {
  const database = require('../../backend/database');
  await aguardarReady(database);
  const databasePath = path.resolve(database.dbPath);
  const stat = fs.statSync(databasePath);
  const base = {
    pid: process.pid,
    databasePath,
    databaseIdentity: { dev: stat.dev, ino: stat.ino },
    gateFinanceiro: process.env.DESTAXA_REAL_TRANSACTION_ENABLED === '1' ? 'ON' : 'OFF'
  };

  if (role === 'reserve') {
    const persistence = require('../../backend/services/tef/destaxa/destaxaContinuidadePersistencia');
    const repository = require('../../backend/services/tef/tefRepository');
    const audit = { transactionId: input.fixture.transactionId, changes: [] };
    const instrument = instrumentarAtualizacoes(repository);
    instrument.instalar(audit);
    enviar({ tipo: 'ready', ...base });
    await aguardarArquivo(input.barrierPath);
    let result;
    try {
      result = await persistence.reservarDespachoResposta(input.fixture.transactionId, {
        solicitadaEm: input.fixture.solicitadaEm,
        acao: input.fixture.acao,
        identidadeEsperada: input.fixture,
        respostaEsperada: 'Credito'
      });
    } catch (error) {
      result = {
        ok: false,
        codigo: error.codigo || error.code || 'RESERVA_ERRO_TECNICO',
        mensagem: error.message,
        changes: audit.changes
      };
    }
    instrument.restore();
    await fecharBanco(database);
    enviarEEncerrar({
      tipo: 'result',
      ...base,
      result: {
        ok: result?.ok === true,
        codigo: result?.codigo || null,
        despachoId: result?.despachoId || null,
        state: result?.ok ? 'INICIADO' : 'BLOQUEADO',
        changes: audit.changes,
        driver: { inicia: 0, continua: 0, finaliza: 0 }
      }
    });
    return;
  }

  if (role === 'crash-reserve') {
    const persistence = require('../../backend/services/tef/destaxa/destaxaContinuidadePersistencia');
    const result = await persistence.reservarDespachoResposta(input.fixture.transactionId, {
      solicitadaEm: input.fixture.solicitadaEm,
      acao: input.fixture.acao,
      identidadeEsperada: input.fixture,
      respostaEsperada: 'Credito'
    });
    if (!result?.ok || result.confirmada !== true || result.duravel !== true) {
      throw new Error(`Reserva não confirmada: ${JSON.stringify(result)}`);
    }
    const event = {
      tipo: 'reserved-confirmed',
      at: new Date().toISOString(),
      ...base,
      despachoId: result.despachoId,
      state: 'INICIADO',
      driver: { inicia: 0, continua: 0, finaliza: 0 }
    };
    await fecharBanco(database);
    enviarEEncerrar(event);
    return;
  }

  if (role === 'recover-iniciado') {
    const persistence = require('../../backend/services/tef/destaxa/destaxaContinuidadePersistencia');
    const recovered = await persistence.recuperarRespostaOperador(input.fixture.transactionId, {
      solicitadaEm: input.fixture.solicitadaEm,
      acao: input.fixture.acao,
      identidadeEsperada: input.fixture,
      respostaEsperada: 'Credito'
    });
    const retry = await persistence.reservarDespachoResposta(input.fixture.transactionId, {
      solicitadaEm: input.fixture.solicitadaEm,
      acao: input.fixture.acao,
      identidadeEsperada: input.fixture,
      respostaEsperada: 'Credito'
    });
    const row = await persistence.buscarTransacao(input.fixture.transactionId);
    const response = {
      tipo: 'result',
      ...base,
      recovered: {
        ok: recovered?.ok === true,
        state: recovered?.estadoDespacho || null,
        despachoId: recovered?.despachoId || null
      },
      retry: {
        ok: retry?.ok === true,
        codigo: retry?.codigo || null,
        despachoId: retry?.despachoId || null
      },
      persisted: {
        status: row?.status || null,
        financialState: row?.payload_retorno?.financialState || 'UNKNOWN',
        state: row?.payload_retorno?.continuidade?.respostas?.[0]?.estadoDespacho || null,
        despachoId: row?.payload_retorno?.continuidade?.respostas?.[0]?.despachoId || null
      },
      driver: { inicia: 0, continua: 0, finaliza: 0 }
    };
    await fecharBanco(database);
    enviarEEncerrar(response);
    return;
  }

  if (role === 'lifecycle-old' || role === 'lifecycle-new') {
    await executarWorkerLifecycle(database, role, input, base);
    return;
  }
  throw new Error(`Worker desconhecido: ${role}`);
}

async function executarWorkerLifecycle(database, role, input, base) {
  const nativeClientModule = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
  const { DestaxaNativeHostClient } = nativeClientModule;
  const hostEnvironment = nativeClientModule.criarAmbienteNativeHost(process.env, {
    DESTAXA_NATIVE_HOST_TEST_MODE: '1',
    DESTAXA_NATIVE_HOST_TRIPWIRE: '1'
  }, '');
  assert.strictEqual(hostEnvironment.TEF_ENCRYPTION_KEY, undefined);
  const client = new DestaxaNativeHostClient({
    env: {
      DESTAXA_NATIVE_HOST_TEST_MODE: '1',
      DESTAXA_NATIVE_HOST_TRIPWIRE: '1'
    },
    timeoutInicioMs: 5000,
    timeoutMs: 5000
  });
  nativeClientModule.obterClienteCompartilhado = () => client;
  nativeClientModule.clienteCompartilhadoExistente = () => client;

  const protocol = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
  const persistence = require('../../backend/services/tef/destaxa/destaxaContinuidadePersistencia');
  const { OPERACOES_HOST } = protocol;
  const { transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');
  assert.strictEqual(transacaoRealHabilitada(), false);

  if (role === 'lifecycle-new') {
    const bridgeModule = require('../../backend/services/tef/destaxa/DestaxaHostBridge');
    const bridge = new bridgeModule({ client });
    const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
    const adapter = new DestaxaRealAdapter({}, {
      bridge,
      executionMode: 'native-host',
      hostClient: client
    });
    const adapterCycle = require('../../backend/services/tef/tefAdapterCiclo');
    adapterCycle.obterAdapterDaTransacao = async () => ({
      adapter,
      provedor: 'destaxa',
      registro: { provedor: 'destaxa', ambiente: 'homologacao', id: null },
      terminalTefId: null,
      ambiente: 'homologacao',
      fonte: 'mrt50.9-nativehost-filho'
    });
  }

  const { TefManager } = require('../../backend/services/tef/TefManager');
  const manager = new TefManager({ nativeHostClient: client, recuperarNoInicio: false });
  await manager.garantirRecuperacao();
  assert.strictEqual(await client.iniciar(), true);
  const hostBefore = client.getEstado();
  const configured = await client.enviar(OPERACOES_HOST.CONFIGURE_MOCK, { passos: [] });
  assert.strictEqual(configured.output?.sucesso, true, JSON.stringify(configured));

  if (role === 'lifecycle-old') {
    const request = await manager._persistirSolicitacao99(
      input.fixture.transactionId,
      {
        acao: input.fixture.acao,
        solicitadaEm: input.fixture.solicitadaEm,
        codigoDestaxa: '99'
      },
      { idempotency_key: input.fixture.idempotency_key }
    );
    assert.strictEqual(request?.ok, true);
    const answer = await persistence.registrarRespostaOperador(input.fixture.transactionId, {
      resposta: 'Credito',
      incrementarContinue: true,
      exigirSolicitacao: true,
      acao: input.fixture.acao,
      solicitadaEm: input.fixture.solicitadaEm,
      identidadeEsperada: input.fixture
    });
    assert.strictEqual(answer.ok, true, answer.mensagem);
    assert.strictEqual(answer.estadoDespacho, 'PRONTA');
    const sessionAnchor = manager._continuidadeCrt?.sessaoHost || null;
    assert.ok(sessionAnchor?.pid != null);
    const event = {
      tipo: 'old-session-ready',
      at: new Date().toISOString(),
      ...base,
      managerPid: process.pid,
      nativeHostPid: hostBefore.pid,
      hostSessionId: hostBefore.hostSessionId,
      identity: input.fixture,
      timestampOriginal: input.fixture.solicitadaEm,
      persistedState: 'PRONTA',
      sessionAnchor,
      gateNativeHost: 'OFF'
    };
    await client.encerrar({ aguardarMs: 3000 });
    const afterClose = { at: new Date().toISOString(), event: 'old-manager-and-nativehost-closed' };
    await fecharBanco(database);
    enviar({ ...event, afterClose });
    process.exit(0);
    return;
  }

  const sessionValidation = manager._validarSessaoNativeHostContinuidade(
    manager._continuidadeCrt?.sessaoHost
  );
  const before = await persistence.buscarTransacao(input.fixture.transactionId);
  const result = await manager.continuarAutorizacao({
    transacao_id: input.fixture.transactionId,
    idempotency_key: input.fixture.idempotency_key,
    resposta_continuidade: 'Credito',
    solicitadaEm: input.fixture.solicitadaEm,
    acao: input.fixture.acao,
    persistenciaContinuidade: true,
    ambienteOperador: { tty: true }
  });
  const after = await persistence.buscarTransacao(input.fixture.transactionId);
  const statusResponse = await client.enviar(OPERACOES_HOST.STATUS);
  const hostCounters = statusResponse.output?.mockContadores || null;
  const response = {
    tipo: 'result',
    ...base,
    managerPid: process.pid,
    nativeHostPid: hostBefore.pid,
    hostSessionId: hostBefore.hostSessionId,
    gateNativeHost: process.env.DESTAXA_REAL_TRANSACTION_ENABLED === '1' ? 'ON' : 'OFF',
    sessionValidation,
    identity: input.fixture,
    timestampOriginal: input.fixture.solicitadaEm,
    timestampAfter: after?.payload_retorno?.continuidade?.solicitacao99?.solicitadaEm || null,
    stateBefore: before?.payload_retorno?.continuidade?.respostas?.[0]?.estadoDespacho || null,
    stateAfter: after?.payload_retorno?.continuidade?.respostas?.[0]?.estadoDespacho || null,
    financialState: after?.payload_retorno?.financialState || 'UNKNOWN',
    transactionStatus: after?.status || null,
    result: {
      success: result?.sucesso === true,
      code: result?.codigo || null,
      inconclusive: result?.inconclusivo === true,
      reconciliationRequired: result?.reconciliacaoObrigatoria === true,
      retryAllowed: result?.retryAllowed !== false
    },
    hostSecurityState: statusResponse.output?.securityBootstrapState || null,
    blockedFinancialIdentities: statusResponse.output?.blockedFinancialIdentities || [],
    hostCounters,
    driver: {
      inicia: hostCounters?.iniciaTransacaoDestaxa || 0,
      continua: hostCounters?.continuaTransacaoDestaxa || 0,
      finaliza: hostCounters?.finalizaTransacaoDestaxa || 0,
      dllLoads: statusResponse.output?.contadores?.dllLoads ?? null
    }
  };
  await client.encerrar({ aguardarMs: 3000 });
  await fecharBanco(database);
  enviarEEncerrar(response);
}

async function executarSuite() {
  const database = require('../../backend/database');
  await aguardarReady(database);
  const persistence = require('../../backend/services/tef/destaxa/destaxaContinuidadePersistencia');
  const databasePath = path.resolve(database.dbPath);
  const stat = fs.statSync(databasePath);
  const pragma = await new Promise((resolve, reject) => {
    database.get('PRAGMA journal_mode', [], (error, row) => (error ? reject(error) : resolve(row)));
  });
  const dbIdentity = { dev: stat.dev, ino: stat.ino };
  const report = {
    sprint: 'MRT-50.9',
    generatedAt: new Date().toISOString(),
    classification: 'TESTADO',
    database: { path: databasePath, identity: dbIdentity, journalMode: pragma?.journal_mode || null },
    gateFinancial: 'OFF',
    scenarios: [],
    changedFiles: [
      'tests/tef/mrt-50-9-validacao-complementar.test.js',
      path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/'),
      'docs/build/MRT-50.9-VALIDACAO-COMPLEMENTAR.md'
    ],
    restrictions: {
      officialDatabaseAccessed: false,
      realDllAccessed: false,
      vspagueOrPinpadAccessed: false,
      sefazAccessed: false,
      realFinancialOperationsExecuted: false,
      gateFinancialInParentAndChildren: 'OFF'
    }
  };

  try {
    assert.strictEqual(process.env.DESTAXA_REAL_TRANSACTION_ENABLED, '0');
    report.scenarios.push(await executarCenario(
      'Concorrência simultânea da reserva de resposta',
      () => testarConcorrencia(persistence, report, dbIdentity)
    ));
    report.scenarios.push(await executarCenario(
      'Morte imediatamente após reserva durável INICIADO',
      () => testarMorteAposIniciado(persistence, report, dbIdentity)
    ));
    report.scenarios.push(await executarCenario(
      'Reinicialização de TefManager e NativeHost',
      () => testarReinicializacao(persistence, report, dbIdentity)
    ));
    report.classification = report.scenarios.every((scenario) => scenario.status === 'PASSOU')
      ? 'APROVADO_ISOLAMENTO_TECNICO'
      : 'FALHOU';
  } catch (error) {
    report.classification = 'FALHOU';
    report.error = error.stack || error.message;
    throw error;
  } finally {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${redactTestKey(JSON.stringify(report, null, 2))}\n`);
    await fecharBanco(database);
  }
  console.log(redactTestKey(JSON.stringify({
    classification: report.classification,
    scenarios: report.scenarios
  })));
  if (report.classification !== 'APROVADO_ISOLAMENTO_TECNICO') process.exitCode = 1;
}

async function executarCenario(name, run) {
  try {
    return await run();
  } catch (error) {
    return {
      name,
      status: 'FALHOU',
      error: error.stack || error.message
    };
  }
}

async function testarConcorrencia(persistence, report, dbIdentity) {
  const rounds = [];
  for (let round = 1; round <= 20; round += 1) {
    const fixture = await criarFixture(persistence, `race${round}`);
    await persistirResposta(persistence, fixture);
    const stateBefore = await persistence.recuperarRespostaOperador(fixture.transactionId, {
      solicitadaEm: fixture.solicitadaEm,
      acao: fixture.acao,
      identidadeEsperada: fixture,
      respostaEsperada: 'Credito'
    });
    const barrierPath = path.join(process.env.DB_DIR, `race-${round}.go`);
    const workers = [];
    const ready = [];
    for (let workerIndex = 0; workerIndex < 2; workerIndex += 1) {
      const worker = iniciarWorker('reserve', { fixture, barrierPath });
      workers.push(worker);
      ready.push(await worker.waitFor('ready'));
    }
    const startAt = new Date().toISOString();
    fs.writeFileSync(barrierPath, startAt);
    const exits = await Promise.all(workers.map((worker) => worker.exit));
    const results = workers.map((worker, index) => {
      const message = worker.messages.find((item) => item.tipo === 'result');
      const workerError = worker.messages.find((item) => item.tipo === 'worker-error');
      return {
        ...(message || {}),
        pid: message?.pid || ready[index].pid,
        gateFinanceiro: message?.gateFinanceiro || ready[index].gateFinanceiro,
        workerError: workerError?.erro || null,
        processExitCode: exits[index].code,
        capturedOutput: exits[index].stderr || exits[index].stdout || null,
        result: message?.result || {
          ok: false,
          codigo: workerError?.erro ? 'WORKER_ERROR' : 'RESULTADO_AUSENTE',
          changes: [],
          driver: { inicia: 0, continua: 0, finaliza: 0 }
        }
      };
    });
    const winners = results.filter((item) => item.result.ok);
    const after = await persistence.recuperarRespostaOperador(fixture.transactionId, {
      solicitadaEm: fixture.solicitadaEm,
      acao: fixture.acao,
      identidadeEsperada: fixture,
      respostaEsperada: 'Credito'
    });
    const persisted = await persistence.buscarTransacao(fixture.transactionId);
    const record = persisted.payload_retorno.continuidade.respostas.find((entry) =>
      entry.solicitadaEm === fixture.solicitadaEm);
    const roundResult = {
      round,
      identity: fixture,
      timestampOriginal: fixture.solicitadaEm,
      stateBefore: stateBefore.estadoDespacho,
      startAt,
      workers: results.map((item) => ({
        pid: item.pid,
        processExitCode: item.processExitCode,
        gate: item.gateFinanceiro,
        ok: item.result.ok,
        code: item.result.codigo,
        dispatchId: item.result.despachoId,
        state: item.result.state,
        changes: item.result.changes,
        driver: item.result.driver,
        workerError: item.workerError,
        capturedOutput: item.capturedOutput
      })),
      successfulReservations: winners.length,
      distinctDispatchIds: new Set(winners.map((winner) => winner.result.despachoId)).size,
      persistedState: record?.estadoDespacho || null,
      persistedDispatchId: record?.despachoId || null,
      postReservationRecoverableAsReady: after?.estadoDespacho === 'PRONTA',
      databaseIdentity: dbIdentity
    };
    roundResult.gatesOff = ready.every((item) => item.gateFinanceiro === 'OFF')
      && results.every((item) => item.gateFinanceiro === 'OFF');
    roundResult.noDriverCalls = results.every((item) =>
      item.result.driver.inicia === 0
      && item.result.driver.continua === 0
      && item.result.driver.finaliza === 0);
    roundResult.passou = winners.length === 1
      && roundResult.distinctDispatchIds === 1
      && roundResult.persistedState === 'INICIADO'
      && roundResult.persistedDispatchId === winners[0]?.result.despachoId
      && results.every((item) => item.processExitCode === 0)
      && results.every((item) => !item.workerError)
      && roundResult.gatesOff
      && roundResult.noDriverCalls;
    rounds.push(roundResult);
  }
  const allPassed = rounds.every((round) => round.passou);
  return {
    name: 'Concorrência simultânea da reserva de resposta',
    status: allPassed ? 'PASSOU' : 'FALHOU',
    repetitions: rounds.length,
    criteria: {
      exactlyOneReservationPerRound: rounds.every((round) => round.successfulReservations === 1),
      noDuplicateDispatchIds: rounds.every((round) => round.distinctDispatchIds === 1),
      persistedIniciadoMatchesWinner: rounds.every((round) =>
        round.persistedState === 'INICIADO'
        && round.persistedDispatchId === round.workers.find((worker) => worker.ok)?.dispatchId),
      noDriverCalls: rounds.every((round) => round.workers.every((worker) =>
        worker.driver.inicia === 0 && worker.driver.continua === 0 && worker.driver.finaliza === 0)),
      gatesOff: rounds.every((round) => round.gatesOff)
    },
    failingRounds: rounds.filter((round) => !round.passou).map((round) => round.round),
    rounds
  };
}

async function testarMorteAposIniciado(persistence, report, dbIdentity) {
  const fixture = await criarFixture(persistence, 'crash');
  const response = await persistirResposta(persistence, fixture);
  const before = await persistence.recuperarRespostaOperador(fixture.transactionId, {
    solicitadaEm: fixture.solicitadaEm,
    acao: fixture.acao,
    identidadeEsperada: fixture,
    respostaEsperada: 'Credito'
  });
  const reserveWorker = iniciarWorker('crash-reserve', { fixture });
  const confirmed = await reserveWorker.waitFor('reserved-confirmed');
  const reserveExit = await reserveWorker.exit;
  assert.strictEqual(reserveExit.code, 0, reserveExit.stderr || reserveExit.stdout);
  const parentObservedExit = { at: new Date().toISOString(), event: 'reserve-process-exited' };
  const recoveryWorker = iniciarWorker('recover-iniciado', { fixture });
  const recovery = await recoveryWorker.waitFor('result');
  const recoveryExit = await recoveryWorker.exit;
  assert.strictEqual(recoveryExit.code, 0, recoveryExit.stderr || recoveryExit.stdout);
  assert.strictEqual(confirmed.state, 'INICIADO');
  assert.strictEqual(recovery.recovered.ok, true);
  assert.strictEqual(recovery.recovered.state, 'INICIADO');
  assert.strictEqual(recovery.retry.ok, false);
  assert.ok(recovery.retry.codigo);
  assert.strictEqual(recovery.persisted.status, 'pendente');
  assert.strictEqual(recovery.persisted.financialState, 'UNKNOWN');
  assert.strictEqual(recovery.persisted.state, 'INICIADO');
  assert.deepStrictEqual(recovery.driver, { inicia: 0, continua: 0, finaliza: 0 });
  return {
    name: 'Morte imediatamente após reserva durável INICIADO',
    status: 'PASSOU',
    identity: fixture,
    timestampOriginal: fixture.solicitadaEm,
    stateBefore: before.estadoDespacho,
    chronology: [
      { at: response.confirmedAt, event: 'test-fixture-response-PRONTA' },
      { at: confirmed.at, event: 'durable-reservation-confirmed-INICIADO', pid: confirmed.pid, despachoId: confirmed.despachoId },
      parentObservedExit,
      { at: new Date().toISOString(), event: 'independent-process-recovery-started', pid: recovery.pid },
      { at: new Date().toISOString(), event: 'recovery-found-INICIADO-and-refused-replay', code: recovery.retry.codigo }
    ],
    reserveProcess: {
      pid: confirmed.pid,
      databasePath: confirmed.databasePath,
      databaseIdentity: confirmed.databaseIdentity,
      gate: confirmed.gateFinanceiro,
      dispatchId: confirmed.despachoId,
      state: confirmed.state,
      driver: confirmed.driver
    },
    recoveryProcess: {
      pid: recovery.pid,
      databasePath: recovery.databasePath,
      databaseIdentity: recovery.databaseIdentity,
      gate: recovery.gateFinanceiro,
      recovered: recovery.recovered,
      retry: recovery.retry,
      persisted: recovery.persisted,
      driver: recovery.driver
    },
    databaseIdentity: dbIdentity,
    criteria: {
      reservationNotReused: recovery.retry.ok === false,
      noFinancialOutcomeInferred: recovery.persisted.financialState === 'UNKNOWN',
      pendingIdentityPreserved: recovery.persisted.status === 'pendente',
      noAutomaticRetry: recovery.retry.ok === false,
      noDriverCalls: recovery.driver.inicia === 0 && recovery.driver.continua === 0 && recovery.driver.finaliza === 0
    }
  };
}

async function testarReinicializacao(persistence, report, dbIdentity) {
  const fixture = await criarFixture(persistence, 'restart');
  const oldWorker = iniciarWorker('lifecycle-old', { fixture });
  const old = await oldWorker.waitFor('old-session-ready');
  const oldExit = await oldWorker.exit;
  assert.strictEqual(oldExit.code, 0, oldExit.stderr || oldExit.stdout);

  const newWorker = iniciarWorker('lifecycle-new', { fixture });
  const current = await newWorker.waitFor('result');
  const newExit = await newWorker.exit;
  assert.strictEqual(newExit.code, 0, newExit.stderr || newExit.stdout);
  const criteria = {
    identityRecovered: current.identity.transactionId === fixture.transactionId
      && current.identity.idempotency_key === fixture.idempotency_key
      && current.identity.fingerprint === fixture.fingerprint,
    originalTimestampPreserved: current.timestampAfter === fixture.solicitadaEm,
    oldManagerAndNativeHostClosed: old.afterClose?.event === 'old-manager-and-nativehost-closed',
    managerAndNativeHostRestarted: old.managerPid !== current.managerPid
      && old.nativeHostPid !== current.nativeHostPid
      && old.hostSessionId !== current.hostSessionId,
    gatesOff: old.gateFinanceiro === 'OFF'
      && old.gateNativeHost === 'OFF'
      && current.gateFinanceiro === 'OFF'
      && current.gateNativeHost === 'OFF',
    nativeHostRestarted: old.hostSessionId !== current.hostSessionId
      && old.nativeHostPid !== current.nativeHostPid,
    freshBootstrapApplied: current.hostSecurityState === 'SECURITY_BLOCKED'
      && current.blockedFinancialIdentities.includes(fixture.transactionId),
    noFinancialSuccess: current.result.success !== true,
    noDriverCalls: current.driver.inicia === 0
      && current.driver.continua === 0
      && current.driver.finaliza === 0,
    noDllLoad: current.driver.dllLoads === 0,
    pendingIdentityRemains: current.transactionStatus === 'pendente',
    dispatchStateNotLost: current.stateBefore === 'PRONTA'
      && ['PRONTA', 'INICIADO'].includes(current.stateAfter),
    explicitReconciliationRequired: current.result.reconciliationRequired === true
  };
  const passed = Object.values(criteria).every(Boolean);
  return {
    name: 'Reinicialização de TefManager e NativeHost com recuperação integrada',
    status: passed ? 'PASSOU' : 'FALHOU',
    oldProcess: {
      managerPid: old.managerPid,
      nativeHostPid: old.nativeHostPid,
      hostSessionId: old.hostSessionId,
      sessionAnchor: old.sessionAnchor,
      gateManager: old.gateFinanceiro,
      gateNativeHost: old.gateNativeHost,
      closedAt: old.afterClose?.at
    },
    newProcess: {
      managerPid: current.managerPid,
      nativeHostPid: current.nativeHostPid,
      hostSessionId: current.hostSessionId,
      sessionValidation: current.sessionValidation,
      gateManager: current.gateFinanceiro,
      gateNativeHost: current.gateNativeHost
    },
    identity: current.identity,
    timestampOriginal: current.timestampOriginal,
    timestampAfter: current.timestampAfter,
    stateBefore: current.stateBefore,
    stateAfter: current.stateAfter,
    financialState: current.financialState,
    transactionStatus: current.transactionStatus,
    result: current.result,
    driver: current.driver,
    hostSecurityState: current.hostSecurityState,
    blockedFinancialIdentities: current.blockedFinancialIdentities,
    databaseIdentity: dbIdentity,
    criteria
  };
}
