'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mrt50-2-tef-'));
process.env.DB_DIR = TEST_DB_DIR;
process.env.NODE_ENV = 'test';
process.env.TEF_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';

const database = require('../../backend/database');
const repository = require('../../backend/services/tef/tefRepository');
const TefManagerModule = require('../../backend/services/tef/TefManager');
const TefManager = TefManagerModule.TefManager;
const {
  EVENTO_LIBERACAO,
  EVENTO_COMMIT,
  assinarEvidencia,
  validarEvidencia
} = require('../../backend/services/tef/tefReconciliationEvidence');
const {
  OPERACOES_HOST,
  criarRequest,
  validarBootstrapSeguranca,
  validarAutorizacaoReconciliacao
} = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const { DestaxaNativeHostRuntime } = require('../../backend/services/tef/destaxa/DestaxaNativeHost');
const DestaxaTransacaoOrquestrador = require('../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');
const { transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');

const resultados = [];
const identidadeBase = (tag) => ({
  operation_id: `mrt502-op-${tag}`,
  idempotency_key: `mrt502-idem-${tag}`,
  fingerprint: `mrt502-fp-${tag}`
});

class MockNativeHostClient {
  constructor(opcoes = {}) {
    this.publicKey = null;
    this.provedor = null;
    this.hostSessionId = 'mrt502-native-host';
    this.pending = null;
    this.failCommit = opcoes.failCommit === true;
    this.failBootstrap = opcoes.failBootstrap === true;
    this.commitCalls = 0;
    this.bootstrapCalls = 0;
  }

  configurarChavePublicaReconciliacao(publicKey) {
    this.publicKey = publicKey;
  }

  configurarProvedorBootstrapSeguranca(provider) {
    this.provedor = provider;
  }

  getEstado() {
    return { reconciliacaoPendente: this.pending };
  }

  marcarReconciliacaoPendente(transactionId) {
    this.pending = { transactionId: String(transactionId) };
    return true;
  }

  async prepararHostParaReconciliacao(transactionId) {
    this.marcarReconciliacaoPendente(transactionId);
    return { sucesso: true, hostSessionId: this.hostSessionId };
  }

  async reconciliarTransacao(transactionId, authorization) {
    const claims = validarAutorizacaoReconciliacao(
      authorization,
      this.publicKey,
      this.hostSessionId
    );
    if (!claims || claims.phase !== 'release' || claims.transactionId !== String(transactionId)) {
      return { sucesso: false, codigo: 'HOST_RECONCILIATION_PENDING' };
    }
    return { sucesso: true, transactionId: String(transactionId) };
  }

  confirmarReconciliacaoPersistida(authorization) {
    this.commitCalls += 1;
    const claims = validarAutorizacaoReconciliacao(
      authorization,
      this.publicKey,
      this.hostSessionId
    );
    if (this.failCommit || !claims || claims.phase !== 'commit') {
      return { sucesso: false, codigo: 'HOST_RECONCILIATION_PENDING' };
    }
    this.pending = null;
    return { sucesso: true, transactionId: claims.transactionId };
  }

  async atualizarBootstrapSeguranca() {
    this.bootstrapCalls += 1;
    if (this.failBootstrap) {
      return { sucesso: false, codigo: 'HOST_SECURITY_BOOTSTRAP_REQUIRED' };
    }
    const authorization = await this.provedor({
      hostSessionId: this.hostSessionId,
      revision: 1
    });
    const claims = validarBootstrapSeguranca(
      authorization,
      this.publicKey,
      this.hostSessionId,
      1
    );
    return claims
      ? { sucesso: true, securityState: claims.securityState, revision: claims.revision }
      : { sucesso: false, codigo: 'HOST_SECURITY_BOOTSTRAP_INVALID' };
  }
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function onComplete(error) {
      if (error) return reject(error);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows || [])));
  });
}

