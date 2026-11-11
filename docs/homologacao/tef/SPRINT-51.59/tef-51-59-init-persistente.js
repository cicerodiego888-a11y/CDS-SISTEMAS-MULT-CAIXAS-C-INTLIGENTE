'use strict';

/**
 * SPRINT 51.59 — INIT_CLIENT único com NativeHost PERSISTENTE.
 * Não chama encerrar/SHUTDOWN após INIT.
 * Sem TX_*, CRT, ENABLE_REAL, permit, /tef/pagar, one-shot.
 */

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const OUT = path.join(__dirname, 'evidencias-init.json');
const ALIVE = path.join(__dirname, 'session-alive.json');
const {
  selecionarPerfilTefExistente
} = require(path.join(ROOT, 'backend/services/tef/tefCryptoProfileProvisioner'));
const {
  lerChaveTefPersistida
} = require(path.join(ROOT, 'backend/services/tef/tefSigningKeyProvisioner'));
const {
  inicializarNativeHostIsolado
} = require(path.join(ROOT, 'backend/services/tef/destaxa/tefNativeHostBootstrapIsolado'));
const {
  OPERACOES_HOST
} = require(path.join(ROOT, 'backend/services/tef/destaxa/destaxaNativeHostProtocolo'));
const { DestaxaNativeHostClient } = require(path.join(
  ROOT, 'backend/services/tef/destaxa/DestaxaNativeHostClient'
));
const { transacaoRealHabilitada } = require(path.join(
  ROOT, 'backend/services/tef/destaxa/destaxaConstantes'
));

const MODULE = 'erp';
const DLL_PATH = path.join(ROOT, 'resources', 'tef', 'destaxa', 'win-x64', 'libdll-integracao-tef.dll');

selecionarPerfilTefExistente({ app, modulo: MODULE });

const evidencias = {
  sprint: 'SPRINT-51.59',
  proposito: 'INIT_CLIENT_PERSISTENTE',
  inicio: new Date().toISOString(),
  proibicoes: {
    TX_START: true,
    TX_CONTINUE: true,
    TX_FINALIZE: true,
    CRT: true,
    ENABLE_REAL: true,
    permit: true,
    oneShot: true,
    pagar: true,
    encerrarHostAposInit: true
  },
  gateEnv: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
  erpPid: process.env.CDS_ERP_PID || null,
  vspaguePid: process.env.CDS_VSPAGUE_PID || null
};

let clientRef = null;
let handleRef = null;
let heartbeatTimer = null;

function log(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function gravar(file, obj) {
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
}

async function lerStatus() {
  const status = await clientRef.enviar(OPERACOES_HOST.STATUS);
  return {
    error: status.error || null,
    clientInitialized: status.output?.diagnostics?.clientInitialized
      ?? status.output?.clientInitialized,
    clientResultCode: status.output?.diagnostics?.clientResultCode
      ?? status.output?.clientResultCode,
    gateReal: status.output?.gateReal,
    operacaoAtiva: status.output?.operacaoAtiva,
    dllLoaded: status.output?.diagnostics?.dllLoaded ?? status.output?.dllLoaded,
    hostPid: evidencias.nativeHost?.pid || null,
    hostSessionId: evidencias.nativeHost?.hostSessionId || null
  };
}

async function main() {
  if (transacaoRealHabilitada()) {
    throw Object.assign(new Error('Gate ON — abortar'), { code: 'TEF_5159_GATE_ON' });
  }
  process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
  if (process.arch !== 'x64') {
    throw Object.assign(new Error(`arch ${process.arch}`), { code: 'TEF_5159_ARCH' });
  }
  if (!fs.existsSync(DLL_PATH)) {
    throw Object.assign(new Error('DLL ausente'), { code: 'TEF_5159_DLL' });
  }

  await app.whenReady();
  if (!safeStorage.isEncryptionAvailable()) {
    throw Object.assign(new Error('safeStorage indisponível'), { code: 'TEF_5159_SAFE' });
  }

  const originalKeyDir = process.env.DB_DIR
    || path.join(process.env.ProgramData || 'C:\\ProgramData', 'MercantilFiscal', 'dados');
  const isolatedRoot = path.join(__dirname, '_isolado-51-59');
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

  handleRef = await inicializarNativeHostIsolado({
    app,
    modulo: MODULE,
    safeStorage,
    env,
    dbDir: isolatedDatabaseDir,
    databasePath: isolatedDatabasePath,
    lerChaveTef: (options) => lerChaveTefPersistida({ ...options, dbDir: originalKeyDir }),
    listarTransacoesPendentes: async () => [],
    permitirInicializacaoClientDestaxa: true,
    clientFactory: (opts) => {
      clientRef = new DestaxaNativeHostClient(opts);
      return clientRef;
    }
  });

  evidencias.nativeHost = {
    pid: handleRef.status.pid,
    ppid: handleRef.status.ppid || process.pid,
    hostSessionId: handleRef.status.hostSessionId || null,
    securityBootstrapState: handleRef.status.securityBootstrapState,
    gateReal: handleRef.status.gateReal
  };
  evidencias.probeElectronPid = process.pid;
  log({ event: 'host-ready', ...evidencias.nativeHost });

  // Único INIT_CLIENT
  const init = await handleRef.inicializarClientDestaxa({ sdkPath: DLL_PATH });
  const codigo = String(
    init?.client?.codigoDestaxa
    || init?.statusAposClient?.diagnostics?.clientResultCode
    || ''
  ).toUpperCase();

  evidencias.initClient = {
    codigoDestaxa: codigo || null,
    clientSucesso: init?.client?.sucesso === true,
    bloqueadoA1: init?.client?.bloqueadoA1 === true,
    mensagem: init?.client?.mensagem || null,
    clientInitialized: init?.statusAposClient?.diagnostics?.clientInitialized === true
      || init?.statusAposClient?.clientInitialized === true,
    clientResultCode: init?.statusAposClient?.diagnostics?.clientResultCode
      || init?.statusAposClient?.clientResultCode
      || null,
    operacaoAtiva: init?.statusAposClient?.operacaoAtiva ?? null,
    gateReal: init?.statusAposClient?.gateReal,
    dllLoaded: init?.statusAposClient?.diagnostics?.dllLoaded === true
      || init?.statusAposClient?.dllLoaded === true
  };

  evidencias.statusFinal = await lerStatus();
  evidencias.requestId = null;
  try {
    const obs = path.join(process.env.LOCALAPPDATA || '', 'CDS-SISTEMAS', 'logs', 'destaxa-nativehost-observability.jsonl');
    if (fs.existsSync(obs)) {
      const lines = fs.readFileSync(obs, 'utf8').trim().split(/\r?\n/).slice(-40);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          const e = JSON.parse(lines[i]);
          if (String(e.operation || e.operacao || '') === 'INIT_CLIENT' && e.requestId) {
            evidencias.requestId = e.requestId;
            break;
          }
        } catch (_) { /* */ }
      }
    }
  } catch (_) { /* */ }

  evidencias.ok = codigo === '00'
    && evidencias.statusFinal.clientInitialized === true
    && String(evidencias.statusFinal.clientResultCode) === '00'
    && evidencias.statusFinal.operacaoAtiva == null
    && evidencias.statusFinal.gateReal === false
    && codigo !== 'A1'
    && codigo !== 'F0';

  evidencias.classificacao = evidencias.ok
    ? 'INIT_CLIENT_CONFIRMED_SESSION_ACTIVE'
    : (codigo === 'A1' || codigo === 'F0' ? 'INIT_BLOQUEADO' : 'INIT_FALHOU');
  evidencias.mensagem = evidencias.ok
    ? 'INIT_CLIENT=00 / CLIENT_INITIALIZED — NativeHost mantido ATIVO.'
    : `INIT_CLIENT=${codigo || 'null'} — interromper sem retry.`;
  evidencias.hostEncerradoAposInit = false;
  evidencias.fimInit = new Date().toISOString();
  evidencias.gateEnvFinal = process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null;

  gravar(OUT, evidencias);
  log({
    event: 'init-done',
    classificacao: evidencias.classificacao,
    codigo,
    ok: evidencias.ok,
    requestId: evidencias.requestId,
    hostPid: evidencias.nativeHost.pid,
    hostSessionId: evidencias.nativeHost.hostSessionId,
    persistente: true
  });

  if (!evidencias.ok) {
    // Falha: não manter sessão inconsistente — mas também não repetir INIT.
    try { await handleRef.encerrar(); } catch (_) { /* */ }
    app.exit(2);
    return;
  }

  // Heartbeat: manter processo vivo e confirmar sessão periodicamente (sem novo INIT).
  const tick = async () => {
    try {
      const st = await lerStatus();
      const alive = {
        em: new Date().toISOString(),
        sprint: 'SPRINT-51.59',
        hostPid: evidencias.nativeHost.pid,
        hostSessionId: evidencias.nativeHost.hostSessionId,
        requestIdInit: evidencias.requestId,
        probeElectronPid: process.pid,
        gateEnv: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
        status: st,
        sessaoAtiva: st.clientInitialized === true
          && String(st.clientResultCode) === '00'
          && st.gateReal === false
          && st.operacaoAtiva == null
      };
      gravar(ALIVE, alive);
      log({ event: 'heartbeat', sessaoAtiva: alive.sessaoAtiva, hostPid: alive.hostPid });
      if (!alive.sessaoAtiva) {
        evidencias.classificacao = 'SESSION_LOST_AFTER_INIT';
        evidencias.statusHeartbeatFalha = st;
        gravar(OUT, evidencias);
      }
    } catch (error) {
      log({ event: 'heartbeat-error', mensagem: error.message });
    }
  };

  await tick();
  heartbeatTimer = setInterval(tick, 15000);
  // Não chamar app.exit — sessão persistente.
}

main().catch((error) => {
  evidencias.abortado = true;
  evidencias.codigoAbort = error.code || 'TEF_5159_ERRO';
  evidencias.mensagem = error.message;
  evidencias.classificacao = 'ABORTADO';
  evidencias.fimInit = new Date().toISOString();
  try { gravar(OUT, evidencias); } catch (_) { /* */ }
  log({ event: 'error', codigo: evidencias.codigoAbort, mensagem: error.message });
  process.exitCode = 1;
  try { app.quit(); } catch (_) { process.exit(1); }
});
