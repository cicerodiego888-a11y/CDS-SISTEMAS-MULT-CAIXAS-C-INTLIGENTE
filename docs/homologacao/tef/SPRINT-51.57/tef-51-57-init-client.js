'use strict';

/**
 * SPRINT 51.57 — INIT_CLIENT único (LOAD + iniciaClientDestaxa).
 * Sem TX_*, CRT, ENABLE_REAL, permit, /tef/pagar ou one-shot.
 */

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const OUT = path.join(__dirname, 'evidencias-init.json');
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
  sprint: 'SPRINT-51.57',
  proposito: 'INIT_CLIENT_ONLY',
  inicio: new Date().toISOString(),
  proibicoes: {
    TX_START: true,
    TX_CONTINUE: true,
    TX_FINALIZE: true,
    CRT: true,
    ENABLE_REAL: true,
    permit: true,
    oneShot: true,
    pagar: true
  },
  gateEnv: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
  erpPidEsperado: process.env.CDS_ERP_PID || null,
  vspaguePidEsperado: process.env.CDS_VSPAGUE_PID || null
};

function log(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function coletarRequestIdObservability(hostPid) {
  try {
    const base = process.env.LOCALAPPDATA || '';
    const file = path.join(base, 'CDS-SISTEMAS', 'logs', 'destaxa-nativehost-observability.jsonl');
    if (!fs.existsSync(file)) return null;
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(-80);
    const hits = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        const op = String(e.operacao || e.operation || e.evento || '');
        const pid = e.pid || e.hostPid || e.processId;
        if (/INIT_CLIENT|iniciaClientDestaxa/i.test(op)
          || /INIT_CLIENT|iniciaClientDestaxa/i.test(JSON.stringify(e))) {
          if (hostPid == null || pid == null || Number(pid) === Number(hostPid)) {
            hits.push({
              ts: e.ts || e.timestamp || e.em || null,
              requestId: e.requestId || e.request_id || e.id || null,
              resultCode: e.resultCode || e.codigoDestaxa || e.codigo || null,
              pid: pid || null,
              evento: e.evento || e.operacao || null
            });
          }
        }
      } catch (_) { /* */ }
    }
    return hits.slice(-5);
  } catch (_) {
    return null;
  }
}

async function main() {
  if (transacaoRealHabilitada()) {
    throw Object.assign(new Error('Gate ON — abortar'), { code: 'TEF_5157_GATE_ON' });
  }
  process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
  if (process.arch !== 'x64') {
    throw Object.assign(new Error(`arch ${process.arch}`), { code: 'TEF_5157_ARCH' });
  }
  if (!fs.existsSync(DLL_PATH)) {
    throw Object.assign(new Error('DLL ausente'), { code: 'TEF_5157_DLL' });
  }

  await app.whenReady();
  if (!safeStorage.isEncryptionAvailable()) {
    throw Object.assign(new Error('safeStorage indisponível'), { code: 'TEF_5157_SAFE' });
  }

  const originalKeyDir = process.env.DB_DIR
    || path.join(process.env.ProgramData || 'C:\\ProgramData', 'MercantilFiscal', 'dados');
  const isolatedRoot = path.join(__dirname, '_isolado-51-57');
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
    lerChaveTef: (options) => lerChaveTefPersistida({ ...options, dbDir: originalKeyDir }),
    listarTransacoesPendentes: async () => [],
    permitirInicializacaoClientDestaxa: true,
    clientFactory: (opts) => {
      clientRef = new DestaxaNativeHostClient(opts);
      return clientRef;
    }
  });

  evidencias.nativeHost = {
    pid: handle.status.pid,
    ppid: handle.status.ppid || process.pid,
    hostSessionId: handle.status.hostSessionId || null,
    securityBootstrapState: handle.status.securityBootstrapState,
    gateReal: handle.status.gateReal
  };
  evidencias.probeElectronPid = process.pid;
  log({ event: 'host-ready', ...evidencias.nativeHost });

  const init = await handle.inicializarClientDestaxa({ sdkPath: DLL_PATH });
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
      || init?.statusAposClient?.dllLoaded === true,
    rawKeys: init ? Object.keys(init) : []
  };

  const status = await clientRef.enviar(OPERACOES_HOST.STATUS);
  evidencias.statusFinal = {
    error: status.error || null,
    clientInitialized: status.output?.diagnostics?.clientInitialized
      ?? status.output?.clientInitialized,
    clientResultCode: status.output?.diagnostics?.clientResultCode
      ?? status.output?.clientResultCode,
    gateReal: status.output?.gateReal,
    operacaoAtiva: status.output?.operacaoAtiva,
    dllLoaded: status.output?.diagnostics?.dllLoaded ?? status.output?.dllLoaded
  };

  evidencias.observabilityTail = coletarRequestIdObservability(evidencias.nativeHost.pid);
  const reqHit = (evidencias.observabilityTail || []).slice().reverse()
    .find((h) => h.requestId || h.resultCode === '00' || h.resultCode === 0);
  evidencias.requestId = reqHit?.requestId || null;

  evidencias.ok = codigo === '00'
    && evidencias.statusFinal.clientInitialized === true
    && String(evidencias.statusFinal.clientResultCode) === '00'
    && evidencias.statusFinal.operacaoAtiva == null
    && evidencias.statusFinal.gateReal === false
    && codigo !== 'A1'
    && codigo !== 'F0';

  evidencias.classificacao = evidencias.ok
    ? 'INIT_CLIENT_CONFIRMED'
    : (codigo === 'A1' || codigo === 'F0' ? 'INIT_BLOQUEADO' : 'INIT_FALHOU');
  evidencias.mensagem = evidencias.ok
    ? 'INIT_CLIENT=00 / CLIENT_INITIALIZED — sem operação financeira.'
    : `INIT_CLIENT=${codigo || 'null'} — interromper sem retry.`;
  evidencias.fim = new Date().toISOString();
  evidencias.gateEnvFinal = process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null;

  fs.writeFileSync(OUT, `${JSON.stringify(evidencias, null, 2)}\n`);
  log({
    event: 'done',
    classificacao: evidencias.classificacao,
    codigo,
    ok: evidencias.ok,
    requestId: evidencias.requestId,
    hostPid: evidencias.nativeHost.pid
  });

  try { await handle.encerrar(); } catch (_) { /* */ }
  app.exit(evidencias.ok ? 0 : 2);
}

main().catch((error) => {
  evidencias.abortado = true;
  evidencias.codigoAbort = error.code || 'TEF_5157_ERRO';
  evidencias.mensagem = error.message;
  evidencias.classificacao = 'ABORTADO';
  evidencias.fim = new Date().toISOString();
  try { fs.writeFileSync(OUT, `${JSON.stringify(evidencias, null, 2)}\n`); } catch (_) { /* */ }
  log({ event: 'error', codigo: evidencias.codigoAbort, mensagem: error.message });
  process.exitCode = 1;
  try { app.quit(); } catch (_) { process.exit(1); }
});
