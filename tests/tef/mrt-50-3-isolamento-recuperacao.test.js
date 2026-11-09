'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mrt50-3-tef-'));
process.env.DB_DIR = TEST_DB_DIR;
process.env.NODE_ENV = 'test';
process.env.TEF_ENCRYPTION_KEY = 'c'.repeat(64);
process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';

const database = require('../../backend/database');
const repository = require('../../backend/services/tef/tefRepository');
const TefManagerModule = require('../../backend/services/tef/TefManager');
const TefManager = TefManagerModule.TefManager;
const {
  EVENTO_LIBERACAO,
  EVENTO_COMMIT,
  assinarEvidencia,
  obterChavePublica,
  validarEvidencia
} = require('../../backend/services/tef/tefReconciliationEvidence');
const {
  DestaxaNativeHostClient
} = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
const {
  OPERACOES_HOST,
  criarRequest,
  validarAutorizacaoReconciliacao
} = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const { DestaxaNativeHostRuntime } = require('../../backend/services/tef/destaxa/DestaxaNativeHost');
const DestaxaTransacaoOrquestrador = require('../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');
const { transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');

const resultados = [];
let sequenciaTeste = 0;

class MockNativeHostClient {
  constructor() {
    this.publicKey = null;
    this.provedor = null;
    this.hostSessionId = 'mrt50-3-native-host';
    this.pending = null;
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
    const claims = validarAutorizacaoReconciliacao(
      authorization,
      this.publicKey,
      this.hostSessionId
    );
    if (!claims || claims.phase !== 'commit' || !this.pending
      || this.pending.transactionId !== claims.transactionId) {
      return { sucesso: false, codigo: 'HOST_RECONCILIATION_PENDING' };
    }
    this.pending = null;
    return { sucesso: true, transactionId: claims.transactionId };
  }

  async atualizarBootstrapSeguranca() {
    const authorization = await this.provedor({
      hostSessionId: this.hostSessionId,
      revision: 1
    });
    return authorization
      ? { sucesso: true, revision: 1 }
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
    database.all(sql, params, (error, rows) =>
      (error ? reject(error) : resolve(rows || [])));
  });
}

function obterTransacao(id) {
  return new Promise((resolve, reject) => {
    repository.obterTransacaoPorId(id, (error, row) =>
      (error ? reject(error) : resolve(row)));
  });
}

function obterEventos(id, tipo) {
  return dbAll(
    'SELECT id, transacao_id, tipo, payload, criado_em FROM tef_logs WHERE transacao_id = ? AND tipo = ? ORDER BY id',
    [id, tipo]
  );
}

function identidadePara(tag) {
  return {
    operation_id: `mrt503-op-${tag}`,
    idempotency_key: `mrt503-idem-${tag}`,
    fingerprint: `mrt503-fingerprint-${tag}`
  };
}

function registrarTransacao(tag) {
  const identidade = identidadePara(tag);
  return new Promise((resolve, reject) => {
    repository.criarTransacao({
      tipo: 'TEST_ONLY',
      valor: 0,
      status: 'pendente',
      provedor: 'SIMULADO',
      codigo_transacao: identidade.operation_id,
      idempotency_key: identidade.idempotency_key,
      payload_retorno: {
        financialState: FINANCIAL_STATES.UNKNOWN,
        persistencia: { ...identidade, estadoFinanceiroInicial: FINANCIAL_STATES.UNKNOWN }
      }
    }, (error, id) => (error ? reject(error) : resolve({ id: String(id), identidade })));
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
    resultadoTardio: { financialState: FINANCIAL_STATES.UNKNOWN, codigo: 'SIMULADO' }
  });
}

function dadosReconciliacao() {
  return {
    financialState: FINANCIAL_STATES.CONFIRMED_DENIED,
    usuario: 'mrt50-3-operador-teste',
    observacao: 'evidencia simulada em SQLite temporario',
    confirmacao_explicita: true
  };
}

async function concluirReconciliacao(tag) {
  const { manager, client } = novoManager();
  const { id, identidade } = await registrarTransacao(`${tag}-${++sequenciaTeste}`);
  abrirTrava(manager, id);
  const dados = dadosReconciliacao();
  const resultado = await manager.reconciliarResultadoTardio(id, dados);
  const liberacao = await manager.reconciliarNativeHost(id, dados, resultado);
  assert.strictEqual(liberacao.travaLiberada, true);
  return { manager, client, id, identidade };
}

async function adulterarAssinatura(id, tipo) {
  const [row] = await obterEventos(id, tipo);
  assert.ok(row, `evento ${tipo} esperado`);
  const payload = JSON.parse(row.payload);
  payload.signature = `${payload.signature.slice(0, -1)}${payload.signature.endsWith('A') ? 'B' : 'A'}`;
  await dbRun('UPDATE tef_logs SET payload = ? WHERE id = ?', [JSON.stringify(payload), row.id]);
}

async function prepararHostBloqueado(manager, publicKey, id) {
  const chamadas = { inicia: 0, continua: 0, finaliza: 0 };
  const driver = {
    iniciaTransacaoDestaxa() {
      chamadas.inicia += 1;
      return { codigo: '00', saida: '' };
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
    iniciarTransacaoDestaxa: (...args) => orquestrador.iniciarTransacao(...args),
    continuarTransacaoDestaxa: (...args) => orquestrador.continuarTransacao(...args),
    finalizarTransacaoDestaxa: (...args) => orquestrador.finalizarTransacao(...args),
    isLoaded: () => false,
    getDiagnostics: () => ({ dllLoaded: false })
  };
  const host = new DestaxaNativeHostRuntime({
    bridge,
    modoTeste: true,
    reconciliationPublicKey: publicKey,
    encerrarProcesso: () => {}
  });
  const bootstrap = await manager._criarBootstrapSeguranca({
    hostSessionId: host.hostSessionId,
    revision: 1
  });
  const applied = host._processar(criarRequest(
    OPERACOES_HOST.SECURITY_BOOTSTRAP,
    { autorizacao: bootstrap }
  ));
  assert.strictEqual(applied.error, null);
  assert.ok(host._blockedFinancialIdentities.has(String(id)));

  const response = host._processar(criarRequest(
    OPERACOES_HOST.TX_START,
    { operacao: 'MRT50_3_BLOCKED_PROBE', campos: {} },
    `mrt503-probe-${id}`
  ));
  assert.ok(response.error, 'TX_START simulado deve ser recusado');
  assert.deepStrictEqual(chamadas, { inicia: 0, continua: 0, finaliza: 0 });
  return chamadas;
}

async function registrarTeste(nome, executar) {
  try {
    resultados.push({
      nome,
      resultado: 'PASSOU',
      evidencias: await executar()
    });
  } catch (error) {
    resultados.push({
      nome,
      resultado: 'FALHOU',
      erro: error.stack || error.message
    });
  }
}

async function executar() {
  const limite = Date.now() + 30000;
  while (!database.isReady()) {
    if (Date.now() >= limite) throw new Error('SQLite temporário MRT-50.3 não ficou pronto');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.strictEqual(transacaoRealHabilitada(), false);
  assert.ok(path.resolve(database.dbDir).startsWith(path.resolve(os.tmpdir())));

  let ambienteDoSpawner = null;
  const clienteEnv = new DestaxaNativeHostClient({
    env: {
      NODE_ENV: 'test',
      TEF_ENCRYPTION_KEY: 'f'.repeat(64),
      NODE_OPTIONS: '--require nao-deve-ser-propagado'
    },
    spawner(_hostPath, env) {
      ambienteDoSpawner = env;
      throw new Error('fim do teste de captura do ambiente');
    }
  });
  clienteEnv.configurarChavePublicaReconciliacao(obterChavePublica());
  await clienteEnv.iniciar();

  await registrarTeste('1 NativeHost recebe ambiente sem TEF_ENCRYPTION_KEY', async () => {
    assert.ok(ambienteDoSpawner);
    assert.strictEqual(ambienteDoSpawner.TEF_ENCRYPTION_KEY, undefined);
    assert.strictEqual(ambienteDoSpawner.NODE_OPTIONS, undefined);
    assert.strictEqual(ambienteDoSpawner.DESTAXA_RECONCILIATION_PUBLIC_KEY, obterChavePublica());
    assert.strictEqual(ambienteDoSpawner.DESTAXA_REAL_TRANSACTION_ENABLED, '0');
    assert.deepStrictEqual(
      Object.keys(ambienteDoSpawner).sort(),
      [
        'DESTAXA_NATIVE_HOST_ENTRY',
        'DESTAXA_NATIVE_HOST_TEST_MODE',
        'DESTAXA_NATIVE_HOST_TRIPWIRE',
        'DESTAXA_REAL_TRANSACTION_ENABLED',
        'DESTAXA_RECONCILIATION_PUBLIC_KEY',
        'NODE_ENV',
        'PATH',
        'SYSTEMDRIVE',
        'SYSTEMROOT',
        'TEMP',
        'TMP',
        'WINDIR'
      ].filter((key) => Object.prototype.hasOwnProperty.call(ambienteDoSpawner, key)).sort()
    );
    return {
      segredoTransmitido: false,
      chavePublicaTransmitida: true,
      gateNoFilho: ambienteDoSpawner.DESTAXA_REAL_TRANSACTION_ENABLED
    };
  });

  await registrarTeste('2 processo filho não deriva nem assina com a chave confiável', async () => {
    const script = [
      "try { require('./backend/services/tef/tefReconciliationEvidence');",
      "process.stdout.write('SIGNER_AVAILABLE');",
      "} catch (error) {",
      "process.stdout.write(error.message.includes('NativeHost') ? 'SIGNER_UNAVAILABLE' : 'UNEXPECTED_ERROR');",
      '}'
    ].join('');
    const resultado = execFileSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '../..'),
      env: ambienteDoSpawner,
      encoding: 'utf8'
    });
    assert.strictEqual(resultado, 'SIGNER_UNAVAILABLE');
    return { signerConfiavelDisponivelNoFilho: false };
  });

  await registrarTeste('3 TefManager valida assinaturas legítimas persistidas', async () => {
    const completed = await concluirReconciliacao('valid-signature');
    const [releaseRow] = await obterEventos(completed.id, EVENTO_LIBERACAO);
    const [commitRow] = await obterEventos(completed.id, EVENTO_COMMIT);
    assert.ok(validarEvidencia(JSON.parse(releaseRow.payload), EVENTO_LIBERACAO));
    assert.ok(validarEvidencia(JSON.parse(commitRow.payload), EVENTO_COMMIT));
    const restarted = novoManager().manager;
    await restarted.recarregarPendencias();
    assert.ok(!restarted._pendencias.has(completed.id));
    return { transacao: completed.id, releaseValidado: true, commitValidado: true };
  });

  await registrarTeste('4 recuperação valida final com marcador de tentativa presente', async () => {
    const completed = await concluirReconciliacao('attempt-present');
    const recovered = novoManager().manager;
    await recovered.recarregarPendencias();
    assert.ok(!recovered._pendencias.has(completed.id));
    return { transacao: completed.id, marcadorPresente: true, bloqueada: false };
  });

  await registrarTeste('5 final sem marcador ainda é descoberta e validada', async () => {
    const completed = await concluirReconciliacao('attempt-missing');
    await dbRun(
      "DELETE FROM tef_logs WHERE transacao_id = ? AND tipo = 'RECONCILIACAO_RESULTADO_TARDIO'",
      [completed.id]
    );
    const recovered = novoManager().manager;
    await recovered.recarregarPendencias();
    assert.ok(!recovered._pendencias.has(completed.id));
    return { transacao: completed.id, marcadorPresente: false, provasValidas: true };
  });

  await registrarTeste('6 final sem RELEASE permanece bloqueada', async () => {
    const completed = await concluirReconciliacao('missing-release');
    await dbRun('DELETE FROM tef_logs WHERE transacao_id = ? AND tipo = ?', [
      completed.id,
      EVENTO_LIBERACAO
    ]);
    const recovered = novoManager().manager;
    await recovered.recarregarPendencias();
    assert.ok(recovered._pendencias.has(completed.id));
    const chamadas = await prepararHostBloqueado(recovered, recovered._nativeHostClient.publicKey, completed.id);
    return { transacao: completed.id, chamadasDriver: chamadas };
  });

  await registrarTeste('7 final sem COMMIT permanece bloqueada', async () => {
    const completed = await concluirReconciliacao('missing-commit');
    await dbRun('DELETE FROM tef_logs WHERE transacao_id = ? AND tipo = ?', [
      completed.id,
      EVENTO_COMMIT
    ]);
    const recovered = novoManager().manager;
    await recovered.recarregarPendencias();
    assert.ok(recovered._pendencias.has(completed.id));
    const chamadas = await prepararHostBloqueado(recovered, recovered._nativeHostClient.publicKey, completed.id);
    return { transacao: completed.id, chamadasDriver: chamadas };
  });

  await registrarTeste('8 prova assinada com identidade divergente permanece bloqueada', async () => {
    const completed = await concluirReconciliacao('signed-wrong-identity');
    const [row] = await obterEventos(completed.id, EVENTO_LIBERACAO);
    const evidence = JSON.parse(row.payload);
    evidence.claims.operation_id = 'operation-divergente';
    const changedEvidence = assinarEvidencia(evidence.claims);
    assert.ok(validarEvidencia(changedEvidence, EVENTO_LIBERACAO));
    await dbRun('UPDATE tef_logs SET payload = ? WHERE id = ?', [
      JSON.stringify(changedEvidence),
      row.id
    ]);
    const recovered = novoManager().manager;
    await recovered.recarregarPendencias();
    assert.ok(recovered._pendencias.has(completed.id));
    const chamadas = await prepararHostBloqueado(recovered, recovered._nativeHostClient.publicKey, completed.id);
    return { transacao: completed.id, assinaturaValidaIdentidadeDivergente: true, chamadasDriver: chamadas };
  });

  await registrarTeste('9 falha de consulta aborta recuperação e bootstrap', async () => {
    const completed = await concluirReconciliacao('query-failure');
    const recovered = novoManager().manager;
    const original = repository.listarTransacoesFinalizadas;
    repository.listarTransacoesFinalizadas = (callback) =>
      setImmediate(() => callback(new Error('falha simulada de consulta finalizada'), []));
    try {
      await assert.rejects(
        () => recovered.recarregarPendencias(),
        /falha simulada de consulta finalizada/
      );
      await assert.rejects(
        () => recovered._criarBootstrapSeguranca({
          hostSessionId: 'mrt50-3-query-failure',
          revision: 1
        }),
        /falha simulada de consulta finalizada/
      );
    } finally {
      repository.listarTransacoesFinalizadas = original;
    }
    assert.ok(!recovered._pendencias.has(completed.id));
    return { transacao: completed.id, bootstrapEmitidoAposFalha: false };
  });

  await registrarTeste('10 reinicialização aceita provas válidas e bloqueia provas inválidas', async () => {
    const valid = await concluirReconciliacao('restart-valid');
    const restartedValid = novoManager().manager;
    await restartedValid.recarregarPendencias();
    assert.ok(!restartedValid._pendencias.has(valid.id));

    const invalid = await concluirReconciliacao('restart-invalid');
    await adulterarAssinatura(invalid.id, EVENTO_COMMIT);
    const restartedInvalid = novoManager().manager;
    await restartedInvalid.recarregarPendencias();
    assert.ok(restartedInvalid._pendencias.has(invalid.id));
    return {
      validTransaction: valid.id,
      validReleased: true,
      invalidTransaction: invalid.id,
      invalidBlocked: true
    };
  });

  await registrarTeste('11 TX_START com identidade não validada não alcança driver', async () => {
    const completed = await concluirReconciliacao('start-blocked');
    await adulterarAssinatura(completed.id, EVENTO_COMMIT);
    const recovered = novoManager().manager;
    await recovered.recarregarPendencias();
    const chamadas = await prepararHostBloqueado(
      recovered,
      recovered._nativeHostClient.publicKey,
      completed.id
    );
    assert.deepStrictEqual(chamadas, { inicia: 0, continua: 0, finaliza: 0 });
    return { transacao: completed.id, chamadasDriver: chamadas };
  });

  await registrarTeste('12 verificador de compatibilidade opera em modo somente leitura', async () => {
    const verifierPath = path.join(__dirname, 'mrt-50-3-db-compat-readonly.js');
    const report = JSON.parse(execFileSync(
      process.execPath,
      [verifierPath, '--db-path', database.dbPath],
      {
        cwd: path.resolve(__dirname, '../..'),
        env: { ...process.env, DB_DIR: TEST_DB_DIR },
        encoding: 'utf8'
      }
    ));
    assert.strictEqual(report.readOnly, true);
    assert.strictEqual(report.pathMatchesResolver, true);
    assert.strictEqual(report.compatible, true);
    return {
      caminhoTemporarioConfirmado: report.effectiveDatabasePath,
      integrityCheck: report.integrityCheck,
      schemaCompatible: report.compatible
    };
  });

  const contadoresIndependentes = resultados
    .map((item) => item.evidencias?.chamadasDriver)
    .filter(Boolean);
  const resumo = {
    sucesso: resultados.every((item) => item.resultado === 'PASSOU'),
    bancoTemporario: database.dbPath,
    gateFinanceiro: transacaoRealHabilitada(),
    dllCarregada: false,
    chamadasFinanceirasReais: 0,
    totalTestes: resultados.length,
    contadoresIndependentes,
    resultados
  };
  if (!resumo.sucesso) {
    console.error(JSON.stringify(resumo, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(resumo, null, 2));
  }
}

executar()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await new Promise((resolve) => database.close(() => resolve()));
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });
