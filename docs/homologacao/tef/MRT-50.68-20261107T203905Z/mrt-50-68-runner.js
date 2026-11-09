'use strict';

/**
 * MRT-50.68 — runner controlado baseado no bootstrap MRT-50.53/54.
 * Diferença deliberada: se houver operação nativa em voo, NÃO chama app.exit
 * (utilityProcess morreria com o pai) e não força kill.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const destaxaBinarios = require(path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaBinarios'));
const destaxaDllResolver = require(path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaDllResolver'));
const {
  APP_NAME,
  PROFILE_NAMES,
  validarPerfilTefOriginalSomenteLeitura,
  validarSnapshotPerfilTefIsolado
} = require(path.join(ROOT, 'backend', 'services', 'tef', 'tefCryptoProfileProvisioner'));
const { lerChaveTefPersistida } = require(path.join(ROOT, 'backend', 'services', 'tef', 'tefSigningKeyProvisioner'));
const destaxaLogger = require(path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaLogger'));
const {
  inicializarNativeHostIsolado
} = require(path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'tefNativeHostBootstrapIsolado'));
const { ERROS_HOST } = require(path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaNativeHostProtocolo'));

const MODULE = 'erp';
const EXPECTED_ELECTRON_VERSION = '22.3.27';
const EXPECTED_KEY_DIR = 'C:\\ProgramData\\MercantilFiscal\\dados';
const EXPECTED_DLL_SHA256 = '65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279';
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
const resultFile = process.env.MRT5068_RESULT_FILE;
const stdoutLog = process.env.MRT5068_STDOUT_FILE;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

let phase = 'preflight';
let handle = null;
let exitCode = 0;
let keepAliveForInFlight = false;
let profileOriginal = null;
let snapshotUserDataPath = null;
let snapshotLocalStateSha256 = null;
let dllPreflight = null;
let resultadoClassificacao = 'INDETERMINATE';
let evidencias = {
  nativeHostPid: null,
  requestId: null,
  dllSha256: null,
  clientReturn: null,
  shutdown: null,
  ipcEvents: []
};

function criarErro(code, message) {
  const error = new Error(message || code);
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

function escreverStdout(registro) {
  const linha = `${JSON.stringify(registro)}\n`;
  if (stdoutLog) fs.appendFileSync(stdoutLog, linha);
  return new Promise((resolve, reject) => {
    process.stdout.write(linha, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function gravarResultado(extra = {}) {
  if (!resultFile) return;
  const payload = {
    mrt: 'MRT-50.68',
    classificacao: resultadoClassificacao,
    phase,
    electron: process.versions.electron,
    evidencias,
    ...extra,
    geradoEm: new Date().toISOString()
  };
  fs.writeFileSync(resultFile, `${JSON.stringify(payload, null, 2)}\n`);
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
  if (sha256 !== EXPECTED_DLL_SHA256) {
    throw criarErro('TEF_MRT68_DLL_HASH_MISMATCH', 'DLL SHA-256 diverge da referência MRT-50.58/64');
  }
  if (resolucao.dllArch !== 'x64'
      || resolucao.peMachine !== metadata.peMachine
      || stat.size !== metadata.tamanho
      || sha256 !== metadata.sha256) {
    throw criarErro('TEF_MRT54_DLL_METADATA_MISMATCH');
  }

  let koffiVersion;
  try {
    koffiVersion = require(path.join(ROOT, 'node_modules', 'koffi', 'package.json')).version;
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

function classificarAposInit(inicializacao, erro) {
  if (erro) {
    const codigo = erro.code || '';
    const detalhe = erro.detalhes && erro.detalhes.codigo;
    if (detalhe === ERROS_HOST.HOST_TIMEOUT || /TIMEOUT/i.test(codigo)) {
      return 'TIMEOUT_IN_FLIGHT';
    }
    if (/IPC/i.test(codigo) || detalhe === ERROS_HOST.HOST_IPC_LOST) {
      return 'IPC_LOST';
    }
    if (/CRASH/i.test(codigo)) {
      return 'HOST_CRASHED';
    }
    return 'INDETERMINATE';
  }
  if (!inicializacao) return 'INDETERMINATE';
  if (inicializacao.sucesso === true) return 'RETURNED_SUCCESS';
  if (inicializacao.client && (inicializacao.client.codigoDestaxa || inicializacao.client.codigo)) {
    return 'RETURNED_ERROR';
  }
  return 'INDETERMINATE';
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

  phase = 'dll-preflight';
  dllPreflight = inspecionarDllDestaxa();
  evidencias.dllSha256 = dllPreflight.sha256;

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
    permitirInicializacaoClientDestaxa: true
  });

  const status = handle.status;
  evidencias.nativeHostPid = status.pid;
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

  await escreverStdout({
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

  phase = 'dll-load-and-client-init';
  let inicializacao = null;
  let initError = null;
  try {
    inicializacao = await handle.inicializarClientDestaxa({
      sdkPath: dllPreflight.path
    });
  } catch (error) {
    initError = error;
  }

  if (inicializacao) {
    const diagnostico = inicializacao.statusAposLoad?.diagnostics || {};
    const statusFinal = inicializacao.statusAposClient;
    evidencias.clientReturn = {
      success: inicializacao.sucesso,
      code: inicializacao.client?.codigo || null,
      destaxaCode: inicializacao.client?.codigoDestaxa || null,
      description: inicializacao.client?.descricaoCodigo || null,
      message: inicializacao.client?.mensagem || null,
      state: inicializacao.client?.estado || null,
      durationMs: inicializacao.client?.duracaoMs ?? null,
      dllLoaded: diagnostico.dllLoaded === true,
      exportsValid: diagnostico.exportsValid === true,
      dllLoads: inicializacao.statusAposLoad?.contadores?.dllLoads ?? null,
      clientInitialized: statusFinal?.diagnostics?.clientInitialized === true,
      clientResultCode: statusFinal?.diagnostics?.clientResultCode || null,
      gateReal: statusFinal?.gateReal
    };
    await escreverStdout({
      event: 'destaxa-client-init',
      success: inicializacao.sucesso,
      dll: dllPreflight,
      iniciaClientDestaxaCalls: 1,
      clientReturn: evidencias.clientReturn
    });
  } else if (initError) {
    await escreverStdout({
      event: 'destaxa-client-init-error',
      code: initError.code || null,
      details: initError.detalhes || null,
      exception: initError.name || 'Error'
    });
  }

  resultadoClassificacao = classificarAposInit(inicializacao, initError);

  // Extrair requestId do JSONL se disponível
  try {
    const logPath = destaxaLogger.obterArquivoAuditoria();
    if (fs.existsSync(logPath)) {
      const linhas = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
      for (const linha of linhas) {
        try {
          const ev = JSON.parse(linha);
          if (ev.evento === 'native.call.enter' && ev.functionName === 'iniciaClientDestaxa') {
            evidencias.requestId = ev.requestId;
          }
          if (ev.requestId && (ev.evento || ev.tipo)) {
            evidencias.ipcEvents.push({
              evento: ev.evento || null,
              tipo: ev.tipo || null,
              requestId: ev.requestId,
              resultCode: ev.resultCode || null
            });
          }
        } catch (_) { /* ignore */ }
      }
    }
  } catch (_) { /* ignore */ }

  if (resultadoClassificacao === 'TIMEOUT_IN_FLIGHT') {
    phase = 'nativehost-inflight-hold';
    const estado = handle.status;
    evidencias.shutdown = {
      encerrado: false,
      adiado: true,
      estado: estado?.estado || null,
      motivo: 'operacao-nativa-em-voo-nao-matar'
    };
    keepAliveForInFlight = true;
    gravarResultado({
      success: false,
      keepAlive: true,
      dll: dllPreflight,
      initError: initError ? { code: initError.code, details: initError.detalhes || null } : null
    });
    await escreverStdout({
      event: 'nativehost-inflight-hold',
      classificacao: resultadoClassificacao,
      nativeHostPid: evidencias.nativeHostPid,
      requestId: evidencias.requestId,
      killed: false
    });
    return;
  }

  phase = 'nativehost-shutdown';
  destaxaLogger.registrarPersistente('bootstrap.shutdown.requested', {
    pid: process.pid,
    pidHost: status.pid,
    previousState: handle.status?.estado || null
  });
  const shutdown = await handle.encerrar();
  evidencias.shutdown = {
    encerrado: shutdown.encerrado === true,
    adiado: shutdown.adiado === true,
    forcado: shutdown.forcado === true,
    estado: shutdown.estado || null,
    stoppedConfirmed: shutdown.estado === 'STOPPED' && shutdown.encerrado === true
  };
  handle = null;
  destaxaLogger.registrarPersistente('bootstrap.shutdown.result', {
    pid: process.pid,
    pidHost: status.pid,
    result: evidencias.shutdown,
    terminalState: shutdown.estado || null,
    stoppedConfirmed: evidencias.shutdown.stoppedConfirmed
  });

  if (shutdown.adiado === true) {
    resultadoClassificacao = 'TIMEOUT_IN_FLIGHT';
    keepAliveForInFlight = true;
    gravarResultado({ success: false, keepAlive: true, dll: dllPreflight });
    await escreverStdout({
      event: 'nativehost-shutdown-deferred',
      classificacao: resultadoClassificacao,
      nativeHostPid: evidencias.nativeHostPid,
      killed: false
    });
    return;
  }

  if (shutdown.forcado === true) {
    resultadoClassificacao = resultadoClassificacao === 'RETURNED_SUCCESS'
      ? 'INDETERMINATE'
      : resultadoClassificacao;
  }

  await escreverStdout({
    event: 'nativehost-shutdown',
    success: shutdown.encerrado === true,
    forced: shutdown.forcado === true,
    state: shutdown.estado,
    nativeHostPid: status.pid,
    stoppedConfirmed: evidencias.shutdown.stoppedConfirmed
  });

  if (initError && resultadoClassificacao === 'INDETERMINATE') {
    // manter
  } else if (initError && resultadoClassificacao === 'RETURNED_ERROR') {
    // ok
  } else if (inicializacao && !inicializacao.sucesso) {
    resultadoClassificacao = 'RETURNED_ERROR';
  }

  gravarResultado({
    success: resultadoClassificacao === 'RETURNED_SUCCESS',
    dll: dllPreflight,
    initError: initError ? { code: initError.code, details: initError.detalhes || null } : null
  });

  if (resultadoClassificacao !== 'RETURNED_SUCCESS') {
    exitCode = 1;
  }
}

executar()
  .catch(async (error) => {
    exitCode = 1;
    if (resultadoClassificacao === 'INDETERMINATE' || !resultadoClassificacao) {
      resultadoClassificacao = /TIMEOUT/i.test(error.code || '')
        ? 'TIMEOUT_IN_FLIGHT'
        : (/CRASH/i.test(error.code || '') ? 'HOST_CRASHED' : 'INDETERMINATE');
    }
    await escreverStdout({
      success: false,
      phase,
      code: error.code || 'TEF_MRT68_FAILED',
      exception: error.name || 'Error',
      classificacao: resultadoClassificacao
    });
    gravarResultado({
      success: false,
      code: error.code || 'TEF_MRT68_FAILED',
      keepAlive: keepAliveForInFlight
    });
  })
  .finally(async () => {
    try {
      if (handle && !keepAliveForInFlight) {
        const pidHost = handle.status?.pid || null;
        try {
          destaxaLogger.registrarPersistente('bootstrap.shutdown.finally.requested', {
            pid: process.pid,
            pidHost,
            previousState: handle.status?.estado || null,
            phase
          });
          const resultado = await handle.encerrar();
          if (resultado?.adiado === true) {
            keepAliveForInFlight = true;
            resultadoClassificacao = 'TIMEOUT_IN_FLIGHT';
            evidencias.shutdown = {
              encerrado: false,
              adiado: true,
              estado: resultado.estado || null
            };
            gravarResultado({ success: false, keepAlive: true });
          } else {
            evidencias.shutdown = {
              encerrado: resultado?.encerrado === true,
              adiado: resultado?.adiado === true,
              forcado: resultado?.forcado === true,
              estado: resultado?.estado || null,
              stoppedConfirmed: resultado?.estado === 'STOPPED' && resultado?.encerrado === true
            };
            destaxaLogger.registrarPersistente('bootstrap.shutdown.finally.result', {
              pid: process.pid,
              pidHost,
              result: evidencias.shutdown,
              terminalState: resultado?.estado || null,
              stoppedConfirmed: evidencias.shutdown.stoppedConfirmed
            });
            gravarResultado({ success: resultadoClassificacao === 'RETURNED_SUCCESS' });
          }
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
      if (keepAliveForInFlight) {
        // Mantém o processo pai vivo para não matar utilityProcess com chamada nativa em voo.
        setInterval(() => {}, 60 * 60 * 1000);
        return;
      }
      app.exit(exitCode);
    }
  });