function registrarTransacao(dados, tag) {
  return new Promise((resolve, reject) => {
    const identidade = identidadeBase(tag);
    repository.criarTransacao({
      tipo: 'CRT',
      valor: 1,
      status: 'pendente',
      provedor: 'DESTAXA',
      codigo_transacao: identidade.operation_id,
      idempotency_key: identidade.idempotency_key,
      payload_retorno: {
        financialState: FINANCIAL_STATES.UNKNOWN,
        persistencia: { ...identidade, estadoFinanceiroInicial: FINANCIAL_STATES.UNKNOWN }
      }
    }, (error, id) => (error ? reject(error) : resolve({ id: String(id), identidade, ...dados })));
  });
}

function novoManager(client = new MockNativeHostClient()) {
  return {
    manager: new TefManager({ recuperarNoInicio: false, nativeHostClient: client }),
    client
  };
}

function abrirTrava(manager, id) {
  manager._pendencias.set(String(id), {
    estado: TefManagerModule.ESTADOS_TRAVA_RESULTADO_TARDIO.RECONCILIACAO_PENDENTE,
    financialState: FINANCIAL_STATES.UNKNOWN,
    resultadoTardio: { financialState: FINANCIAL_STATES.UNKNOWN, codigo: 'F1' }
  });
}

function dadosReconciliacao() {
  return {
    financialState: FINANCIAL_STATES.CONFIRMED_DENIED,
    usuario: 'mrt502-operador-teste',
    observacao: 'reconciliacao simulada isolada',
    confirmacao_explicita: true
  };
}

async function obterTransacao(id) {
  return new Promise((resolve, reject) => {
    repository.obterTransacaoPorId(id, (error, row) => (error ? reject(error) : resolve(row)));
  });
}

async function obterEventos(id, tipo) {
  return dbAll(
    'SELECT id, transacao_id, tipo, payload, criado_em FROM tef_logs WHERE transacao_id = ? AND tipo = ? ORDER BY id',
    [id, tipo]
  );
}

async function concluirReconciliacao(tag, opcoes = {}) {
  const { manager, client } = novoManager(new MockNativeHostClient(opcoes));
  const { id, identidade } = await registrarTransacao({}, tag);
  abrirTrava(manager, id);
  const dados = dadosReconciliacao();
  const resultado = await manager.reconciliarResultadoTardio(id, dados);
  let erro = null;
  try {
    await manager.reconciliarNativeHost(id, dados, resultado);
  } catch (error) {
    erro = error;
  }
  return { manager, client, id, identidade, dados, resultado, erro };
}

function hostSimulado(publicKey) {
  const chamadas = { inicia: 0, continua: 0, finaliza: 0 };
  const driver = {
    iniciaTransacaoDestaxa() {
      chamadas.inicia += 1;
      return { codigo: 'F1', saida: '' };
    },
    continuaTransacaoDestaxa() {
      chamadas.continua += 1;
      return { codigo: '00', saida: '' };
    },
    finalizaTransacaoDestaxa() {
      chamadas.finaliza += 1;
      return { codigo: '00', saida: '' };
    }
  };
  const orquestrador = new DestaxaTransacaoOrquestrador({ driver });
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
    reconciliationPublicKey: publicKey,
    encerrarProcesso: () => {}
  });
  return { host, chamadas };
}

async function afirmarBloqueadoSemDriver(manager, client, id) {
  await manager.recarregarPendencias();
  assert.ok(manager._pendencias.has(String(id)), 'a evidência incompleta deve manter a trava');
  const { host, chamadas } = hostSimulado(client.publicKey);
  const bootstrap = await manager._criarBootstrapSeguranca({
    hostSessionId: host.hostSessionId,
    revision: 1
  });
  const aplicado = host._processar(criarRequest(
    OPERACOES_HOST.SECURITY_BOOTSTRAP,
    { autorizacao: bootstrap }
  ));
  assert.strictEqual(aplicado.error, null);
  assert.ok(
    host._blockedFinancialIdentities.has(String(id)),
    'o bootstrap deve reter a identidade com evidência inválida'
  );
  const resposta = host._processar(criarRequest(
    OPERACOES_HOST.TX_START,
    { operacao: 'CRT', campos: { transacao_valor: '1.00' } },
    `mrt502-start-${id}`
  ));
  assert.ok(resposta.error, 'TX_START deve ser recusado');
  assert.deepStrictEqual(chamadas, { inicia: 0, continua: 0, finaliza: 0 });
  return chamadas;
}

