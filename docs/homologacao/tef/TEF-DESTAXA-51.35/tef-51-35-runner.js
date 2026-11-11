'use strict';

/**
 * TEF-DESTAXA-51.35 — LOAD + INIT_CLIENT somente.
 * Sem TX_*, sem ENABLE_REAL, sem COM4 pagamento, gate OFF.
 * Mantém NativeHost vivo para inspeção se INIT OK.
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
const destaxaLogger = require(path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaLogger'));

const OUT = path.join(__dirname, 'evidencias-51-35.json');
const READY_FLAG = path.join(__dirname, 'keep-alive-ready.flag');
const MODULE = 'pdv';
const DLL_PATH = path.join(ROOT, 'resources', 'tef', 'destaxa', 'win-x64', 'libdll-integracao-tef.dll');

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
    sprint: 'TEF-DESTAXA-51.35',
    inicio,
    gateEnvAntes: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
    dllPath: DLL_PATH,
    dllExists: fs.existsSync(DLL_PATH),
    arch: process.arch,
    proibicoesRespeitadas: {
      TX_START: true,
      TX_CONTINUE: true,
      TX_FINALIZE: true,
      CRT: true,
      ENABLE_REAL: true,
      COM4_pagamento: true
    }
  };

  if (String(process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '').trim() === '1') {
    throw criarErro('TEF_5135_GATE_ON', 'Gate financeiro ligado — abortar');
  }
  if (process.arch !== 'x64') {
    throw criarErro('TEF_5135_ARCH', `Arquitetura ${process.arch} — esperado x64`);
  }
  if (!evidencias.dllExists) {
    throw criarErro('TEF_5135_DLL_AUSENTE', `DLL ausente: ${DLL_PATH}`);
  }

  process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
  selecionarPerfilTefExistente({ app, modulo: MODULE });
  await app.whenReady();
  if (!safeStorage.isEncryptionAvailable()) {
    throw criarErro('TEF_5135_SAFE_STORAGE', 'safeStorage indisponível');
  }

  const originalKeyDir = process.env.DB_DIR
    || path.join(process.env.ProgramData || 'C:\\ProgramData', 'MercantilFiscal', 'dados');
  const isolatedRoot = path.join(__dirname, '_isolado-51-35');
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
  const tBoot = Date.now();
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
    permitirInicializacaoClientDestaxa: true,
    clientFactory: (clientOptions) => {
      clientRef = new DestaxaNativeHostClient(clientOptions);
      return clientRef;
    }
  });
  evidencias.bootstrapMs = Date.now() - tBoot;
  evidencias.nativeHost = {
    pid: handle.status.pid,
    ppid: handle.status.ppid || null,
    processType: handle.status.processType,
    hostSessionId: handle.status.hostSessionId || null,
    securityBootstrapState: handle.status.securityBootstrapState,
    securityBootstrapRevision: handle.status.securityBootstrapRevision,
    gateReal: handle.status.gateReal,
    dllLoadedAntes: handle.status.diagnostics?.dllLoaded,
    dllLoadsAntes: handle.status.contadores?.dllLoads
  };

  log({
    event: 'nativehost-ready',
    pid: evidencias.nativeHost.pid,
    bootstrap: evidencias.nativeHost.securityBootstrapState
  });

  const tInit = Date.now();
  let inicializacao = null;
  let initError = null;
  try {
    inicializacao = await handle.inicializarClientDestaxa({
      sdkPath: DLL_PATH
    });
  } catch (error) {
    initError = {
      code: error.code || 'TEF_5135_INIT_FALHOU',
      message: error.message,
      detalhes: error.detalhes || null
    };
  }
  evidencias.initMs = Date.now() - tInit;

  evidencias.load = inicializacao ? {
    sucesso: inicializacao.dll?.sucesso === true,
    codigo: inicializacao.dll?.codigo || null,
    mensagem: inicializacao.dll?.mensagem || null,
    statusAposLoad: {
      dllLoaded: inicializacao.statusAposLoad?.diagnostics?.dllLoaded,
      exportsValid: inicializacao.statusAposLoad?.diagnostics?.exportsValid,
      dllPath: inicializacao.statusAposLoad?.diagnostics?.dllPath,
      dllLoads: inicializacao.statusAposLoad?.contadores?.dllLoads,
      processArch: inicializacao.statusAposLoad?.diagnostics?.processArch,
      dllArch: inicializacao.statusAposLoad?.diagnostics?.dllArch,
      gateReal: inicializacao.statusAposLoad?.gateReal
    }
  } : null;

  evidencias.initClient = inicializacao ? {
    sucesso: inicializacao.sucesso === true,
    codigo: inicializacao.client?.codigo || null,
    codigoDestaxa: inicializacao.client?.codigoDestaxa || null,
    descricao: inicializacao.client?.descricaoCodigo || null,
    mensagem: inicializacao.client?.mensagem || null,
    estado: inicializacao.client?.estado || null,
    duracaoMs: inicializacao.client?.duracaoMs ?? null,
    statusAposClient: {
      clientInitialized: inicializacao.statusAposClient?.diagnostics?.clientInitialized,
      clientResultCode: inicializacao.statusAposClient?.diagnostics?.clientResultCode,
      dllLoaded: inicializacao.statusAposClient?.diagnostics?.dllLoaded,
      dllLoads: inicializacao.statusAposClient?.contadores?.dllLoads,
      gateReal: inicializacao.statusAposClient?.gateReal,
      operacaoAtiva: inicializacao.statusAposClient?.operacaoAtiva
    }
  } : { sucesso: false, erro: initError };

  evidencias.initError = initError;

  const tStatus = Date.now();
  const statusFinal = await clientRef.enviar(OPERACOES_HOST.STATUS);
  evidencias.statusFinalMs = Date.now() - tStatus;
  evidencias.statusFinal = {
    ok: !statusFinal.error,
    error: statusFinal.error || null,
    gateReal: statusFinal.output?.gateReal,
    operacaoAtiva: statusFinal.output?.operacaoAtiva,
    dllLoaded: statusFinal.output?.diagnostics?.dllLoaded,
    exportsValid: statusFinal.output?.diagnostics?.exportsValid,
    dllPath: statusFinal.output?.diagnostics?.dllPath,
    dllLoads: statusFinal.output?.contadores?.dllLoads,
    clientInitialized: statusFinal.output?.diagnostics?.clientInitialized,
    clientResultCode: statusFinal.output?.diagnostics?.clientResultCode,
    estado: statusFinal.output?.diagnostics?.estado,
    securityBootstrapState: statusFinal.output?.securityBootstrapState
  };

  // Correlação: última iniciaClientDestaxa no log de auditoria Destaxa
  try {
    const logPath = destaxaLogger.obterArquivoAuditoria();
    evidencias.observabilityPath = logPath;
    if (fs.existsSync(logPath)) {
      const linhas = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-80);
      const correlacao = [];
      for (const linha of linhas) {
        try {
          const ev = JSON.parse(linha);
          if (ev.functionName === 'iniciaClientDestaxa'
            || ev.evento === 'client.init.start'
            || ev.evento === 'client.init.end'
            || (ev.evento === 'native.call.enter' && ev.functionName === 'iniciaClientDestaxa')
            || (ev.evento === 'native.call.exit' && ev.functionName === 'iniciaClientDestaxa')) {
            correlacao.push({
              evento: ev.evento || null,
              functionName: ev.functionName || null,
              requestId: ev.requestId || null,
              resultCode: ev.resultCode || ev.codigo || null,
              registradoEm: ev.registradoEm || null
            });
          }
        } catch (_) { /* ignore */ }
      }
      evidencias.correlacao = correlacao.slice(-20);
    }
  } catch (errLog) {
    evidencias.correlacaoErro = errLog.message;
  }

  evidencias.gateEnvDepois = process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null;
  evidencias.fim = new Date().toISOString();

  const ready = evidencias.load?.sucesso === true
    && evidencias.initClient?.sucesso === true
    && evidencias.statusFinal?.dllLoaded === true
    && evidencias.statusFinal?.clientInitialized === true
    && String(evidencias.statusFinal?.clientResultCode || '') === '00'
    && evidencias.statusFinal?.gateReal === false
    && evidencias.statusFinal?.operacaoAtiva == null;

  evidencias.classificacao = ready ? 'READY' : (evidencias.load?.sucesso ? 'PARTIAL' : 'BLOCKED');
  evidencias.keepAlive = ready === true;

  fs.writeFileSync(OUT, JSON.stringify(evidencias, null, 2), 'utf8');
  log({
    event: 'done',
    out: OUT,
    classificacao: evidencias.classificacao,
    keepAlive: evidencias.keepAlive,
    nativeHostPid: evidencias.nativeHost.pid,
    clientResultCode: evidencias.statusFinal?.clientResultCode || null
  });

  if (ready) {
    fs.writeFileSync(READY_FLAG, JSON.stringify({
      readyAt: new Date().toISOString(),
      nativeHostPid: evidencias.nativeHost.pid,
      parentPid: process.pid
    }), 'utf8');
    log({ event: 'keep-alive', message: 'NativeHost mantido para inspeção — sem TX' });
    // Não encerra Host nem app — inspeção assistida.
    return;
  }

  // Falha: encerrar de forma controlada
  try {
    const enc = await handle.encerrar();
    evidencias.encerramento = enc;
    fs.writeFileSync(OUT, JSON.stringify(evidencias, null, 2), 'utf8');
  } catch (errEnc) {
    evidencias.encerramentoErro = errEnc.message;
    fs.writeFileSync(OUT, JSON.stringify(evidencias, null, 2), 'utf8');
  }
  app.quit();
}

main().catch((error) => {
  const payload = {
    event: 'error',
    codigo: error.code || 'TEF_5135_FALHOU',
    mensagem: error.message,
    em: new Date().toISOString()
  };
  try { fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8'); } catch (_) { /* */ }
  log(payload);
  process.exitCode = 1;
  try { app.quit(); } catch (_) { /* */ }
});
