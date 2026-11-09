'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const destaxaBinarios = require('./services/tef/destaxa/destaxaBinarios');
const destaxaDllResolver = require('./services/tef/destaxa/destaxaDllResolver');
const {
  APP_NAME,
  PROFILE_NAMES,
  validarPerfilTefOriginalSomenteLeitura,
  validarSnapshotPerfilTefIsolado
} = require('./services/tef/tefCryptoProfileProvisioner');
const { lerChaveTefPersistida } = require('./services/tef/tefSigningKeyProvisioner');
const destaxaLogger = require('./services/tef/destaxa/destaxaLogger');
const {
  inicializarNativeHostIsolado
} = require('./services/tef/destaxa/tefNativeHostBootstrapIsolado');

const MODULE = 'erp';
const EXPECTED_ELECTRON_VERSION = '22.3.27';
const EXPECTED_KEY_DIR = 'C:\\ProgramData\\MercantilFiscal\\dados';
const TRANSACTION_GATE = 'DESTAXA_REAL_TRANSACTION_ENABLED';
const NATIVEHOST_TEST_FLAGS = [
  'DESTAXA_NATIVE_HOST_TEST_MODE',
  'DESTAXA_NATIVE_HOST_TRIPWIRE'
];
const profileRootArgument = process.argv.find((argument) => argument.startsWith('--mrt53-root='));
const keyDirArgument = process.argv.find((argument) => argument.startsWith('--mrt53-key-dir='));
const isolatedRoot = profileRootArgument
  ? path.resolve(profileRootArgument.slice('--mrt53-root='.length))
  : '';
const originalKeyDir = keyDirArgument
  ? path.resolve(keyDirArgument.slice('--mrt53-key-dir='.length))
  : '';

let phase = 'preflight';
let handle = null;
let exitCode = 0;
let profileOriginal = null;
let snapshotUserDataPath = null;
let snapshotLocalStateSha256 = null;
let dllPreflight = null;
const clientInitRequested = process.argv.includes('--mrt54-init-client');

function criarErro(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function estaDentroDe(diretorio, caminho) {
  const relativo = path.relative(path.resolve(diretorio), path.resolve(caminho));
  return relativo === '' || (!relativo.startsWith('..') && !path.isAbsolute(relativo));
}

function garantirDiretorioNovo(diretorio) {
  fs.mkdirSync(diretorio, { recursive: false });
}

function validarCaminhosOriginais(appDataPath, originalUserDataPath) {
  const esperado = path.join(appDataPath, PROFILE_NAMES[MODULE]);
  if (path.resolve(esperado).toLowerCase() !== path.resolve(originalUserDataPath).toLowerCase()) {
    throw criarErro('TEF_MRT53_PERFIL_ERP_PATH_DIVERGENTE');
  }
}

function inspecionarDllDestaxa() {
  const arch = process.arch;
  const metadata = destaxaBinarios.arquivos[`win-${arch}`];
  if (!metadata || arch !== 'x64') {
    throw criarErro('TEF_MRT54_DLL_PROCESS_ARCH_UNSUPPORTED');
  }

  const resolucao = destaxaDllResolver.resolverDll({}, { arch });
  if (!resolucao.sucesso || !resolucao.dllPath) {
    throw criarErro(resolucao.codigo || 'TEF_MRT54_DLL_NOT_FOUND');
  }
  const stat = fs.statSync(resolucao.dllPath);
  const sha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(resolucao.dllPath))
    .digest('hex')
    .toUpperCase();
  if (resolucao.dllArch !== 'x64'
      || resolucao.peMachine !== metadata.peMachine
      || stat.size !== metadata.tamanho
      || sha256 !== metadata.sha256) {
    throw criarErro('TEF_MRT54_DLL_METADATA_MISMATCH');
  }

  let koffiVersion;
  try {
    koffiVersion = require('../node_modules/koffi/package.json').version;
  } catch (_) {
    throw criarErro('TEF_MRT54_KOFFI_METADATA_UNAVAILABLE');
  }
  return Object.freeze({
    path: path.resolve(resolucao.dllPath),
    processArch: arch,
    dllArch: resolucao.dllArch,
    peMachine: resolucao.peMachine,
    size: stat.size,
    sha256,
    origin: resolucao.origem,
    packageVersion: destaxaBinarios.versaoPacote,
    koffiVersion
  });
}

