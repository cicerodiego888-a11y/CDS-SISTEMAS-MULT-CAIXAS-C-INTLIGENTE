'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mrt49-tef-'));
process.env.DB_DIR = TEST_DB_DIR;
process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';

const OFFICIAL_DB_DIR = path.resolve(
  path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados')
);
assert.notStrictEqual(path.resolve(TEST_DB_DIR), OFFICIAL_DB_DIR);

const database = require('../../backend/database');
assert.notStrictEqual(path.resolve(database.dbPath), path.resolve(path.join(OFFICIAL_DB_DIR, 'mercadao.db')));
const repository = require('../../backend/services/tef/tefRepository');
const TefManagerModule = require('../../backend/services/tef/TefManager');
const TefManager = TefManagerModule.TefManager;
const DestaxaHostBridge = require('../../backend/services/tef/destaxa/DestaxaHostBridge');
const { DestaxaNativeHostRuntime } = require('../../backend/services/tef/destaxa/DestaxaNativeHost');
const DestaxaTransacaoOrquestrador = require('../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
const {
  OPERACOES_HOST,
  PROTOCOLO,
  ESTADOS_BOOTSTRAP,
  criarRequest,
  serializarClaimsBootstrapSeguranca,
  serializarClaimsAutorizacaoReconciliacao
} = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const { DestaxaNativeHostClient } = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');
const { transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');

const CHAVES_TESTE = crypto.generateKeyPairSync('ed25519');
const CHAVE_PUBLICA_TESTE = CHAVES_TESTE.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const resultados = [];

function criarDriver(contadores) {
  return {
    iniciaTransacaoDestaxa() {
      contadores.inicia += 1;
      return { codigo: 'F1', saida: '' };
    },
    continuaTransacaoDestaxa() {
      contadores.continua += 1;
      return { codigo: 'F1', saida: '' };
    },
    finalizaTransacaoDestaxa() {
      contadores.finaliza += 1;
      return { codigo: 'F1', saida: '' };
    }
  };
}

function novoHost(chavePublica = CHAVE_PUBLICA_TESTE, opcoes = {}) {
  const driverCalls = { inicia: 0, continua: 0, finaliza: 0 };
  const orquestrador = new DestaxaTransacaoOrquestrador({ driver: criarDriver(driverCalls) });
  const bridge = {
    getTransacaoContexto: () => orquestrador.getContexto(),
    getOrquestradorTransacao: () => orquestrador,
    iniciarTransacaoDestaxa: (operation, fields, options) =>
      orquestrador.iniciarTransacao(operation, fields, options),
    continuarTransacaoDestaxa: (answer, options) =>
      orquestrador.continuarTransacao(answer, options),
    finalizarTransacaoDestaxa: (confirmation, options) =>
      orquestrador.finalizarTransacao(confirmation, options),
    isLoaded: () => false,
    getDiagnostics: () => ({ dllLoaded: false })
  };
  const host = new DestaxaNativeHostRuntime({
    bridge,
    modoTeste: true,
    reconciliationPublicKey: chavePublica,
    hostSessionId: opcoes.hostSessionId,
    encerrarProcesso: () => {}
  });
  host.testDriverCalls = driverCalls;
  return { host, driverCalls, orquestrador };
}

function identidadeBloqueada(transactionId, financialState = FINANCIAL_STATES.UNKNOWN, extras = {}) {
  return {
    transactionId: String(transactionId),
    operation_id: extras.operation_id ?? `op-${transactionId}`,
    idempotency_key: extras.idempotency_key ?? `idem-${transactionId}`,
    fingerprint: extras.fingerprint ?? `fp-${transactionId}`,
    status: 'pendente',
    financialState
  };
}

function claimsBootstrap(hostSessionId, revision, blocked = [], options = {}) {
  const bootstrapId = options.bootstrapId || crypto.randomBytes(16).toString('hex');
  const ordered = blocked.slice().sort((a, b) => a.transactionId.localeCompare(b.transactionId));
  const claims = {
    version: 1,
    protocol: PROTOCOLO,
    hostSessionId,
    bootstrapId,
    revision,
    issuedAt: options.issuedAt ?? Date.now(),
    recoveryComplete: options.recoveryComplete ?? true,
    recoveryResult: options.recoveryResult || 'SUCCESS',
    securityState: ordered.length ? ESTADOS_BOOTSTRAP.BLOCKED : ESTADOS_BOOTSTRAP.VALIDATED,
    blockedIdentities: ordered,
    permit: options.operation
      ? {
        permitId: bootstrapId,
        operation: options.operation,
        transactionId: String(options.transactionId)
      }
      : null
  };
  return { claims, signature: crypto.sign(
    null,
    Buffer.from(serializarClaimsBootstrapSeguranca(claims), 'utf8'),
    CHAVES_TESTE.privateKey
  ).toString('base64') };
}

function enviar(host, operation, payload = {}, transactionId = null) {
  return host._processar(criarRequest(operation, payload, transactionId, host._seqNativo));
}

function aplicarBootstrap(host, autorizacao) {
  return enviar(host, OPERACOES_HOST.SECURITY_BOOTSTRAP, { autorizacao });
}

function assinarAutorizacaoReconciliacao(host, transactionId, phase, authorizationId) {
  const claims = {
    version: 1,
    authorizationId,
    hostSessionId: host.hostSessionId,
    transactionId: String(transactionId),
    operation_id: `op-${transactionId}`,
    idempotency_key: `idem-${transactionId}`,
    fingerprint: `fp-${transactionId}`,
    financialState: FINANCIAL_STATES.CONFIRMED_DENIED,
    recordStatus: phase === 'release' ? 'pendente' : 'negado',
    resultStatus: 'negado',
    usuario: 'mrt49-test-operator',
    observacao: 'reconciliacao simulada isolada',
    phase,
    issuedAt: Date.now()
  };
  return {
    claims,
    signature: crypto.sign(
      null,
      Buffer.from(serializarClaimsAutorizacaoReconciliacao(claims), 'utf8'),
      CHAVES_TESTE.privateKey
    ).toString('base64')
  };
}

function spawnerInProcesso(opcoes = {}) {
  const runtimes = [];
  const spawner = (_hostPath, env) => {
    const { host } = novoHost(env.DESTAXA_RECONCILIATION_PUBLIC_KEY);
    runtimes.push(host);
    let receber = null;
    let sair = null;
    const processo = {
      pid: 40000 + runtimes.length,
      tipo: 'isolated-test-ipc',
      connected: true,
      ref() {},
      unref() {},
      aoReceber(callback) {
        receber = callback;
        setImmediate(() => receber?.({
          tipo: 'HOST_READY',
          protocol: PROTOCOLO,
          pid: processo.pid,
          processType: processo.tipo,
          hostSessionId: host.hostSessionId,
          versions: {},
          modoTeste: true,
          tripwire: false
        }));
      },
      aoSair(callback) {
        sair = callback;
      },
      aoErro() {},
      enviar(request) {
        if (opcoes.descartarBootstrap === true
          && request.operation === OPERACOES_HOST.SECURITY_BOOTSTRAP) return;
        setImmediate(() => {
          if (!processo.connected) return;
          const response = host.processar(request);
          receber?.(response);
        });
      },
      matar() {
        if (!processo.connected) return;
        processo.connected = false;
        setImmediate(() => sair?.(0, null));
      },
      desconectarIpc() {
        processo.connected = false;
        host.aoDisconnectIpc({ motivo: 'teste isolado' });
        setImmediate(() => sair?.(0, null));
      }
    };
    return processo;
  };
  return { spawner, runtimes };
}

function criarCliente(chavePublica, provedor, options = {}) {
  const { spawner, runtimes } = spawnerInProcesso(options);
  const client = new DestaxaNativeHostClient({
    spawner,
    timeoutInicioMs: options.timeoutInicioMs || 1000,
    timeoutMs: 100
  });
  client.configurarChavePublicaReconciliacao(chavePublica);
  client.configurarProvedorBootstrapSeguranca(provedor);
  return { client, runtimes };
}

async function aguardarBanco() {
  const limite = Date.now() + 30000;
  while (!database.isReady()) {
    if (Date.now() >= limite) throw new Error('SQLite temporario MRT-49 nao ficou pronto');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function inserirPendente(tag) {
  const identity = {
    operation_id: `mrt49-op-${tag}`,
    idempotency_key: `mrt49-idem-${tag}`,
    fingerprint: `mrt49-fp-${tag}`
  };
  return new Promise((resolve, reject) => {
    repository.criarTransacao({
      tipo: 'CRT',
      valor: 1,
      status: 'pendente',
      provedor: 'DESTAXA',
      idempotency_key: identity.idempotency_key,
      codigo_transacao: identity.operation_id,
      payload_retorno: {
        financialState: FINANCIAL_STATES.UNKNOWN,
        persistencia: { ...identity, estadoFinanceiroInicial: FINANCIAL_STATES.UNKNOWN }
      }
    }, (error, id) => (error ? reject(error) : resolve({ id: String(id), identity })));
  });
}

function buscarTransacao(id) {
  return new Promise((resolve, reject) => {
    repository.obterTransacaoPorId(id, (error, row) => (error ? reject(error) : resolve(row)));
  });
}

function fecharPendente(id) {
  return buscarTransacao(id).then((row) => new Promise((resolve, reject) => {
    repository.atualizarTransacao(id, {
      status: 'negado',
      payload_retorno: row.payload_retorno
    }, (error) => (error ? reject(error) : resolve()));
  }));
}

function abrirTrava(manager, id) {
  manager._pendencias.set(String(id), {
    estado: TefManagerModule.ESTADOS_TRAVA_RESULTADO_TARDIO.RECONCILIACAO_PENDENTE,
    financialState: FINANCIAL_STATES.UNKNOWN,
    resultadoTardio: { codigo: 'F1', financialState: FINANCIAL_STATES.UNKNOWN }
  });
}

function dadosReconciliacao() {
  return {
    financialState: FINANCIAL_STATES.CONFIRMED_DENIED,
    usuario: 'mrt49-operador-isolado',
    observacao: 'resultado conferido apenas em teste isolado',
    confirmacao_explicita: true
  };
}

async function test(nome, executar) {
  try {
    const evidencias = await executar();
    resultados.push({ nome, resultado: 'PASSOU', evidencias: evidencias || null });
  } catch (error) {
    resultados.push({ nome, resultado: 'FALHOU', erro: error.message });
  }
}

async function main() {
  await aguardarBanco();
  assert.strictEqual(transacaoRealHabilitada(), false);
  assert.strictEqual(path.resolve(database.dbDir), path.resolve(TEST_DB_DIR));

  await test('1 Host novo recusa TX_START antes do bootstrap', async () => {
    const { host, driverCalls } = novoHost();
    const response = enviar(host, OPERACOES_HOST.TX_START, { operacao: 'CRT', campos: {} }, 'new-start');
    const reconcile = enviar(host, OPERACOES_HOST.RECONCILE, { autorizacao: {} }, 'new-start');
    assert.strictEqual(response.error.code, 'HOST_SECURITY_BOOTSTRAP_REQUIRED');
    assert.strictEqual(reconcile.error.code, 'HOST_SECURITY_BOOTSTRAP_REQUIRED');
    assert.strictEqual(driverCalls.inicia, 0);
    return { estado: host.status().securityBootstrapState, reconcileSubstituteRejected: true, driverCalls };
  });

  await test('2 Host novo recusa TX_CONTINUE antes do bootstrap', async () => {
    const { host, driverCalls } = novoHost();
    const response = enviar(host, OPERACOES_HOST.TX_CONTINUE, { resposta: {} }, 'new-continue');
    assert.strictEqual(response.error.code, 'HOST_SECURITY_BOOTSTRAP_REQUIRED');
    assert.strictEqual(driverCalls.continua, 0);
    return { estado: host.status().securityBootstrapState, driverCalls };
  });

  await test('3 Host novo recusa TX_FINALIZE antes do bootstrap', async () => {
    const { host, driverCalls } = novoHost();
    const response = enviar(host, OPERACOES_HOST.TX_FINALIZE, { confirmacao: 0 }, 'new-finalize');
    assert.strictEqual(response.error.code, 'HOST_SECURITY_BOOTSTRAP_REQUIRED');
    assert.strictEqual(driverCalls.finaliza, 0);
    return { estado: host.status().securityBootstrapState, driverCalls };
  });

  await test('4 assinatura de bootstrap invalida e recusada', async () => {
    const { host, driverCalls } = novoHost();
    const authorization = claimsBootstrap(host.hostSessionId, 1);
    authorization.signature = `${authorization.signature.slice(0, -2)}AA`;
    const response = aplicarBootstrap(host, authorization);
    assert.strictEqual(response.error.code, 'HOST_SECURITY_BOOTSTRAP_INVALID');
    assert.strictEqual(host.status().securityBootstrapState, ESTADOS_BOOTSTRAP.FAILED);
    assert.strictEqual(driverCalls.inicia, 0);
    return { erro: response.error.code, estado: host.status().securityBootstrapState };
  });

  await test('5 bootstrap de outra sessao e recusado', async () => {
    const { host } = novoHost();
    const response = aplicarBootstrap(host, claimsBootstrap('foreign-session', 1));
    assert.strictEqual(response.error.code, 'HOST_SECURITY_BOOTSTRAP_INVALID');
    assert.strictEqual(host.status().securityBootstrapRevision, 0);
    return { revisao: host.status().securityBootstrapRevision };
  });

  await test('6 bootstrap expirado e recusado', async () => {
    const { host } = novoHost();
    const response = aplicarBootstrap(host, claimsBootstrap(
      host.hostSessionId,
      1,
      [],
      { issuedAt: Date.now() - 6 * 60 * 1000 }
    ));
    assert.strictEqual(response.error.code, 'HOST_SECURITY_BOOTSTRAP_INVALID');
    return { erro: response.error.code };
  });

  await test('7 alteracao de claims apos assinatura e recusada', async () => {
    const { host } = novoHost();
    const authorization = claimsBootstrap(host.hostSessionId, 1, [identidadeBloqueada('tampered')]);
    authorization.claims.blockedIdentities = [];
    authorization.claims.securityState = ESTADOS_BOOTSTRAP.VALIDATED;
    const response = aplicarBootstrap(host, authorization);
    assert.strictEqual(response.error.code, 'HOST_SECURITY_BOOTSTRAP_INVALID');
    assert.strictEqual(host.status().blockedFinancialIdentities.length, 0);
    return { erro: response.error.code, bloqueios: host.status().blockedFinancialIdentities };
  });

  await test('8 bootstrap com UNKNOWN bloqueia TX_START', async () => {
    const { host, driverCalls } = novoHost();
    const identity = identidadeBloqueada('unknown-lock');
    const bootstrap = aplicarBootstrap(host, claimsBootstrap(host.hostSessionId, 1, [identity]));
    assert.strictEqual(bootstrap.output.securityState, ESTADOS_BOOTSTRAP.BLOCKED);
    const response = enviar(host, OPERACOES_HOST.TX_START, { operacao: 'CRT', campos: {} }, 'new-id');
    assert.strictEqual(response.error.code, 'HOST_SECURITY_OPERATION_BLOCKED');
    assert.deepStrictEqual(host.status().blockedFinancialIdentities, ['unknown-lock']);
    assert.strictEqual(driverCalls.inicia, 0);
    return { bloqueios: host.status().blockedFinancialIdentities, driverCalls };
  });

  await test('9 bootstrap com PENDING bloqueia TX_START', async () => {
    const { host, driverCalls } = novoHost();
    aplicarBootstrap(host, claimsBootstrap(
      host.hostSessionId,
      1,
      [identidadeBloqueada('pending-lock', 'PENDING')]
    ));
    const response = enviar(host, OPERACOES_HOST.TX_START, { operacao: 'CRT', campos: {} }, 'new-id');
    assert.strictEqual(response.error.code, 'HOST_SECURITY_OPERATION_BLOCKED');
    assert.strictEqual(driverCalls.inicia, 0);
    return { bloqueios: host.status().blockedFinancialIdentities };
  });

  await test('10 chamada direta ao DestaxaHostBridge nao contorna a falta de permit', async () => {
    const provider = ({ hostSessionId, revision }) => claimsBootstrap(hostSessionId, revision);
    const { client, runtimes } = criarCliente(CHAVE_PUBLICA_TESTE, provider);
    assert.strictEqual(await client.iniciar(), true);
    const bridge = new DestaxaHostBridge({ client });
    const response = await bridge.iniciarTransacaoDestaxa('CRT', {}, { transactionId: 'bridge-bypass' });
    assert.strictEqual(response.sucesso, false);
    assert.strictEqual(response.codigo, 'HOST_SECURITY_OPERATION_BLOCKED');
    assert.strictEqual(runtimes[0].testDriverCalls.inicia, 0);
    return { codigo: response.codigo, chamadasDriver: runtimes[0].testDriverCalls.inicia };
  });

  await test('11 chamada direta ao NativeHostClient nao contorna a falta de permit', async () => {
    const provider = ({ hostSessionId, revision }) => claimsBootstrap(hostSessionId, revision);
    const { client, runtimes } = criarCliente(CHAVE_PUBLICA_TESTE, provider);
    const response = await client.enviar(
      OPERACOES_HOST.TX_START,
      { operacao: 'CRT', campos: {} },
      { transactionId: 'client-bypass' }
    );
    assert.strictEqual(response.error.code, 'HOST_SECURITY_OPERATION_BLOCKED');
    assert.strictEqual(runtimes[0].testDriverCalls.inicia, 0);
    return { codigo: response.error.code, chamadasDriver: runtimes[0].testDriverCalls.inicia };
  });

  await test('12 falha na recuperacao mantem Host bloqueado', async () => {
    const { client, runtimes } = criarCliente(CHAVE_PUBLICA_TESTE, async () => {
      throw new Error('falha simulada na recuperacao');
    });
    assert.strictEqual(await client.iniciar(), false);
    assert.strictEqual(runtimes[0].status().securityBootstrapState, ESTADOS_BOOTSTRAP.REQUIRED);
    assert.strictEqual(runtimes[0].testDriverCalls.inicia, 0);
    return { hostState: runtimes[0].status().securityBootstrapState, clientState: client.getEstado().securityBootstrapState };
  });

  await test('13 reinicio do NativeHost exige novo bootstrap', async () => {
    const first = novoHost();
    aplicarBootstrap(first.host, claimsBootstrap(first.host.hostSessionId, 1));
    const restarted = novoHost();
    assert.notStrictEqual(restarted.host.hostSessionId, first.host.hostSessionId);
    const response = enviar(
      restarted.host,
      OPERACOES_HOST.TX_START,
      { operacao: 'CRT', campos: {} },
      'after-restart'
    );
    assert.strictEqual(response.error.code, 'HOST_SECURITY_BOOTSTRAP_REQUIRED');
    assert.strictEqual(restarted.driverCalls.inicia, 0);
    return { oldSession: first.host.hostSessionId, newState: restarted.host.status().securityBootstrapState };
  });

  await test('14 novo TefManager recupera pendencia e envia bootstrap autenticado', async () => {
    const { id } = await inserirPendente('restart-recovery');
    const { spawner, runtimes } = spawnerInProcesso();
    const client = new DestaxaNativeHostClient({ spawner, timeoutInicioMs: 500 });
    const manager = new TefManager({ nativeHostClient: client, recuperarNoInicio: false });
    await manager.garantirRecuperacao();
    assert.strictEqual(await client.iniciar(), true);
    assert.ok(manager._pendencias.has(id));
    assert.deepStrictEqual(runtimes[0].status().blockedFinancialIdentities, [id]);
    assert.strictEqual(client.getEstado().securityBootstrapState, ESTADOS_BOOTSTRAP.BLOCKED);
    await fecharPendente(id);
    return { recuperada: manager._pendencias.has(id), bloqueioHost: runtimes[0].status().blockedFinancialIdentities };
  });

  await test('15 nova pendencia durante sessao bloqueia antes de TX_START', async () => {
    const { spawner, runtimes } = spawnerInProcesso();
    const client = new DestaxaNativeHostClient({ spawner, timeoutInicioMs: 500 });
    const manager = new TefManager({ nativeHostClient: client, recuperarNoInicio: false });
    assert.strictEqual(await client.iniciar(), true);
    const { id } = await inserirPendente('active-session');
    const response = await client.enviar(
      OPERACOES_HOST.TX_START,
      { operacao: 'CRT', campos: {} },
      { transactionId: 'new-after-pending' }
    );
    assert.strictEqual(response.error.code, 'HOST_SECURITY_OPERATION_BLOCKED');
    assert.deepStrictEqual(runtimes[0].status().blockedFinancialIdentities, [id]);
    assert.strictEqual(runtimes[0].testDriverCalls.inicia, 0);
    await fecharPendente(id);
    return { blockedBeforeStart: true, id, driverCalls: runtimes[0].testDriverCalls };
  });

  await test('16 reconciliação MRT-47 remove somente a identidade persistida', async () => {
    const { spawner, runtimes } = spawnerInProcesso();
    const client = new DestaxaNativeHostClient({ spawner, timeoutInicioMs: 1000 });
    const manager = new TefManager({ nativeHostClient: client, recuperarNoInicio: false });
    assert.strictEqual(await client.iniciar(), true);
    const { id: firstId, identity } = await inserirPendente('reconcile-first');
    abrirTrava(manager, firstId);
    manager._emExecucao.add(firstId);
    const bridge = new DestaxaHostBridge({ client });
    const started = await manager._nativeHostIntent.run({
      transactionId: firstId,
      allowedOperations: ['TX_START']
    }, () => bridge.iniciarTransacaoDestaxa('CRT', {}, { transactionId: firstId }));
    manager._emExecucao.delete(firstId);
    assert.strictEqual(started.financialState, FINANCIAL_STATES.UNKNOWN);
    const { id: secondId } = await inserirPendente('reconcile-second');
    abrirTrava(manager, secondId);

    const dados = dadosReconciliacao();
    const resultado = await manager.reconciliarResultadoTardio(firstId, dados);
    assert.strictEqual(resultado.travaLiberada, false);
    const liberacao = await manager.reconciliarNativeHost(firstId, dados, resultado);
    assert.strictEqual(liberacao.travaLiberada, true);
    assert.deepStrictEqual(runtimes[0].status().blockedFinancialIdentities, [secondId]);
    assert.ok(!manager._pendencias.has(firstId));
    assert.ok(manager._pendencias.has(secondId));
    const firstRow = await buscarTransacao(firstId);
    assert.strictEqual(firstRow.status, 'negado');
    assert.strictEqual(firstRow.payload_retorno.reconciliacao.operation_id, identity.operation_id);
    await fecharPendente(secondId);
    return {
      reconciledId: firstId,
      retainedBlock: secondId,
      databaseStatus: firstRow.status,
      driverCalls: runtimes[0].testDriverCalls
    };
  });

  await test('17 IPC interrompido durante bootstrap nao libera Host', async () => {
    const provider = ({ hostSessionId, revision }) => claimsBootstrap(hostSessionId, revision);
    const { client, runtimes } = criarCliente(CHAVE_PUBLICA_TESTE, provider, {
      descartarBootstrap: true,
      timeoutInicioMs: 25
    });
    assert.strictEqual(await client.iniciar(), false);
    assert.strictEqual(runtimes[0].status().securityBootstrapState, ESTADOS_BOOTSTRAP.REQUIRED);
    assert.strictEqual(runtimes[0].testDriverCalls.inicia, 0);
    return { hostState: runtimes[0].status().securityBootstrapState, clientState: client.estado };
  });

  await test('18 bootstraps concorrentes com mesma revisao falham fechados', async () => {
    const { host, driverCalls } = novoHost();
    const blocked = claimsBootstrap(host.hostSessionId, 1, [identidadeBloqueada('concurrent-lock')]);
    const clear = claimsBootstrap(host.hostSessionId, 1);
    const first = aplicarBootstrap(host, blocked);
    const second = aplicarBootstrap(host, clear);
    assert.strictEqual(first.output.sucesso, true);
    assert.strictEqual(second.error.code, 'HOST_SECURITY_BOOTSTRAP_INVALID');
    assert.strictEqual(host.status().securityBootstrapState, ESTADOS_BOOTSTRAP.FAILED);
    assert.deepStrictEqual(host.status().blockedFinancialIdentities, ['concurrent-lock']);
    const response = enviar(host, OPERACOES_HOST.TX_START, { operacao: 'CRT', campos: {} }, 'concurrent-start');
    assert.notStrictEqual(response.output?.sucesso, true);
    assert.strictEqual(driverCalls.inicia, 0);
    return { firstAccepted: true, secondRejected: true, driverCalls };
  });

  await test('19 documento de geracao anterior e recusado', async () => {
    const previous = novoHost();
    const authorization = claimsBootstrap(previous.host.hostSessionId, 1);
    const current = novoHost();
    const response = aplicarBootstrap(current.host, authorization);
    assert.strictEqual(response.error.code, 'HOST_SECURITY_BOOTSTRAP_INVALID');
    assert.strictEqual(current.host.status().securityBootstrapState, ESTADOS_BOOTSTRAP.FAILED);
    assert.strictEqual(current.driverCalls.inicia, 0);
    return { oldSessionRejected: true, newSession: current.host.hostSessionId };
  });

  await test('20 TX_START, TX_CONTINUE e TX_FINALIZE bloqueados nao chamam driver', async () => {
    const { host, driverCalls } = novoHost();
    aplicarBootstrap(host, claimsBootstrap(
      host.hostSessionId,
      1,
      [identidadeBloqueada('all-ops-blocked')]
    ));
    const responses = [
      enviar(host, OPERACOES_HOST.TX_START, { operacao: 'CRT', campos: {} }, 'new-id'),
      enviar(host, OPERACOES_HOST.TX_CONTINUE, { resposta: {} }, 'all-ops-blocked'),
      enviar(host, OPERACOES_HOST.TX_FINALIZE, { confirmacao: 0 }, 'all-ops-blocked')
    ];
    assert.ok(responses.every((response) => response.error));
    assert.deepStrictEqual(driverCalls, { inicia: 0, continua: 0, finaliza: 0 });
    assert.deepStrictEqual(host.status().blockedFinancialIdentities, ['all-ops-blocked']);
    return { errors: responses.map((response) => response.error.code), driverCalls };
  });

  const falhas = resultados.filter((item) => item.resultado === 'FALHOU');
  console.log(JSON.stringify({
    sucesso: falhas.length === 0,
    caminhoBanco: database.dbPath,
    caminhoTemporarioIsolado: path.resolve(database.dbDir) === path.resolve(TEST_DB_DIR),
    caminhoOficialAcessado: false,
    gateFinanceiro: transacaoRealHabilitada(),
    dllCarregada: false,
    vspagueConectado: false,
    pinpadAcessado: false,
    operacaoFinanceiraReal: false,
    cenarios: resultados
  }, null, 2));
  if (falhas.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await TefManagerModule.garantirRecuperacao().catch(() => {});
    await new Promise((resolve) => database.close(() => resolve()));
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });
