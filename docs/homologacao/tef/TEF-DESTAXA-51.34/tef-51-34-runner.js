'use strict';

/**
 * TEF-DESTAXA-51.34 — NativeHost isolado SEM LOAD / SEM INIT_CLIENT / SEM TX.
 * Escopo: spawn + SECURITY_BOOTSTRAP + STATUS (+ PING via client interno) + encerrar.
 */

const path = require('path');
const fs = require('fs');
const { app, safeStorage } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const {
  selecionarPerfilTefExistente
} = require(path.join(ROOT, 'backend', 'services', 'tef', 'tefCryptoProfileProvisioner'));
const {
  lerChaveTefPersistida
} = require(path.join(ROOT, 'backend', 'services', 'tef', 'tefSigningKeyProvisioner'));
const {
  inicializarNativeHostIsolado
} = require(path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'tefNativeHostBootstrapIsolado'));
const {
  OPERACOES_HOST
} = require(path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaNativeHostProtocolo'));
const { DestaxaNativeHostClient } = require(path.join(
  ROOT, 'backend', 'services', 'tef', 'destaxa', 'DestaxaNativeHostClient'
));

const OUT = path.join(__dirname, 'evidencias-51-34.json');
const MODULE = 'pdv';

function log(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function criarErro(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function main() {
  const inicio = new Date().toISOString();
  const evidencias = {
    sprint: 'TEF-DESTAXA-51.34',
    inicio,
    gateEnvAntes: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
    proibicoes: {
      iniciaClientDestaxa: false,
      LOAD: false,
      TX_START: false,
      TX_CONTINUE: false,
      TX_FINALIZE: false,
      COM4: false
    }
  };

  if (String(process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '').trim() === '1') {
    throw criarErro('TEF_5134_GATE_ON', 'Gate financeiro ligado — abortar');
  }

  selecionarPerfilTefExistente({ app, modulo: MODULE });
  await app.whenReady();

  if (!safeStorage.isEncryptionAvailable()) {
    throw criarErro('TEF_5134_SAFE_STORAGE', 'safeStorage indisponível');
  }

  const originalKeyDir = process.env.DB_DIR
    || path.join(process.env.ProgramData || 'C:\\ProgramData', 'MercantilFiscal', 'dados');
  const isolatedRoot = path.join(__dirname, '_isolado-51-34');
  fs.mkdirSync(isolatedRoot, { recursive: true });
  const isolatedDatabaseDir = path.join(isolatedRoot, 'no-database');
  fs.mkdirSync(isolatedDatabaseDir, { recursive: true });
  const isolatedDatabasePath = path.join(isolatedDatabaseDir, 'mercadao.db');

  const env = {
    ...process.env,
    DESTAXA_REAL_TRANSACTION_ENABLED: '0',
    DESTAXA_NATIVE_HOST_TEST_MODE: '0',
    DESTAXA_NATIVE_HOST_TRIPWIRE: '0'
  };
  delete env.TEF_ENCRYPTION_KEY;

  let clientRef = null;
  const handle = await inicializarNativeHostIsolado({
    app,
    modulo: MODULE,
    safeStorage,
    env,
    dbDir: isolatedDatabaseDir,
    databasePath: isolatedDatabasePath,
    lerChaveTef: (options) => lerChaveTefPersistida({
      ...options,
      dbDir: originalKeyDir
    }),
    listarTransacoesPendentes: async () => [],
    // NÃO autorizar iniciaClientDestaxa / LOAD nesta sprint
    permitirInicializacaoClientDestaxa: false,
    clientFactory: (clientOptions) => {
      clientRef = new DestaxaNativeHostClient(clientOptions);
      return clientRef;
    }
  });

  const t0 = Date.now();
  const ping = await clientRef.enviar(OPERACOES_HOST.PING);
  const pingMs = Date.now() - t0;

  const t1 = Date.now();
  const status2 = await clientRef.enviar(OPERACOES_HOST.STATUS);
  const statusMs = Date.now() - t1;

  evidencias.nativeHost = {
    pid: handle.status.pid,
    ppid: handle.status.ppid || null,
    processType: handle.status.processType,
    hostSessionId: handle.status.hostSessionId || null,
    securityBootstrapState: handle.status.securityBootstrapState,
    securityBootstrapRevision: handle.status.securityBootstrapRevision,
    gateReal: handle.status.gateReal,
    operacaoAtiva: handle.status.operacaoAtiva,
    dllLoaded: handle.status.diagnostics?.dllLoaded,
    dllLoads: handle.status.contadores?.dllLoads,
    clientInitialized: handle.status.diagnostics?.clientInitialized || false,
    canal: handle.status.processType === 'utilityProcess'
      ? 'Electron utilityProcess IPC (cds-tef-native-host/1)'
      : 'child_process IPC (cds-tef-native-host/1)'
  };

  evidencias.ping = {
    ok: !ping.error && ping.output?.pong === true,
    requestId: ping.requestId || null,
    resultCode: ping.resultCode || null,
    output: ping.output || null,
    error: ping.error || null,
    tempoMs: pingMs
  };

  evidencias.statusPosPing = {
    ok: !status2.error,
    tempoMs: statusMs,
    gateReal: status2.output?.gateReal,
    dllLoaded: status2.output?.diagnostics?.dllLoaded,
    dllLoads: status2.output?.contadores?.dllLoads,
    clientInitialized: status2.output?.diagnostics?.clientInitialized,
    securityBootstrapState: status2.output?.securityBootstrapState,
    error: status2.error || null
  };

  evidencias.destaxa60906 = {
    handshakeProtocolar: 'INIT_CLIENT/iniciaClientDestaxa',
    executado: false,
    motivo: 'Proibição absoluta da sprint 51.34 — iniciaClientDestaxa não autorizado'
  };

  evidencias.gateEnvDepois = process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null;

  const encerramento = await handle.encerrar();
  evidencias.encerramento = encerramento;
  evidencias.fim = new Date().toISOString();

  const seguro = evidencias.nativeHost.dllLoaded === false
    && evidencias.nativeHost.dllLoads === 0
    && evidencias.nativeHost.gateReal === false
    && evidencias.nativeHost.clientInitialized === false
    && evidencias.ping.ok === true
    && evidencias.statusPosPing.dllLoaded === false
    && evidencias.statusPosPing.clientInitialized !== true
    && evidencias.proibicoes.iniciaClientDestaxa === false;

  evidencias.classificacaoSugerida = seguro ? 'PARTIAL_CDS_NATIVEHOST_OK_DESTAXA_HANDSHAKE_PENDENTE' : 'BLOCKED';
  evidencias.sucessoEscopo = seguro;

  fs.writeFileSync(OUT, JSON.stringify(evidencias, null, 2), 'utf8');
  log({ event: 'done', out: OUT, sucessoEscopo: seguro, pid: evidencias.nativeHost.pid });
}

main().catch((error) => {
  const payload = {
    event: 'error',
    codigo: error.code || 'TEF_5134_FALHOU',
    mensagem: error.message
  };
  try {
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
  } catch (_) { /* best-effort */ }
  log(payload);
  process.exitCode = 1;
}).finally(() => {
  try { app.quit(); } catch (_) { /* */ }
});