function escreverRegistro(registro) {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(registro)}\n`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function executar() {
  if (process.versions.electron !== EXPECTED_ELECTRON_VERSION) {
    throw criarErro('TEF_MRT53_ELECTRON_VERSION_DIVERGENT');
  }
  if (!isolatedRoot || !originalKeyDir) {
    throw criarErro('TEF_MRT53_ISOLATED_PATHS_REQUIRED');
  }
  if (path.resolve(originalKeyDir).toLowerCase() !== path.resolve(EXPECTED_KEY_DIR).toLowerCase()) {
    throw criarErro('TEF_MRT53_ORIGINAL_KEY_PATH_DIVERGENT');
  }
  if (process.env[TRANSACTION_GATE] === '1') {
    throw criarErro('TEF_MRT53_TRANSACTION_GATE_MUST_BE_OFF');
  }
  if (NATIVEHOST_TEST_FLAGS.some((name) => process.env[name] === '1')) {
    throw criarErro('TEF_MRT53_NATIVEHOST_TEST_MODE_MUST_BE_OFF');
  }
  if (fs.existsSync(isolatedRoot)) {
    throw criarErro('TEF_MRT53_ISOLATED_ROOT_ALREADY_EXISTS');
  }

  delete process.env.TEF_ENCRYPTION_KEY;
  process.env[TRANSACTION_GATE] = '0';
  for (const name of NATIVEHOST_TEST_FLAGS) process.env[name] = '0';
  app.setName(APP_NAME);

  const originalAppDataPath = app.getPath('appData');
  const originalUserDataPath = path.join(originalAppDataPath, PROFILE_NAMES[MODULE]);
  validarCaminhosOriginais(originalAppDataPath, originalUserDataPath);
  profileOriginal = validarPerfilTefOriginalSomenteLeitura({
    appName: app.getName(),
    modulo: MODULE,
    appDataPath: originalAppDataPath,
    userDataPath: originalUserDataPath
  });
  if (clientInitRequested) {
    phase = 'dll-preflight';
    dllPreflight = inspecionarDllDestaxa();
  }

  if (estaDentroDe(originalAppDataPath, isolatedRoot)
      || estaDentroDe(profileOriginal.userDataPath, isolatedRoot)
      || estaDentroDe(isolatedRoot, profileOriginal.userDataPath)) {
    throw criarErro('TEF_MRT53_ISOLATED_ROOT_OVERLAPS_ORIGINAL_PROFILE');
  }

  phase = 'isolated-profile';
  garantirDiretorioNovo(isolatedRoot);
  snapshotUserDataPath = path.join(isolatedRoot, 'profile', PROFILE_NAMES[MODULE]);
  fs.mkdirSync(snapshotUserDataPath, { recursive: true });

  const originalLocalStatePath = path.join(profileOriginal.userDataPath, 'Local State');
  const snapshotLocalStatePath = path.join(snapshotUserDataPath, 'Local State');
  fs.copyFileSync(originalLocalStatePath, snapshotLocalStatePath, fs.constants.COPYFILE_EXCL);
  snapshotLocalStateSha256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(snapshotLocalStatePath))
    .digest('hex')
    .toUpperCase();
  if (snapshotLocalStateSha256 !== profileOriginal.localStateSha256) {
    throw criarErro('TEF_MRT53_LOCAL_STATE_COPY_HASH_DIVERGENT');
  }

  app.setPath('userData', snapshotUserDataPath);
  if (path.resolve(app.getPath('userData')) !== path.resolve(snapshotUserDataPath)) {
    throw criarErro('TEF_MRT53_ELECTRON_PATH_ISOLATION_FAILED');
  }

  validarSnapshotPerfilTefIsolado({
    app,
    modulo: MODULE,
    perfilOriginal: profileOriginal,
    snapshotUserDataPath
  });

  phase = 'electron-ready';
  await app.whenReady();
  validarSnapshotPerfilTefIsolado({
    app,
    modulo: MODULE,
    perfilOriginal: profileOriginal,
    snapshotUserDataPath
  });
  if (!safeStorage.isEncryptionAvailable()) {
    throw criarErro('TEF_MRT53_SAFE_STORAGE_UNAVAILABLE');
  }

  const env = {
    ...process.env,
    [TRANSACTION_GATE]: '0',
    DESTAXA_NATIVE_HOST_TEST_MODE: '0',
    DESTAXA_NATIVE_HOST_TRIPWIRE: '0'
  };
  delete env.TEF_ENCRYPTION_KEY;
  const isolatedDatabaseDir = path.join(isolatedRoot, 'no-database');
  const isolatedDatabasePath = path.join(isolatedDatabaseDir, 'mercadao.db');
  phase = 'nativehost-bootstrap';
  handle = await inicializarNativeHostIsolado({
    app,
    modulo: MODULE,
    safeStorage,
    env,
    dbDir: isolatedDatabaseDir,
    databasePath: isolatedDatabasePath,
    validarPerfilTef: () => validarSnapshotPerfilTefIsolado({
      app,
      modulo: MODULE,
      perfilOriginal: profileOriginal,
      snapshotUserDataPath
    }),
    lerChaveTef: (options) => lerChaveTefPersistida({
      ...options,
      dbDir: originalKeyDir
    }),
    listarTransacoesPendentes: async () => [],
    permitirInicializacaoClientDestaxa: clientInitRequested
  });

  const status = handle.status;
  if (!status || !Number.isInteger(status.pid) || status.pid <= 0
      || !['child_process', 'utilityProcess'].includes(status.processType)
      || !['SECURITY_BOOTSTRAP_VALIDATED', 'SECURITY_BLOCKED'].includes(status.securityBootstrapState)
      || status.securityBootstrapRevision !== 1
      || status.gateReal !== false
      || status.diagnostics?.dllLoaded !== false
      || status.contadores?.dllLoads !== 0
      || status.operacaoAtiva !== null) {
    throw criarErro('TEF_MRT53_NATIVEHOST_STATUS_UNSAFE');
  }

  await escreverRegistro({
    event: 'nativehost-ready',
    module: MODULE,
    profileIdentity: 'ERP',
    originalUserDataPath: profileOriginal.userDataPath,
    isolatedUserDataPath: snapshotUserDataPath,
    electronVersion: process.versions.electron,
    originalLocalStateSha256: profileOriginal.localStateSha256,
    snapshotLocalStateSha256,
    safeStorageAvailable: true,
    keySource: 'original-persisted-store',
    nativeHostPid: status.pid,
    nativeHostProcessType: status.processType,
    bootstrapReceived: true,
    bootstrapState: status.securityBootstrapState,
    bootstrapRevision: status.securityBootstrapRevision,
    ipcStatusReceived: true,
    financialGate: 'OFF',
    dllLoaded: false,
    dllLoads: status.contadores.dllLoads,
    pendingTransactionsSource: 'NOT_READ_NO_DATABASE'
  });

  if (clientInitRequested) {
    phase = 'dll-load-and-client-init';
    const inicializacao = await handle.inicializarClientDestaxa({
      sdkPath: dllPreflight.path
    });
    const diagnostico = inicializacao.statusAposLoad?.diagnostics || {};
    const statusFinal = inicializacao.statusAposClient;
    await escreverRegistro({
      event: 'destaxa-client-init',
      success: inicializacao.sucesso,
      dll: dllPreflight,
      dllLoaded: diagnostico.dllLoaded === true,
      exportsValid: diagnostico.exportsValid === true,
      exports: diagnostico.exports || {},
      dllLoads: inicializacao.statusAposLoad?.contadores?.dllLoads ?? null,
      iniciaClientDestaxaCalls: 1,
      clientReturn: {
        code: inicializacao.client?.codigo || null,
        destaxaCode: inicializacao.client?.codigoDestaxa || null,
        description: inicializacao.client?.descricaoCodigo || null,
        message: inicializacao.client?.mensagem || null,
        state: inicializacao.client?.estado || null,
        durationMs: inicializacao.client?.duracaoMs ?? null
      },
      clientStatus: {
        initialized: statusFinal?.diagnostics?.clientInitialized === true,
        resultCode: statusFinal?.diagnostics?.clientResultCode || null,
        state: statusFinal?.diagnostics?.estado || null,
        gateReal: statusFinal?.gateReal
      }
    });
    if (!inicializacao.sucesso) {
      throw criarErro(
        'TEF_MRT54_CLIENT_INIT_FAILED',
        'iniciaClientDestaxa não confirmou a inicialização do Client.'
      );
    }
  }

  phase = 'nativehost-shutdown';
  destaxaLogger.registrarPersistente('bootstrap.shutdown.requested', {
    pid: process.pid,
    pidHost: status.pid,
    previousState: status.estado || null
  });
  const shutdown = await handle.encerrar();
  handle = null;
  destaxaLogger.registrarPersistente('bootstrap.shutdown.result', {
    pid: process.pid,
    pidHost: status.pid,
    result: {
      encerrado: shutdown.encerrado === true,
      adiado: shutdown.adiado === true,
      forcado: shutdown.forcado === true,
      estado: shutdown.estado || null
    },
    terminalState: shutdown.estado || null,
    stoppedConfirmed: shutdown.estado === 'STOPPED' && shutdown.encerrado === true
  });
  if (!shutdown.encerrado || shutdown.forcado === true) {
    throw criarErro('TEF_MRT53_NATIVEHOST_SHUTDOWN_UNSAFE');
  }
  await escreverRegistro({
    event: 'nativehost-shutdown',
    success: true,
    forced: false,
    state: shutdown.estado,
    nativeHostPid: status.pid,
    stoppedConfirmed: shutdown.estado === 'STOPPED'
  });
}

executar()
  .catch(async (error) => {
    exitCode = 1;
    await escreverRegistro({
      success: false,
      phase,
      code: error.code || 'TEF_MRT53_FAILED',
      exception: error.name || 'Error'
    });
  })
  .finally(async () => {
    try {
      if (handle) {
        const pidHost = handle.status?.pid || null;
        try {
          destaxaLogger.registrarPersistente('bootstrap.shutdown.finally.requested', {
            pid: process.pid,
            pidHost,
            previousState: handle.status?.estado || null,
            phase
          });
          const resultado = await handle.encerrar();
          destaxaLogger.registrarPersistente('bootstrap.shutdown.finally.result', {
            pid: process.pid,
            pidHost,
            result: {
              encerrado: resultado?.encerrado === true,
              adiado: resultado?.adiado === true,
              forcado: resultado?.forcado === true,
              estado: resultado?.estado || null
            },
            terminalState: resultado?.estado || null,
            stoppedConfirmed: resultado?.estado === 'STOPPED' && resultado?.encerrado === true
          });
        } catch (error) {
          exitCode = 1;
          destaxaLogger.registrarPersistente('bootstrap.shutdown.finally.exception', {
            pid: process.pid,
            pidHost,
            exception: { name: error.name || 'Error', code: error.code || null }
          });
        }
      }
    } finally {
      app.exit(exitCode);
    }
  });
