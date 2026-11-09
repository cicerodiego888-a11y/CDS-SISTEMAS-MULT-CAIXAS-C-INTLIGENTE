'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const {
  inicializarNativeHostIsolado,
  listarPendenciasSomenteLeitura
} = require('../../backend/services/tef/destaxa/tefNativeHostBootstrapIsolado');
const {
  KEY_FILENAME,
  lerChaveTefPersistida
} = require('../../backend/services/tef/tefSigningKeyProvisioner');
const {
  selecionarPerfilTefExistente,
  validarPerfilTefExistente,
  PROFILE_NAMES
} = require('../../backend/services/tef/tefCryptoProfileProvisioner');
const { DestaxaNativeHostRuntime } = require('../../backend/services/tef/destaxa/DestaxaNativeHost');
const { DestaxaNativeHostClient } = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
const { OPERACOES_HOST } = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');

const SEGREDO_TESTE = crypto.randomBytes(32).toString('hex');
const GATE_ORIGINAL = process.env.DESTAXA_REAL_TRANSACTION_ENABLED;
const CHAVE_ORIGINAL = process.env.TEF_ENCRYPTION_KEY;
process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';

function criarAppFake({ ready = false } = {}) {
  const paths = {
    appData: 'C:\\Users\\IsolatedTest\\AppData\\Roaming',
    userData: 'C:\\Users\\IsolatedTest\\AppData\\Roaming\\Electron'
  };
  let name = 'Electron';
  return {
    isReady: () => ready,
    setName(value) { name = value; },
    getName() { return name; },
    setPath(key, value) { paths[key] = value; },
    getPath(key) { return paths[key]; }
  };
}

function criarFsSemSidecars(databasePath, walSize = 0, journalSize = 0) {
  return {
    statSync(caminho) {
      if (caminho === databasePath) {
        return { isFile: () => true, size: 1024, mtimeMs: 100 };
      }
      if (caminho === `${databasePath}-wal` && walSize > 0) {
        return { isFile: () => true, size: walSize, mtimeMs: 100 };
      }
      if (caminho === `${databasePath}-journal` && journalSize > 0) {
        return { isFile: () => true, size: journalSize, mtimeMs: 100 };
      }
      const error = new Error('not found');
      error.code = 'ENOENT';
      throw error;
    }
  };
}

function criarSqliteFake(rows) {
  const chamadas = { uri: null, flags: null, query: null, aberturas: 0 };
  class Database {
    constructor(uri, flags, callback) {
      chamadas.uri = uri;
      chamadas.flags = flags;
      chamadas.aberturas += 1;
      setImmediate(() => callback(null));
    }

    all(query, _params, callback) {
      chamadas.query = query;
      setImmediate(() => callback(null, rows));
    }

    close(callback) {
      setImmediate(() => callback(null));
    }
  }
  return {
    sqlite3: { OPEN_READONLY: 1, OPEN_URI: 64, Database },
    chamadas
  };
}

function criarSpawnerInProcesso() {
  const runtimes = [];
  const processos = [];
  const requisicoes = [];
  const chamadasBridge = { unload: 0 };

  const spawner = (_hostPath, env) => {
    let receber;
    let sair;
    const processo = {
      pid: 51000 + processos.length,
      tipo: 'isolated-bootstrap-test',
      connected: true,
      ref() {},
      unref() {},
      aoReceber(callback) {
        receber = callback;
        setImmediate(() => receber?.({
          tipo: 'HOST_READY',
          protocol: require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo').PROTOCOLO,
          pid: processo.pid,
          processType: processo.tipo,
          hostSessionId: runtime.hostSessionId,
          versions: {},
          modoTeste: false,
          tripwire: false
        }));
      },
      aoSair(callback) { sair = callback; },
      aoErro() {},
      enviar(request) {
        requisicoes.push(request.operation);
        setImmediate(() => {
          if (!processo.connected) return;
          const response = runtime.processar(request);
          receber?.(response);
        });
      },
      matar() {
        if (!processo.connected) return;
        processo.connected = false;
        runtime.aoDisconnectIpc({ motivo: 'isolated bootstrap test' });
        setImmediate(() => sair?.(0, null));
      },
      desconectarIpc() {
        processo.connected = false;
        runtime.aoDisconnectIpc({ motivo: 'isolated bootstrap test' });
        setImmediate(() => sair?.(0, null));
      }
    };
    const bridge = {
      getTransacaoContexto: () => null,
      getDiagnostics: () => ({
        dllPath: null,
        dllLoaded: false,
        exportsValid: false,
        clientInitialized: false
      }),
      unload() { chamadasBridge.unload += 1; }
    };
    const runtime = new DestaxaNativeHostRuntime({
      bridge,
      reconciliationPublicKey: env.DESTAXA_RECONCILIATION_PUBLIC_KEY,
      encerrarProcesso: () => {
        if (!processo.connected) return;
        processo.connected = false;
        setImmediate(() => sair?.(0, null));
      }
    });
    processos.push(processo);
    runtimes.push(runtime);
    return processo;
  };

  return { spawner, runtimes, processos, requisicoes, chamadasBridge };
}

function criarOpcoesIsoladas(spawnerState, extras = {}) {
  return {
    app: { isReady: () => true },
    modulo: 'pdv',
    safeStorage: {},
    dbDir: 'C:\\isolated-test-data',
    databasePath: 'C:\\isolated-test-data\\mercadao.db',
    validarPerfilTef: () => ({ modulo: 'pdv' }),
    lerChaveTef: () => SEGREDO_TESTE,
    listarTransacoesPendentes: async () => [],
    clientFactory: (clientOptions) => new DestaxaNativeHostClient({
      ...clientOptions,
      spawner: spawnerState.spawner,
      timeoutInicioMs: 1000,
      timeoutMs: 1000
    }),
    ...extras
  };
}

async function executar() {
  try {
    const imports = Object.keys(require.cache);
    assert.strictEqual(
      imports.some((file) => /[\\/]backend[\\/]database\.js$/i.test(file)),
      false,
      'o caminho isolado não deve importar database.js'
    );
    assert.strictEqual(
      imports.some((file) => /[\\/]services[\\/]tef[\\/]TefManager\.js$/i.test(file)),
      false,
      'o caminho isolado não deve importar TefManager'
    );
    assert.strictEqual(
      imports.some((file) => /[\\/]services[\\/]tef[\\/]tefRepository\.js$/i.test(file)),
      false,
      'o caminho isolado não deve importar tefRepository'
    );

    const perfilApp = criarAppFake();
    const perfil = selecionarPerfilTefExistente({ app: perfilApp, modulo: 'pdv' });
    assert.strictEqual(perfil.modulo, 'pdv');
    assert.strictEqual(perfil.userDataPath.endsWith(PROFILE_NAMES.pdv), true);

    const perfilPronto = criarAppFake({ ready: true });
    perfilPronto.setName('cds-sistemas');
    perfilPronto.getPath = (key) => (key === 'appData'
      ? 'C:\\Users\\IsolatedTest\\AppData\\Roaming'
      : path.join('C:\\Users\\IsolatedTest\\AppData\\Roaming', PROFILE_NAMES.pdv));
    let escritaPerfil = false;
    const fsPerfil = {
      readFileSync() {
        const error = new Error('missing marker');
        error.code = 'ENOENT';
        throw error;
      },
      writeFileSync() { escritaPerfil = true; },
      openSync() { escritaPerfil = true; throw new Error('unexpected write'); }
    };
    assert.throws(
      () => validarPerfilTefExistente({ app: perfilPronto, modulo: 'pdv', fsApi: fsPerfil }),
      (error) => error.code === 'TEF_CONTEXTO_PERFIL_DIVERGENTE'
    );
    assert.strictEqual(escritaPerfil, false, 'a validação de perfil não deve escrever arquivos');

    const caminhoChave = path.join('C:\\isolated-test-data', KEY_FILENAME);
    let criptografarChamadas = 0;
    const fsChave = {
      statSync(caminho) {
        assert.strictEqual(caminho, caminhoChave);
        return { isFile: () => true };
      },
      readFileSync() {
        return JSON.stringify({
          versao: 1,
          algoritmo: 'electron-safeStorage',
          ciphertext: Buffer.from('protected-key').toString('base64')
        });
      },
      writeFileSync() { throw new Error('unexpected write'); }
    };
    const chaveLida = lerChaveTefPersistida({
      safeStorage: {
        isEncryptionAvailable: () => true,
        decryptString: () => SEGREDO_TESTE,
        encryptString: () => { criptografarChamadas += 1; }
      },
      dbDir: path.dirname(caminhoChave),
      env: {},
      fsApi: fsChave
    });
    assert.strictEqual(chaveLida, SEGREDO_TESTE);
    assert.strictEqual(criptografarChamadas, 0, 'a recuperação não deve provisionar nem regravar a chave');

    const databasePath = 'C:\\readonly\\mercadao.db';
    const sqliteState = criarSqliteFake([{ id: 7, status: 'pendente' }]);
    const rows = await listarPendenciasSomenteLeitura({
      databasePath,
      fsApi: criarFsSemSidecars(databasePath),
      sqlite3: sqliteState.sqlite3
    });
    assert.deepStrictEqual(rows, [{ id: 7, status: 'pendente' }]);
    assert.strictEqual(sqliteState.chamadas.flags, 65);
    assert.strictEqual(sqliteState.chamadas.uri.includes('mode=ro&immutable=1'), true);
    assert.match(sqliteState.chamadas.query, /SELECT id, status, idempotency_key, codigo_transacao, payload_retorno/);
    assert.match(sqliteState.chamadas.query, /WHERE status = 'pendente'/);
    assert.strictEqual(/INSERT|UPDATE|DELETE|PRAGMA\s+journal_mode/i.test(sqliteState.chamadas.query), false);

    const walSqlite = criarSqliteFake([]);
    await assert.rejects(
      listarPendenciasSomenteLeitura({
        databasePath,
        fsApi: criarFsSemSidecars(databasePath, 64),
        sqlite3: walSqlite.sqlite3
      }),
      (error) => error.code === 'TEF_BOOTSTRAP_DB_NAO_QUIESCENTE'
    );
    assert.strictEqual(walSqlite.chamadas.aberturas, 0, 'WAL não vazio deve bloquear antes de abrir o banco');

    const spawnerState = criarSpawnerInProcesso();
    const handle = await inicializarNativeHostIsolado(criarOpcoesIsoladas(spawnerState, {
      listarTransacoesPendentes: async () => [{
        id: 22,
        status: 'pendente',
        idempotency_key: 'idem-22',
        codigo_transacao: 'op-22',
        payload_retorno: 'encrypted-payload'
      }],
      descriptografarObjeto: (payload) => {
        assert.strictEqual(payload, 'encrypted-payload');
        return {
          financialState: 'UNKNOWN',
          persistencia: {
            operation_id: 'op-22',
            idempotency_key: 'idem-22',
            fingerprint: 'fp-22'
          }
        };
      }
    }));

    assert.deepStrictEqual(Object.keys(handle).sort(), ['encerrar', 'status']);
    assert.strictEqual(handle.status.securityBootstrapState, 'SECURITY_BLOCKED');
    assert.deepStrictEqual(handle.status.blockedFinancialIdentities, ['22']);
    assert.strictEqual(handle.status.securityBootstrapRevision, 1);
    assert.strictEqual(handle.status.gateReal, false);
    assert.strictEqual(handle.status.diagnostics.dllLoaded, false);
    assert.strictEqual(handle.status.contadores.dllLoads, 0);
    assert.strictEqual(spawnerState.requisicoes.includes(OPERACOES_HOST.SECURITY_BOOTSTRAP), true);
    assert.strictEqual(spawnerState.requisicoes.includes(OPERACOES_HOST.STATUS), true);
    assert.deepStrictEqual(
      spawnerState.requisicoes.filter((operation) => /TX_|LOAD|INIT_CLIENT|ENABLE_REAL/.test(operation)),
      []
    );
    assert.strictEqual(spawnerState.processos.length, 1);
    assert.strictEqual(spawnerState.processos[0].connected, true);
    assert.strictEqual(spawnerState.runtimes[0].contadores.dllLoads, 0);

    const encerramento = await handle.encerrar();
    assert.strictEqual(encerramento.encerrado, true);
    assert.strictEqual(spawnerState.requisicoes.includes(OPERACOES_HOST.SHUTDOWN), true);
    assert.strictEqual(spawnerState.chamadasBridge.unload, 1);

    let hostRealHandle;
    try {
      hostRealHandle = await inicializarNativeHostIsolado(criarOpcoesIsoladas(null, {
        clientFactory: (clientOptions) => new DestaxaNativeHostClient(clientOptions)
      }));
      assert.strictEqual(hostRealHandle.status.processType, 'child_process');
      assert.strictEqual(hostRealHandle.status.securityBootstrapState, 'SECURITY_BOOTSTRAP_VALIDATED');
      assert.strictEqual(hostRealHandle.status.gateReal, false);
      assert.strictEqual(hostRealHandle.status.diagnostics.dllLoaded, false);
      assert.strictEqual(hostRealHandle.status.contadores.dllLoads, 0);
      assert.strictEqual(typeof hostRealHandle.enviar, 'undefined');
      const resultado = await hostRealHandle.encerrar();
      assert.strictEqual(resultado.encerrado, true);
      hostRealHandle = null;
    } finally {
      if (hostRealHandle) await hostRealHandle.encerrar();
    }

    process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '1';
    const gateState = criarSpawnerInProcesso();
    await assert.rejects(
      inicializarNativeHostIsolado(criarOpcoesIsoladas(gateState)),
      (error) => error.code === 'TEF_BOOTSTRAP_GATE_REAL_ATIVO'
    );
    assert.strictEqual(gateState.processos.length, 0, 'gate real ativo deve bloquear antes do spawn');
    process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';

    const falhaState = criarSpawnerInProcesso();
    await assert.rejects(
      inicializarNativeHostIsolado(criarOpcoesIsoladas(falhaState, {
        listarTransacoesPendentes: async () => {
          throw new Error('read-only source unavailable');
        }
      })),
      (error) => error.code === 'TEF_BOOTSTRAP_NATIVEHOST_FALHOU'
    );
    assert.strictEqual(falhaState.requisicoes.includes(OPERACOES_HOST.STATUS), false);
    assert.strictEqual(falhaState.runtimes[0].contadores.dllLoads, 0);
    assert.strictEqual(process.env.TEF_ENCRYPTION_KEY, CHAVE_ORIGINAL);

    console.log('MRT-50.49 bootstrap isolado: todos os testes passaram; nenhuma DLL, banco real ou operação financeira foi iniciada.');
  } finally {
    if (GATE_ORIGINAL === undefined) delete process.env.DESTAXA_REAL_TRANSACTION_ENABLED;
    else process.env.DESTAXA_REAL_TRANSACTION_ENABLED = GATE_ORIGINAL;
    if (CHAVE_ORIGINAL === undefined) delete process.env.TEF_ENCRYPTION_KEY;
    else process.env.TEF_ENCRYPTION_KEY = CHAVE_ORIGINAL;
  }
}

executar().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
