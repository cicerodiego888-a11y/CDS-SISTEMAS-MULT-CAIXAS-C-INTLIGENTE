'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mrt47-tef-'));
process.env.DB_DIR = TEST_DB_DIR;
process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';

const database = require('../../backend/database');
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
  serializarClaimsBootstrapSeguranca
} = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');
const { transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { DestaxaNativeHostClient, ESTADOS_CLIENTE } = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');

const resultados = [];
const CHAVES_BOOTSTRAP_TESTE = crypto.generateKeyPairSync('ed25519');
const CHAVE_PUBLICA_BOOTSTRAP_TESTE = CHAVES_BOOTSTRAP_TESTE.publicKey
  .export({ format: 'der', type: 'spki' })
  .toString('base64');
let transacoesCenarioAtual = null;

function novoHost(publicKey, driverCalls = { inicia: 0, continua: 0, finaliza: 0 }) {
  const driver = {
    nome: 'mock',
    iniciaTransacaoDestaxa() {
      driverCalls.inicia += 1;
      return { codigo: 'F1', saida: '' };
    },
    continuaTransacaoDestaxa() {
      driverCalls.continua += 1;
      return { codigo: '00', saida: '' };
    },
    finalizaTransacaoDestaxa() {
      driverCalls.finaliza += 1;
      return { codigo: '00', saida: '' };
    }
  };
  const orquestrador = new DestaxaTransacaoOrquestrador({ driver });
  const bridge = {
    getTransacaoContexto: () => orquestrador.getContexto(),
    getOrquestradorTransacao: () => orquestrador,
    iniciarTransacaoDestaxa: (operacao, campos, opcoes) =>
      orquestrador.iniciarTransacao(operacao, campos, opcoes),
    continuarTransacaoDestaxa: (resposta) => orquestrador.continuarTransacao(resposta),
    finalizarTransacaoDestaxa: (confirmacao) => orquestrador.finalizarTransacao(confirmacao),
    isLoaded: () => false,
    getDiagnostics: () => ({ dllLoaded: false })
  };
  const host = new DestaxaNativeHostRuntime({
    bridge,
    modoTeste: true,
    reconciliationPublicKey: publicKey,
    encerrarProcesso: () => {}
  });
  host.testDriverCalls = driverCalls;
  return host;
}

function spawnerInProcesso({ erroOperacao = null } = {}) {
  const runtimes = [];
  const requests = [];
  const spawner = (_hostPath, env) => {
    const driverCalls = { inicia: 0, continua: 0, finaliza: 0 };
    const host = novoHost(env.DESTAXA_RECONCILIATION_PUBLIC_KEY, driverCalls);
    runtimes.push(host);
    let receber;
    let sair;
    const processo = {
      pid: 47000 + runtimes.length,
      tipo: 'mrt47-isolated-test-ipc',
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
        requests.push(request);
        if (request.operation === erroOperacao) {
          setImmediate(() => receber?.({
            protocol: PROTOCOLO,
            requestId: request.requestId,
            transactionId: request.transactionId,
            error: { code: 'HOST_UNAVAILABLE', message: 'falha simulada de IPC' }
          }));
          return;
        }
        setImmediate(() => {
          if (processo.connected) receber?.(host.processar(request));
        });
      },
      matar() {
        if (!processo.connected) return;
        processo.connected = false;
        setImmediate(() => sair?.(0, null));
      },
      desconectarIpc() {
        processo.connected = false;
        host.aoDisconnectIpc({ motivo: 'teste isolado MRT-47' });
        setImmediate(() => sair?.(0, null));
      }
    };
    return processo;
  };
  return { spawner, runtimes, requests };
}

function novoManager(tag, opcoes = {}) {
  const { spawner, runtimes, requests } = spawnerInProcesso(opcoes);
  const client = new DestaxaNativeHostClient({
    spawner,
    timeoutMs: 200,
    timeoutInicioMs: 1000
  });
  const manager = new TefManager({
    recuperarNoInicio: false,
    nativeHostClient: client
  });
  return {
    manager,
    client,
    bridge: new DestaxaHostBridge({ client }),
    runtimes,
    requests,
    tag
  };
}

