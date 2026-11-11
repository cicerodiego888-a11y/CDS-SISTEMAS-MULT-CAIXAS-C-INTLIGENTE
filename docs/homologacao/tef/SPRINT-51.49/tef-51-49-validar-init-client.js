'use strict';

/**
 * SPRINT 51.49 — Validação INIT_CLIENT somente.
 * Sem TX_START, TX_CONTINUE, TX_FINALIZE, CRT ou permit.
 * Espelha o trecho de prepararAutorizacao até iniciaClientDestaxa, sem /tef/pagar
 * (que persistiria nova tef_transacoes após INIT=00).
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

const MODULE = 'pdv';
const DLL_PATH = path.join(ROOT, 'resources', 'tef', 'destaxa', 'win-x64', 'libdll-integracao-tef.dll');

selecionarPerfilTefExistente({ app, modulo: MODULE });

const evidencias = {
  sprint: 'SPRINT-51.49',
  proposito: 'INIT_CLIENT_ONLY',
  inicio: new Date().toISOString(),
  proibicoes: {
    TX_START: true,
    TX_CONTINUE: true,
    TX_FINALIZE: true,
    CRT: true,
    ENABLE_REAL: true,
    permit: true
  },
  gateEnv: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null
};

function log(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function main() {
  if (transacaoRealHabilitada()) {
    throw Object.assign(new Error('Gate ON — abortar'), { code: 'TEF_5149_GATE_ON' });
  }
  process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
  if (process.arch !== 'x64') {
    throw Object.assign(new Error(`arch ${process.arch}`), { code: 'TEF_5149_ARCH' });
  }
  if (!fs.existsSync(DLL_PATH)) {
    throw Object.assign(new Error('DLL ausente'), { code: 'TEF_5149_DLL' });
  }

  await app.whenReady();
  if (!safeStorage.isEncryptionAvailable()) {
    throw Object.assign(new Error('safeStorage indisponível'), { code: 'TEF_5149_SAFE' });
  }

  const originalKeyDir = process.env.DB_DIR
    || path.join(process.env.ProgramData || 'C:\\ProgramData', 'MercantilFiscal', 'dados');
  const isolatedRoot = path.join(__dirname, '_isolado-51-49');
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
    clientInitialized: init?.statusAposClient?.diagnostics?.clientInitialized === true,
    clientResultCode: init?.statusAposClient?.diagnostics?.clientResultCode || null,
    operacaoAtiva: init?.statusAposClient?.operacaoAtiva ?? null,
    gateReal: init?.statusAposClient?.gateReal,
    dllLoaded: init?.statusAposClient?.diagnostics?.dllLoaded === true,
    requestCorrelacao: 'ver observability iniciaClientDestaxa nesta janela'
  };

  const status = await clientRef.enviar(OPERACOES_HOST.STATUS);
  evidencias.statusFinal = {
    error: status.error || null,
    clientInitialized: status.output?.diagnostics?.clientInitialized,
    clientResultCode: status.output?.diagnostics?.clientResultCode,
    gateReal: status.output?.gateReal,
    operacaoAtiva: status.output?.operacaoAtiva,
    dllLoaded: status.output?.diagnostics?.dllLoaded
  };

  evidencias.ok = codigo === '00'
    && evidencias.statusFinal.clientInitialized === true
    && String(evidencias.statusFinal.clientResultCode) === '00'
    && evidencias.statusFinal.operacaoAtiva == null
    && evidencias.statusFinal.gateReal === false
    && codigo !== 'A1'
    && codigo !== 'F0';

  evidencias.classificacao = evidencias.ok
    ? 'INIT_OK'
    : (codigo === 'A1' || codigo === 'F0' ? 'INIT_BLOQUEADO' : 'INIT_FALHOU');
  evidencias.mensagem = evidencias.ok
    ? 'INIT_CLIENT=00 / CLIENT_INITIALIZED — sem operação financeira.'
    : `INIT_CLIENT=${codigo || 'null'} — interromper sem correção automática.`;
  evidencias.fim = new Date().toISOString();
  evidencias.gateEnvFinal = process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null;

  fs.writeFileSync(OUT, `${JSON.stringify(evidencias, null, 2)}\n`);
  log({ event: 'done', classificacao: evidencias.classificacao, codigo, ok: evidencias.ok });

  try { await handle.encerrar(); } catch (_) { /* */ }
  app.exit(evidencias.ok ? 0 : 2);
}

main().catch((error) => {
  evidencias.abortado = true;
  evidencias.codigoAbort = error.code || 'TEF_5149_ERRO';
  evidencias.mensagem = error.message;
  evidencias.classificacao = 'ABORTADO';
  evidencias.fim = new Date().toISOString();
  try { fs.writeFileSync(OUT, `${JSON.stringify(evidencias, null, 2)}\n`); } catch (_) { /* */ }
  log({ event: 'error', codigo: evidencias.codigoAbort, mensagem: error.message });
  process.exitCode = 1;
  try { app.quit(); } catch (_) { process.exit(1); }
});