async function adulterarEvento(id, tipo, mutacao) {
  const [row] = await obterEventos(id, tipo);
  assert.ok(row, `evento ${tipo} esperado`);
  const evidence = JSON.parse(row.payload);
  const altered = mutacao(evidence);
  const serialized = typeof altered === 'string' ? altered : JSON.stringify(altered);
  await dbRun('UPDATE tef_logs SET payload = ? WHERE id = ?', [serialized, row.id]);
}

async function test(nome, fn) {
  try {
    const evidencias = await fn();
    resultados.push({ nome, resultado: 'PASSOU', evidencias: evidencias || null });
  } catch (error) {
    resultados.push({ nome, resultado: 'FALHOU', erro: error.stack || error.message });
  }
}

async function main() {
  const limite = Date.now() + 30000;
  while (!database.isReady()) {
    if (Date.now() >= limite) throw new Error('SQLite temporário MRT-50.2 não ficou pronto');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.strictEqual(transacaoRealHabilitada(), false);
  assert.ok(path.resolve(database.dbDir).startsWith(path.resolve(os.tmpdir())));
  assert.notStrictEqual(
    path.resolve(database.dbPath),
    path.resolve(path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados', 'mercadao.db'))
  );

  await test('1 evidência válida recuperada após reinício do TefManager', async () => {
    const completed = await concluirReconciliacao('valid');
    assert.ifError(completed.erro);
    const recovered = novoManager().manager;
    await recovered.recarregarPendencias();
    assert.ok(!recovered._pendencias.has(completed.id));
    const { host } = hostSimulado(completed.client.publicKey);
    const bootstrap = await recovered._criarBootstrapSeguranca({
      hostSessionId: host.hostSessionId,
      revision: 1
    });
    const claims = validarBootstrapSeguranca(
      bootstrap,
      completed.client.publicKey,
      host.hostSessionId,
      1
    );
    assert.ok(claims);
    assert.ok(!claims.blockedIdentities.some((identity) => identity.transactionId === completed.id));
    const applied = host._processar(criarRequest(
      OPERACOES_HOST.SECURITY_BOOTSTRAP,
      { autorizacao: bootstrap }
    ));
    assert.strictEqual(applied.error, null);
    assert.ok(!host._blockedFinancialIdentities.has(completed.id));
    return { transactionId: completed.id, proofVersion: 1, bloqueada: false };
  });

  await test('2 evidência vinculada à transacao_id, transactionId e quatro identificadores', async () => {
    const completed = await concluirReconciliacao('identity-match');
    assert.ifError(completed.erro);
    const [release] = await obterEventos(completed.id, EVENTO_LIBERACAO);
    const [commit] = await obterEventos(completed.id, EVENTO_COMMIT);
    const releaseClaims = validarEvidencia(JSON.parse(release.payload), EVENTO_LIBERACAO);
    const commitClaims = validarEvidencia(JSON.parse(commit.payload), EVENTO_COMMIT);
    assert.ok(releaseClaims && commitClaims);
    assert.strictEqual(releaseClaims.transacao_id, completed.id);
    assert.strictEqual(releaseClaims.transactionId, completed.id);
    assert.strictEqual(releaseClaims.operation_id, completed.identidade.operation_id);
    assert.strictEqual(releaseClaims.idempotency_key, completed.identidade.idempotency_key);
    assert.strictEqual(releaseClaims.fingerprint, completed.identidade.fingerprint);
    assert.strictEqual(commitClaims.releaseEvidenceId, releaseClaims.evidenceId);
    assert.ok(Number.isFinite(Date.parse(releaseClaims.timestamp)));
    return { releaseTimestamp: releaseClaims.timestamp, commitTimestamp: commitClaims.timestamp };
  });

  for (const [testNum, campo, valor] of [
    [3, 'operation_id', 'outra-operation'],
    [4, 'idempotency_key', 'outra-idempotency'],
    [5, 'fingerprint', 'outro-fingerprint']
  ]) {
    await test(`${testNum} evento assinado com ${campo} divergente mantém bloqueio`, async () => {
      const completed = await concluirReconciliacao(`wrong-${campo}`);
      assert.ifError(completed.erro);
      await adulterarEvento(completed.id, EVENTO_LIBERACAO, (event) => {
        event.claims[campo] = valor;
        return assinarEvidencia(event.claims);
      });
      const recovered = novoManager().manager;
      const chamadas = await afirmarBloqueadoSemDriver(recovered, recovered._nativeHostClient, completed.id);
      return { transactionId: completed.id, campo, chamadas };
    });
  }

  await test('6 transacao_id divergente da identidade assinada mantém bloqueio', async () => {
    const completed = await concluirReconciliacao('wrong-transacao-id');
    assert.ifError(completed.erro);
    const [release] = await obterEventos(completed.id, EVENTO_LIBERACAO);
    await dbRun('UPDATE tef_logs SET transacao_id = ? WHERE id = ?', [
      `wrong-${completed.id}`,
      release.id
    ]);
    const recovered = novoManager().manager;
    const chamadas = await afirmarBloqueadoSemDriver(recovered, recovered._nativeHostClient, completed.id);
    return { transactionId: completed.id, chamadas };
  });

  await test('7 assinatura adulterada mantém bloqueio e não alcança driver', async () => {
    const completed = await concluirReconciliacao('bad-signature');
    assert.ifError(completed.erro);
    await adulterarEvento(completed.id, EVENTO_LIBERACAO, (event) => ({
      ...event,
      signature: `${event.signature[0] === 'A' ? 'B' : 'A'}${event.signature.slice(1)}`
    }));
    const recovered = novoManager().manager;
    const chamadas = await afirmarBloqueadoSemDriver(recovered, recovered._nativeHostClient, completed.id);
    return { transactionId: completed.id, chamadas };
  });

  await test('8 timestamp ausente e inválido são recusados', async () => {
    const absent = await concluirReconciliacao('timestamp-absent');
    assert.ifError(absent.erro);
    await adulterarEvento(absent.id, EVENTO_LIBERACAO, (event) => {
      delete event.claims.timestamp;
      return assinarEvidencia(event.claims);
    });
    const absentManager = novoManager().manager;
    await afirmarBloqueadoSemDriver(absentManager, absentManager._nativeHostClient, absent.id);

    const invalid = await concluirReconciliacao('timestamp-invalid');
    assert.ifError(invalid.erro);
    await adulterarEvento(invalid.id, EVENTO_LIBERACAO, (event) => {
      event.claims.timestamp = 'yesterday';
      return assinarEvidencia(event.claims);
    });
    const invalidManager = novoManager().manager;
    const chamadas = await afirmarBloqueadoSemDriver(invalidManager, invalidManager._nativeHostClient, invalid.id);
    return { timestamps: ['ausente', 'inválido'], chamadas };
  });

  await test('9 evidência ausente mantém identidade bloqueada', async () => {
    const completed = await concluirReconciliacao('missing-evidence');
    assert.ifError(completed.erro);
    await dbRun('DELETE FROM tef_logs WHERE transacao_id = ? AND tipo IN (?, ?)', [
      completed.id,
      EVENTO_LIBERACAO,
      EVENTO_COMMIT
    ]);
    const recovered = novoManager().manager;
    const chamadas = await afirmarBloqueadoSemDriver(recovered, recovered._nativeHostClient, completed.id);
    return { transactionId: completed.id, chamadas };
  });

  await test('10 evidência duplicada ou conflitante mantém identidade bloqueada', async () => {
    const duplicate = await concluirReconciliacao('duplicate-evidence');
    assert.ifError(duplicate.erro);
    const [release] = await obterEventos(duplicate.id, EVENTO_LIBERACAO);
    await dbRun(
      'INSERT INTO tef_logs (transacao_id, tipo, mensagem, payload, criado_em) VALUES (?, ?, ?, ?, datetime(\'now\'))',
      [duplicate.id, EVENTO_LIBERACAO, 'duplicata de teste', release.payload]
    );
    const recovered = novoManager().manager;
    await afirmarBloqueadoSemDriver(recovered, recovered._nativeHostClient, duplicate.id);

    const conflict = await concluirReconciliacao('conflicting-evidence');
    assert.ifError(conflict.erro);
    const [original] = await obterEventos(conflict.id, EVENTO_LIBERACAO);
    const conflictPayload = JSON.parse(original.payload);
    conflictPayload.claims.evidenceId = crypto.randomBytes(16).toString('hex');
    const conflicting = assinarEvidencia(conflictPayload.claims);
    await dbRun(
      'INSERT INTO tef_logs (transacao_id, tipo, mensagem, payload, criado_em) VALUES (?, ?, ?, ?, datetime(\'now\'))',
      [conflict.id, EVENTO_LIBERACAO, 'conflito de teste', JSON.stringify(conflicting)]
    );
    const conflictManager = novoManager().manager;
    const chamadas = await afirmarBloqueadoSemDriver(
      conflictManager,
      conflictManager._nativeHostClient,
      conflict.id
    );
    return { duplicata: duplicate.id, conflito: conflict.id, chamadas };
  });

  await test('11 falha na gravação da evidência conserva a trava', async () => {
    const { manager, client } = novoManager();
    const { id } = await registrarTransacao({}, 'release-write-failure');
    abrirTrava(manager, id);
    const resultado = await manager.reconciliarResultadoTardio(id, dadosReconciliacao());
    const original = repository.registrarLog;
    repository.registrarLog = (transacaoId, tipo, mensagem, payload, callback) => {
      if (tipo === EVENTO_LIBERACAO) {
        return setImmediate(() => callback(new Error('falha simulada de gravação RELEASE')));
      }
      return original(transacaoId, tipo, mensagem, payload, callback);
    };
    try {
      await assert.rejects(() => manager.reconciliarNativeHost(id, dadosReconciliacao(), resultado), /falha simulada/);
    } finally {
      repository.registrarLog = original;
    }
    assert.ok(manager._pendencias.has(id));
    assert.strictEqual(client.commitCalls, 0);
    const recovered = novoManager().manager;
    const chamadas = await afirmarBloqueadoSemDriver(recovered, recovered._nativeHostClient, id);
    const { manager: secondManager, client: secondClient } = novoManager();
    const second = await registrarTransacao({}, 'commit-proof-write-failure');
    abrirTrava(secondManager, second.id);
    const secondResult = await secondManager.reconciliarResultadoTardio(second.id, dadosReconciliacao());
    const originalSecond = repository.registrarLog;
    repository.registrarLog = (transacaoId, tipo, mensagem, payload, callback) => {
      if (tipo === EVENTO_COMMIT) {
        return setImmediate(() => callback(new Error('falha simulada de gravação COMMIT')));
      }
      return originalSecond(transacaoId, tipo, mensagem, payload, callback);
    };
    try {
      await assert.rejects(() =>
        secondManager.reconciliarNativeHost(second.id, dadosReconciliacao(), secondResult), /falha simulada/);
    } finally {
      repository.registrarLog = originalSecond;
    }
    assert.ok(secondManager._pendencias.has(second.id));
    assert.strictEqual(secondClient.bootstrapCalls, 0);
    const secondRecovered = novoManager().manager;
    const secondCalls = await afirmarBloqueadoSemDriver(
      secondRecovered,
      secondRecovered._nativeHostClient,
      second.id
    );
    return {
      transactionId: id,
      commits: client.commitCalls,
      chamadas,
      commitEvidenceWriteFailure: { transactionId: second.id, chamadas: secondCalls }
    };
  });

  await test('12 falha entre RELEASE e COMMIT mantém bloqueio', async () => {
    const completed = await concluirReconciliacao('commit-failure', { failCommit: true });
    assert.ok(completed.erro);
    assert.strictEqual(completed.client.commitCalls, 1);
    assert.strictEqual(completed.client.bootstrapCalls, 0);
    assert.ok(completed.manager._pendencias.has(completed.id));
    const recovered = novoManager().manager;
    const chamadas = await afirmarBloqueadoSemDriver(recovered, recovered._nativeHostClient, completed.id);
    return { transactionId: completed.id, chamadas };
  });

  await test('13 falha entre COMMIT e bootstrap não remove bloqueio em memória', async () => {
    const completed = await concluirReconciliacao('bootstrap-failure', { failBootstrap: true });
    assert.ok(completed.erro);
    assert.strictEqual(completed.client.commitCalls, 1);
    assert.strictEqual(completed.client.bootstrapCalls, 1);
    assert.ok(completed.manager._pendencias.has(completed.id));
    await completed.manager.recarregarPendencias();
    assert.ok(completed.manager._pendencias.has(completed.id));
    completed.client.failBootstrap = false;
    const retryResult = await completed.manager.reconciliarResultadoTardio(
      completed.id,
      completed.dados
    );
    const retried = await completed.manager.reconciliarNativeHost(
      completed.id,
      completed.dados,
      retryResult
    );
    assert.strictEqual(retried.travaLiberada, true);
    assert.ok(!completed.manager._pendencias.has(completed.id));
    assert.strictEqual(completed.client.commitCalls, 1);
    assert.strictEqual(completed.client.bootstrapCalls, 2);
    return {
      transactionId: completed.id,
      commitConfirmado: true,
      bootstrapRetentadoSemNovoCommit: true,
      travaRemovidaAposBootstrap: true
    };
  });

  await test('14 prova completa continua verificável após reinício do processo', async () => {
    const currentPublicKey = novoManager().client.publicKey;
    const script = [
      "const { obterChavePublica } = require('./backend/services/tef/tefReconciliationEvidence');",
      'process.stdout.write(obterChavePublica());'
    ].join('');
    const restartedPublicKey = execFileSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env },
      encoding: 'utf8'
    }).trim();
    assert.strictEqual(restartedPublicKey, currentPublicKey);
    return { chavePublicaEstavel: true };
  });

  await test('15 identidade inválida após reinício permanece bloqueada e TX_START não chama driver', async () => {
    const completed = await concluirReconciliacao('restart-invalid');
    assert.ifError(completed.erro);
    await adulterarEvento(completed.id, EVENTO_COMMIT, (event) => ({
      ...event,
      signature: `${event.signature.slice(0, -1)}${event.signature.endsWith('A') ? 'B' : 'A'}`
    }));
    const restartedManager = novoManager().manager;
    const chamadas = await afirmarBloqueadoSemDriver(
      restartedManager,
      restartedManager._nativeHostClient,
      completed.id
    );
    return { transactionId: completed.id, chamadas };
  });

  await test('16 falha entre COMMIT e bootstrap recupera somente após novo bootstrap assinado', async () => {
    const completed = await concluirReconciliacao('bootstrap-retry', { failBootstrap: true });
    assert.ok(completed.erro);
    const recoveredClient = new MockNativeHostClient();
    const recovered = novoManager(recoveredClient).manager;
    await recovered.recarregarPendencias();
    assert.ok(!recovered._pendencias.has(completed.id));
    const bootstrap = await recovered._criarBootstrapSeguranca({
      hostSessionId: recoveredClient.hostSessionId,
      revision: 1
    });
    const claims = validarBootstrapSeguranca(
      bootstrap,
      recoveredClient.publicKey,
      recoveredClient.hostSessionId,
      1
    );
    assert.ok(claims);
    assert.ok(!claims.blockedIdentities.some((identity) => identity.transactionId === completed.id));
    return { transactionId: completed.id, bootstrapAssinado: true, identityOmittedAfterValidation: true };
  });

  if (resultados.some((item) => item.resultado === 'FALHOU')) {
    console.error(JSON.stringify({
      sucesso: false,
      bancoEfetivo: database.dbPath,
      gateFinanceiro: transacaoRealHabilitada(),
      dllCarregada: false,
      resultados
    }, null, 2));
    process.exitCode = 1;
  } else {
    const stat = fs.statSync(database.dbPath);
    console.log(JSON.stringify({
      sucesso: true,
      bancoEfetivo: database.dbPath,
      identificacaoBanco: { size: stat.size, modifiedAt: stat.mtime.toISOString() },
      gateFinanceiro: transacaoRealHabilitada(),
      dllCarregada: false,
      chamadasFinanceirasReais: 0,
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