async function iniciarUnknown(harness, transactionId) {
  const id = String(transactionId);
  await harness.manager.garantirRecuperacao();
  harness.manager._emExecucao.add(id);
  try {
    return await harness.manager._nativeHostIntent.run({
      transactionId: id,
      allowedOperations: ['TX_START']
    }, () => harness.bridge.iniciarTransacaoDestaxa(
      'CRT',
      { transacao_valor: '1.00' },
      { transactionId: id }
    ));
  } finally {
    harness.manager._emExecucao.delete(id);
  }
}

function identidadeBloqueada(transactionId) {
  return {
    transactionId: String(transactionId),
    operation_id: `mrt47-op-${transactionId}`,
    idempotency_key: `mrt47-idem-${transactionId}`,
    fingerprint: `mrt47-fp-${transactionId}`,
    status: 'pendente',
    financialState: FINANCIAL_STATES.UNKNOWN
  };
}

function criarBootstrap(host, { blockedIdentities = [], operation = null, transactionId = null } = {}) {
  const bootstrapId = crypto.randomBytes(16).toString('hex');
  const bloqueadas = blockedIdentities.slice()
    .sort((a, b) => a.transactionId.localeCompare(b.transactionId));
  const claims = {
    version: 1,
    protocol: PROTOCOLO,
    hostSessionId: host.hostSessionId,
    bootstrapId,
    revision: 1,
    issuedAt: Date.now(),
    recoveryComplete: true,
    recoveryResult: 'SUCCESS',
    securityState: bloqueadas.length ? ESTADOS_BOOTSTRAP.BLOCKED : ESTADOS_BOOTSTRAP.VALIDATED,
    blockedIdentities: bloqueadas,
    permit: operation ? { permitId: bootstrapId, operation, transactionId: String(transactionId) } : null
  };
  return {
    claims,
    signature: crypto.sign(
      null,
      Buffer.from(serializarClaimsBootstrapSeguranca(claims), 'utf8'),
      CHAVES_BOOTSTRAP_TESTE.privateKey
    ).toString('base64')
  };
}

function aplicarBootstrap(host, autorizacao) {
  return host._processar(criarRequest(
    OPERACOES_HOST.SECURITY_BOOTSTRAP,
    { autorizacao },
    null,
    host._seqNativo
  ));
}

async function aguardarBanco() {
  const limite = Date.now() + 30000;
  while (!database.isReady()) {
    if (Date.now() >= limite) throw new Error('Banco temporário MRT-47 não ficou pronto');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function obterTransacao(id) {
  return new Promise((resolve, reject) => {
    repository.obterTransacaoPorId(id, (error, row) => (error ? reject(error) : resolve(row)));
  });
}

function inserirPendente(tag) {
  const identity = {
    operation_id: `mrt47-op-${tag}`,
    idempotency_key: `mrt47-idem-${tag}`,
    fingerprint: `mrt47-fp-${tag}`
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
    }, (error, id) => {
      if (error) return reject(error);
      const transactionId = String(id);
      transacoesCenarioAtual?.push(transactionId);
      return resolve({ id: transactionId, identity });
    });
  });
}

function removerFixtureTemporaria(id) {
  const executar = (sql) => new Promise((resolve, reject) => {
    database.run(sql, [id], (error) => (error ? reject(error) : resolve()));
  });
  return executar('DELETE FROM tef_logs WHERE transacao_id = ?')
    .then(() => executar('DELETE FROM tef_transacoes WHERE id = ?'));
}

function dadosReconciliacao(overrides = {}) {
  return {
    financialState: FINANCIAL_STATES.CONFIRMED_DENIED,
    usuario: 'mrt47-operador',
    observacao: 'resultado conferido em comprovante de teste',
    confirmacao_explicita: true,
    ...overrides
  };
}

function requisicaoHost(host, operation, payload, transactionId) {
  return criarRequest(operation, payload, String(transactionId), host._seqNativo);
}

async function persistirRecon(manager, id, dados = dadosReconciliacao()) {
  return manager.reconciliarResultadoTardio(id, dados);
}

async function assertLockedAndIdentity(manager, client, id, identity) {
  assert.ok(manager._pendencias.has(String(id)));
  const row = await obterTransacao(id);
  assert.strictEqual(row.status, 'pendente');
  assert.strictEqual(row.idempotency_key, identity.idempotency_key);
  assert.strictEqual(row.payload_retorno.persistencia.operation_id, identity.operation_id);
}

async function test(nome, fn) {
  const idsDoCenario = [];
  transacoesCenarioAtual = idsDoCenario;
  const indiceResultado = resultados.length;
  try {
    const evidencias = await fn();
    resultados.push({ nome, resultado: 'PASSOU', evidencias: evidencias || null });
  } catch (error) {
    resultados.push({ nome, resultado: 'FALHOU', erro: error.message });
  } finally {
    transacoesCenarioAtual = null;
    const errosLimpeza = [];
    for (const id of idsDoCenario) {
      try {
        await removerFixtureTemporaria(id);
      } catch (error) {
        errosLimpeza.push(error.message);
      }
    }
    if (errosLimpeza.length) {
      const resultado = resultados[indiceResultado];
      resultado.resultado = 'FALHOU';
      resultado.erro = [resultado.erro, `falha limpando fixtures temporárias: ${errosLimpeza.join('; ')}`]
        .filter(Boolean)
        .join(' | ');
    }
  }
}

async function main() {
  await aguardarBanco();
  assert.strictEqual(transacaoRealHabilitada(), false);

  await test('1 gravação e leitura integral liberam apenas a identidade vinculada', async () => {
    const harness = novoManager('success');
    const { manager } = harness;
    const { id, identity } = await inserirPendente('success');
    const unknown = await iniciarUnknown(harness, id);
    assert.strictEqual(unknown.financialState, FINANCIAL_STATES.UNKNOWN);
    const dados = dadosReconciliacao();
    const resultado = await persistirRecon(manager, id, dados);
    assert.strictEqual(resultado.persistenciaValidada, true);
    assert.strictEqual(resultado.travaLiberada, false);
    const liberacao = await manager.reconciliarNativeHost(id, dados, resultado);
    assert.strictEqual(liberacao.travaLiberada, true);
    assert.ok(!manager._pendencias.has(id));
    const final = await obterTransacao(id);
    assert.strictEqual(final.status, 'negado');
    assert.deepStrictEqual(final.payload_retorno.reconciliacao, {
      ...final.payload_retorno.reconciliacao,
      transactionId: id,
      ...identity,
      financialState: dados.financialState,
      resultStatus: 'negado',
      usuario: dados.usuario,
      observacao: dados.observacao,
      confirmacao_explicita: true
    });
    const contexto = harness.runtimes[0].bridge.getTransacaoContexto();
    assert.strictEqual(contexto.transactionId, id);
    assert.strictEqual(contexto.financialState, dados.financialState);
    return { statusFinal: final.status, travaLiberada: liberacao.travaLiberada, identidade: identity };
  });

  await test('2 erro de gravação é propagado e mantém trava', async () => {
    const harness = novoManager('write-error');
    const { manager, client } = harness;
    const { id, identity } = await inserirPendente('write-error');
    const unknown = await iniciarUnknown(harness, id);
    assert.strictEqual(unknown.financialState, FINANCIAL_STATES.UNKNOWN);
    const original = repository.atualizarTransacao;
    repository.atualizarTransacao = (_id, _dados, callback) =>
      setImmediate(() => callback(new Error('falha simulada de escrita')));
    try {
      await assert.rejects(() => persistirRecon(manager, id), /falha simulada de escrita/);
    } finally {
      repository.atualizarTransacao = original;
    }
    await assertLockedAndIdentity(manager, client, id, identity);
    return { escritaPropagada: true, driverCalls: harness.runtimes[0].testDriverCalls };
  });

  await test('3 erro de leitura posterior é propagado e mantém trava', async () => {
    const harness = novoManager('read-error');
    const { manager, client } = harness;
    const { id, identity } = await inserirPendente('read-error');
    const unknown = await iniciarUnknown(harness, id);
    assert.strictEqual(unknown.financialState, FINANCIAL_STATES.UNKNOWN);
    const original = repository.obterTransacaoPorId;
    let leituras = 0;
    repository.obterTransacaoPorId = (txId, callback) => {
      leituras += 1;
      if (leituras === 2) return setImmediate(() => callback(new Error('falha simulada de leitura')));
      original(txId, callback);
    };
    try {
      await assert.rejects(() => persistirRecon(manager, id), /falha simulada de leitura/);
    } finally {
      repository.obterTransacaoPorId = original;
    }
    await assertLockedAndIdentity(manager, client, id, identity);
    return {
      leituraPosteriorPropagada: true,
      status: (await obterTransacao(id)).status,
      driverCalls: harness.runtimes[0].testDriverCalls
    };
  });

  await test('4 status divergente impede emissão de autorização', async () => {
    const harness = novoManager('status-mismatch');
    const { manager, client } = harness;
    const { id, identity } = await inserirPendente('status-mismatch');
    const unknown = await iniciarUnknown(harness, id);
    assert.strictEqual(unknown.financialState, FINANCIAL_STATES.UNKNOWN);
    const dados = dadosReconciliacao();
    const resultado = await persistirRecon(manager, id, dados);
    const original = repository.obterTransacaoPorId;
    repository.obterTransacaoPorId = (txId, callback) => original(txId, (error, row) => {
      if (row) row.status = 'status-divergente';
      callback(error, row);
    });
    try {
      await assert.rejects(() => manager.reconciliarNativeHost(id, dados, resultado), {
        code: 'TEF_RECONCILIACAO_PERSISTENCIA_DIVERGENTE'
      });
    } finally {
      repository.obterTransacaoPorId = original;
    }
    await assertLockedAndIdentity(manager, client, id, identity);
    assert.strictEqual(
      harness.requests.some((request) => request.operation === OPERACOES_HOST.RECONCILE),
      false
    );
    assert.deepStrictEqual(harness.runtimes[0].testDriverCalls, { inicia: 1, continua: 0, finaliza: 0 });
    return { autorizacaoEmitida: false, travaMantida: true, driverCalls: harness.runtimes[0].testDriverCalls };
  });

  await test('5 financialState divergente impede emissão de autorização', async () => {
    const harness = novoManager('state-mismatch');
    const { manager, client } = harness;
    const { id, identity } = await inserirPendente('state-mismatch');
    const unknown = await iniciarUnknown(harness, id);
    assert.strictEqual(unknown.financialState, FINANCIAL_STATES.UNKNOWN);
    const dados = dadosReconciliacao();
    const resultado = await persistirRecon(manager, id, dados);
    const original = repository.obterTransacaoPorId;
    repository.obterTransacaoPorId = (txId, callback) => original(txId, (error, row) => {
      if (row?.payload_retorno?.reconciliacao) {
        row.payload_retorno.reconciliacao.financialState = 'CONFIRMED_SUCCESS';
      }
      callback(error, row);
    });
    try {
      await assert.rejects(() => manager.reconciliarNativeHost(id, dados, resultado), {
        code: 'TEF_RECONCILIACAO_PERSISTENCIA_DIVERGENTE'
      });
    } finally {
      repository.obterTransacaoPorId = original;
    }
    await assertLockedAndIdentity(manager, client, id, identity);
    assert.strictEqual(
      harness.requests.some((request) => request.operation === OPERACOES_HOST.RECONCILE),
      false
    );
    assert.deepStrictEqual(harness.runtimes[0].testDriverCalls, { inicia: 1, continua: 0, finaliza: 0 });
    return { autorizacaoEmitida: false, travaMantida: true, driverCalls: harness.runtimes[0].testDriverCalls };
  });

  await test('6 identidade divergente impede emissão de autorização', async () => {
    const harness = novoManager('identity-mismatch');
    const { manager, client } = harness;
    const { id, identity } = await inserirPendente('identity-mismatch');
    const unknown = await iniciarUnknown(harness, id);
    assert.strictEqual(unknown.financialState, FINANCIAL_STATES.UNKNOWN);
    const dados = dadosReconciliacao();
    const resultado = await persistirRecon(manager, id, dados);
    const original = repository.obterTransacaoPorId;
    repository.obterTransacaoPorId = (txId, callback) => original(txId, (error, row) => {
      if (row) row.idempotency_key = 'outra-identidade';
      callback(error, row);
    });
    try {
      await assert.rejects(() => manager.reconciliarNativeHost(id, dados, resultado), {
        code: 'TEF_RECONCILIACAO_IDENTIDADE_DIVERGENTE'
      });
    } finally {
      repository.obterTransacaoPorId = original;
    }
    await assertLockedAndIdentity(manager, client, id, identity);
    assert.strictEqual(
      harness.requests.some((request) => request.operation === OPERACOES_HOST.RECONCILE),
      false
    );
    assert.deepStrictEqual(harness.runtimes[0].testDriverCalls, { inicia: 1, continua: 0, finaliza: 0 });
    return {
      autorizacaoEmitida: false,
      identidadeOriginalPreservada: true,
      driverCalls: harness.runtimes[0].testDriverCalls
    };
  });

  await test('7 operador ou observação divergentes impedem emissão de autorização', async () => {
    const harness = novoManager('operator-mismatch');
    const { manager, client } = harness;
    const { id, identity } = await inserirPendente('operator-mismatch');
    const unknown = await iniciarUnknown(harness, id);
    assert.strictEqual(unknown.financialState, FINANCIAL_STATES.UNKNOWN);
    const dados = dadosReconciliacao();
    const resultado = await persistirRecon(manager, id, dados);
    const original = repository.obterTransacaoPorId;
    repository.obterTransacaoPorId = (txId, callback) => original(txId, (error, row) => {
      if (row?.payload_retorno?.reconciliacao) {
        row.payload_retorno.reconciliacao.usuario = 'outro-operador';
      }
      callback(error, row);
    });
    try {
      await assert.rejects(() => manager.reconciliarNativeHost(id, dados, resultado), {
        code: 'TEF_RECONCILIACAO_PERSISTENCIA_DIVERGENTE'
      });
    } finally {
      repository.obterTransacaoPorId = original;
    }
    await assertLockedAndIdentity(manager, client, id, identity);
    assert.strictEqual(
      harness.requests.some((request) => request.operation === OPERACOES_HOST.RECONCILE),
      false
    );
    assert.deepStrictEqual(harness.runtimes[0].testDriverCalls, { inicia: 1, continua: 0, finaliza: 0 });
    return { autorizacaoEmitida: false, travaMantida: true, driverCalls: harness.runtimes[0].testDriverCalls };
  });

  await test('8 persistida=true não libera chamada direta ao NativeHost', async () => {
    const driverCalls = { inicia: 0, continua: 0, finaliza: 0 };
    const host = novoHost(CHAVE_PUBLICA_BOOTSTRAP_TESTE, driverCalls);
    const startSemBootstrap = host._processar(criarRequest(
      OPERACOES_HOST.TX_START,
      { operacao: 'CRT', campos: {} },
      'mrt47-direct-persistida'
    ));
    assert.strictEqual(startSemBootstrap.error.code, 'HOST_SECURITY_BOOTSTRAP_REQUIRED');
    assert.strictEqual(driverCalls.inicia, 0);
    const semBootstrap = host._processar(criarRequest(
      OPERACOES_HOST.RECONCILE,
      { persistida: true },
      'mrt47-direct-persistida'
    ));
    assert.strictEqual(semBootstrap.error.code, 'HOST_SECURITY_BOOTSTRAP_REQUIRED');
    const bootstrap = aplicarBootstrap(host, criarBootstrap(host, {
      blockedIdentities: [identidadeBloqueada('mrt47-direct-persistida')]
    }));
    assert.strictEqual(bootstrap.output.sucesso, true);
    const response = host._processar(criarRequest(
      OPERACOES_HOST.RECONCILE,
      {
        persistida: true
      },
      'mrt47-direct-persistida'
    ));
    assert.strictEqual(response.error.code, 'HOST_RECONCILIATION_PENDING');
    assert.strictEqual(driverCalls.inicia, 0);
    return { bypass: 'bloqueado', semBootstrap: 'bloqueado', driverCalls };
  });

  await test('9 NativeHost rejeita reconciliação sem autorização confiável', async () => {
    const driverCalls = { inicia: 0, continua: 0, finaliza: 0 };
    const host = novoHost(CHAVE_PUBLICA_BOOTSTRAP_TESTE, driverCalls);
    const bootstrap = aplicarBootstrap(host, criarBootstrap(host, {
      blockedIdentities: [identidadeBloqueada('mrt47-no-auth')]
    }));
    assert.strictEqual(bootstrap.output.sucesso, true);
    const response = host._processar(criarRequest(
      OPERACOES_HOST.RECONCILE,
      {},
      'mrt47-no-auth'
    ));
    assert.strictEqual(response.error.code, 'HOST_RECONCILIATION_PENDING');
    assert.deepStrictEqual(host.status().blockedFinancialIdentities, ['mrt47-no-auth']);
    assert.deepStrictEqual(driverCalls, { inicia: 0, continua: 0, finaliza: 0 });
    return { autorizacaoAusente: 'rejeitada', travaMantida: true, driverCalls };
  });

  await test('10 autorização válida é de uso único e vinculada à sessão/identidade', async () => {
    const harness = novoManager('one-use');
    const { manager, client } = harness;
    const { id } = await inserirPendente('one-use');
    const unknown = await iniciarUnknown(harness, id);
    assert.strictEqual(unknown.financialState, FINANCIAL_STATES.UNKNOWN);
    const dados = dadosReconciliacao();
    const resultado = await persistirRecon(manager, id, dados);
    await manager.reconciliarNativeHost(id, dados, resultado);
    const request = harness.requests.find((item) =>
      item.operation === OPERACOES_HOST.RECONCILE && item.transactionId === id);
    const first = request?.payload?.autorizacao;
    assert.ok(first?.claims?.authorizationId);
    const replay = await client.reconciliarTransacao(id, first);
    assert.strictEqual(replay.sucesso, false);
    assert.strictEqual(replay.codigo, 'HOST_RECONCILIATION_PENDING');
    const otherIdentity = {
      ...first,
      claims: { ...first.claims, transactionId: 'mrt47-other-identity' }
    };
    const mismatch = await client.reconciliarTransacao('mrt47-other-identity', otherIdentity);
    assert.strictEqual(mismatch.sucesso, false);
    assert.strictEqual(mismatch.codigo, 'HOST_RECONCILIATION_PENDING');
    assert.deepStrictEqual(harness.runtimes[0].testDriverCalls, { inicia: 1, continua: 0, finaliza: 0 });
    return {
      replay: 'rejeitado',
      identityMismatch: 'rejeitada',
      driverCalls: harness.runtimes[0].testDriverCalls
    };
  });

  await test('11 NativeHost offline/crashed não limpa marcador local', async () => {
    const client = new DestaxaNativeHostClient({ spawner: () => { throw new Error('não deve iniciar'); } });
    client.configurarChavePublicaReconciliacao('invalid-key');
    client.marcarReconciliacaoPendente('mrt47-offline');
    client._estado = ESTADOS_CLIENTE.CRASHED;
    const result = await client.reconciliarTransacao('mrt47-offline', {
      persistida: true,
      financialState: 'CONFIRMED_DENIED'
    });
    assert.strictEqual(result.sucesso, false);
    assert.strictEqual(client.getEstado().reconciliacaoPendente.transactionId, 'mrt47-offline');
    return { resposta: result.codigo, marcadorPreservado: true };
  });

  await test('12 falha de IPC após persistência mantém registro pendente e trava', async () => {
    const harness = novoManager('ipc-failure', { erroOperacao: OPERACOES_HOST.RECONCILE });
    const { manager, client } = harness;
    const { id, identity } = await inserirPendente('ipc-failure');
    const unknown = await iniciarUnknown(harness, id);
    assert.strictEqual(unknown.financialState, FINANCIAL_STATES.UNKNOWN);
    const dados = dadosReconciliacao();
    const resultado = await persistirRecon(manager, id, dados);
    await assert.rejects(() => manager.reconciliarNativeHost(id, dados, resultado), {
      code: 'HOST_UNAVAILABLE'
    });
    await assertLockedAndIdentity(manager, client, id, identity);
    return {
      status: (await obterTransacao(id)).status,
      marcador: client.getEstado().reconciliacaoPendente.transactionId,
      driverCalls: harness.runtimes[0].testDriverCalls
    };
  });

  await test('13 duas reconciliações concorrentes não sobrescrevem resultado', async () => {
    const harness = novoManager('concurrent');
    const { manager, client } = harness;
    const { id, identity } = await inserirPendente('concurrent');
    const unknown = await iniciarUnknown(harness, id);
    assert.strictEqual(unknown.financialState, FINANCIAL_STATES.UNKNOWN);
    const outcomes = await Promise.allSettled([
      persistirRecon(manager, id, dadosReconciliacao({ usuario: 'operador-a' })),
      persistirRecon(manager, id, dadosReconciliacao({ usuario: 'operador-b' }))
    ]);
    assert.strictEqual(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
    assert.strictEqual(outcomes.filter((item) => item.status === 'rejected').length, 1);
    await assertLockedAndIdentity(manager, client, id, identity);
    const row = await obterTransacao(id);
    assert.ok(['operador-a', 'operador-b'].includes(row.payload_retorno.reconciliacao.usuario));
    return { acceptedReconciliations: 1, finalOperator: row.payload_retorno.reconciliacao.usuario };
  });

  await test('14 reinicialização do processo principal reconstrói trava e identidade', async () => {
    const harness = novoManager('restart-main');
    const { manager, client } = harness;
    const { id, identity } = await inserirPendente('restart-main');
    await manager.garantirRecuperacao();
    const recoveredManager = new TefManager({ recuperarNoInicio: false, nativeHostClient: client });
    await recoveredManager.garantirRecuperacao();
    const recovered = recoveredManager._pendencias.get(id);
    assert.ok(recovered);
    assert.strictEqual(recovered.financialState, FINANCIAL_STATES.UNKNOWN);
    assert.strictEqual(recovered.recuperacao.idempotency_key, identity.idempotency_key);
    assert.strictEqual(recovered.recuperacao.operation_id, identity.operation_id);
    assert.strictEqual(await client.iniciar(), true);
    assert.deepStrictEqual(harness.runtimes[0].status().blockedFinancialIdentities, [id]);
    assert.deepStrictEqual(harness.runtimes[0].testDriverCalls, { inicia: 0, continua: 0, finaliza: 0 });
    return {
      transactionId: id,
      financialState: recovered.financialState,
      identityRecovered: true,
      bootstrapState: client.getEstado().securityBootstrapState,
      driverCalls: harness.runtimes[0].testDriverCalls
    };
  });

  await test('15 transação ainda pendente após reinício não é liberada automaticamente', async () => {
    const harness = novoManager('restart-pending');
    const { manager, client } = harness;
    const { id, identity } = await inserirPendente('restart-pending');
    await manager.garantirRecuperacao();
    await assertLockedAndIdentity(manager, client, id, identity);
    assert.strictEqual(await client.iniciar(), true);
    assert.deepStrictEqual(harness.runtimes[0].status().blockedFinancialIdentities, [id]);
    assert.deepStrictEqual(harness.runtimes[0].testDriverCalls, { inicia: 0, continua: 0, finaliza: 0 });
    return {
      status: (await obterTransacao(id)).status,
      retryAutomatico: false,
      blockedIdentity: id,
      driverCalls: harness.runtimes[0].testDriverCalls
    };
  });

  await test('16 TX_START, TX_CONTINUE e TX_FINALIZE bloqueados enquanto UNKNOWN', async () => {
    const driverCalls = { inicia: 0, continua: 0, finaliza: 0 };
    const host = novoHost(CHAVE_PUBLICA_BOOTSTRAP_TESTE, driverCalls);
    const bootstrap = aplicarBootstrap(host, criarBootstrap(host, {
      operation: OPERACOES_HOST.TX_START,
      transactionId: 'mrt47-block-all'
    }));
    assert.strictEqual(bootstrap.output.securityState, ESTADOS_BOOTSTRAP.VALIDATED);
    const started = host._processar(criarRequest(
      OPERACOES_HOST.TX_START,
      { operacao: 'CRT', campos: {} },
      'mrt47-block-all'
    ));
    assert.strictEqual(started.output.financialState, FINANCIAL_STATES.UNKNOWN);
    const continued = host._processar(requisicaoHost(host,
      OPERACOES_HOST.TX_CONTINUE,
      { resposta: {} },
      'mrt47-block-all'
    ));
    const finalized = host._processar(requisicaoHost(host,
      OPERACOES_HOST.TX_FINALIZE,
      { confirmacao: 0 },
      'mrt47-block-all'
    ));
    const secondStart = host._processar(requisicaoHost(host,
      OPERACOES_HOST.TX_START,
      { operacao: 'CRT', campos: {} },
      'mrt47-block-second'
    ));
    assert.strictEqual(continued.error.code, 'HOST_RECONCILIATION_PENDING');
    assert.strictEqual(finalized.error.code, 'HOST_RECONCILIATION_PENDING');
    assert.strictEqual(secondStart.error.code, 'HOST_SECURITY_OPERATION_BLOCKED');
    assert.deepStrictEqual(driverCalls, { inicia: 1, continua: 0, finaliza: 0 });
    assert.strictEqual(host.bridge.getTransacaoContexto().transactionId, 'mrt47-block-all');
    return { driverCalls, transactionId: host.bridge.getTransacaoContexto().transactionId };
  });

  if (resultados.some((item) => item.resultado === 'FALHOU')) {
    console.error(JSON.stringify({ sucesso: false, resultados }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({
      sucesso: true,
      gateFinanceiro: transacaoRealHabilitada(),
      bancoTemporario: database.dbPath,
      dllCarregada: false,
      operacaoFinanceiraReal: false,
      resultados
    }, null, 2));
  }
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
