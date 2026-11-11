'use strict';

/**
 * SPRINT 51.47 — Execução controlada FINALIZE(0) / RECUPERACAO_PROTOCOLAR_TX3.
 *
 * Autorização PO 10/11/2026: exclusivamente finalizaTransacaoDestaxa(0) da TX 3.
 * Sem CRT, TX_START, TX_CONTINUE, FINALIZE(9), retry, gate ON, alteração TX/venda.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { pathToFileURL } = require('url');
const sqlite3 = require('sqlite3').verbose();
const { app, safeStorage } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const OUT_DIR = __dirname;
const RESULT = path.join(OUT_DIR, 'resultado-execucao.json');
const AUDIT = path.join(OUT_DIR, 'auditoria-fases.jsonl');

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
  OPERACOES_HOST,
  OPERACOES_TRANSACIONAIS,
  PROTOCOLO,
  ESTADOS_BOOTSTRAP
} = require(path.join(ROOT, 'backend/services/tef/destaxa/destaxaNativeHostProtocolo'));
const { DestaxaNativeHostClient } = require(path.join(
  ROOT, 'backend/services/tef/destaxa/DestaxaNativeHostClient'
));
const evidenceModule = require(path.join(ROOT, 'backend/services/tef/tefReconciliationEvidence'));
const {
  PATH_NOME,
  OPERACAO_AUTORIZADA,
  criarPermitRecuperacaoTx3,
  montarAutorizacaoFinalizarSemContextoCrt,
  avaliarExclusividadePendenciaDestaxa,
  classificarInitClientParaRecuperacao,
  validarIdentidadeTx3
} = require(path.join(ROOT, 'backend/services/tef/destaxa/tefRecuperacaoProtocolarTx3'));
const { TOKEN_GO_PO } = require(path.join(
  ROOT, 'backend/services/tef/destaxa/tefRunnerRecuperacaoProtocolarTx3'
));
const { FINALIZACAO_CONFIRMAR, transacaoRealHabilitada } = require(path.join(
  ROOT, 'backend/services/tef/destaxa/destaxaConstantes'
));
const destaxaLogger = require(path.join(ROOT, 'backend/services/tef/destaxa/destaxaLogger'));

const MODULE = 'pdv';
const DLL_PATH = path.join(ROOT, 'resources', 'tef', 'destaxa', 'win-x64', 'libdll-integracao-tef.dll');
const DB_PATH = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const SPRINT = 'SPRINT-51.47';

// Obrigatório antes de app.whenReady / qualquer await do main.
selecionarPerfilTefExistente({ app, modulo: MODULE });

const evidencias = {
  sprint: SPRINT,
  path: PATH_NOME,
  inicio: new Date().toISOString(),
  autorizacaoPo: {
    data: '2026-11-10',
    tokenGoPo: TOKEN_GO_PO,
    escopo: {
      tefId: 3,
      vendaId: 66,
      valor: 1,
      nsu: '2338',
      nsuRede: '241255',
      autorizacao: '211139',
      vespague: '10100017275707',
      terminal: 'TACB0120',
      operacao: 'finalizaTransacaoDestaxa(0)'
    }
  },
  gateEnv: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
  prevalidacoes: null,
  exclusividade: null,
  sessao: null,
  permit: null,
  initClientAtual: null,
  enableReal: null,
  finalize: null,
  initClientPos: null,
  posLeituraCds: null,
  chamadasFinalize: 0,
  novaCobranca: false,
  classificacao: 'PENDENTE',
  abortado: false,
  codigoAbort: null,
  mensagem: null
};

function logFase(fase, evento, detalhes = {}) {
  const linha = {
    ts: new Date().toISOString(),
    sprint: SPRINT,
    fase,
    evento,
    ...detalhes
  };
  fs.appendFileSync(AUDIT, `${JSON.stringify(linha)}\n`);
  process.stdout.write(`${JSON.stringify(linha)}\n`);
}

function criarErro(code, message, detalhes = null) {
  const error = new Error(message);
  error.code = code;
  if (detalhes) error.detalhes = detalhes;
  return error;
}

function gravarResultado() {
  evidencias.fim = new Date().toISOString();
  evidencias.gateEnvFinal = process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null;
  fs.writeFileSync(RESULT, `${JSON.stringify(evidencias, null, 2)}\n`);
}

function dbGet(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbAll(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function snapshotCds() {
  const uri = `${pathToFileURL(path.resolve(DB_PATH)).href}?mode=ro&immutable=1`;
  const database = await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(uri, sqlite3.OPEN_READONLY | sqlite3.OPEN_URI, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
  try {
    const linha = await dbGet(database, 'SELECT * FROM tef_transacoes WHERE id = 3');
    const venda = await dbGet(
      database,
      'SELECT id, total, status, status_pagamento, tef_transacao_id, forma_pagamento FROM vendas WHERE id = 66'
    );
    const pendentes = await dbAll(
      database,
      "SELECT id, status, nsu, autorizacao FROM tef_transacoes WHERE status = 'pendente'"
    );
    const maxId = await dbGet(database, 'SELECT MAX(id) AS maxId FROM tef_transacoes');
    const tx2 = await dbGet(
      database,
      'SELECT id, status, nsu, autorizacao, venda_id FROM tef_transacoes WHERE id = 2'
    );
    return {
      tx3: linha
        ? {
            id: linha.id,
            status: linha.status,
            nsu: linha.nsu,
            nsu_host: linha.nsu_host || null,
            autorizacao: linha.autorizacao,
            venda_id: linha.venda_id,
            valor: linha.valor,
            idempotency_key: linha.idempotency_key,
            comprovante_cliente_len: linha.comprovante_cliente
              ? String(linha.comprovante_cliente).length
              : 0,
            comprovante_loja_len: linha.comprovante_loja
              ? String(linha.comprovante_loja).length
              : 0
          }
        : null,
      venda66: venda || null,
      pendentes,
      maxTefId: maxId?.maxId ?? null,
      tx2: tx2 || null,
      linhaCompleta: linha || null
    };
  } finally {
    await new Promise((resolve) => database.close(() => resolve()));
  }
}

async function prevalidarCds() {
  const snap = await snapshotCds();
  const linha = snap.linhaCompleta;
  const venda = snap.venda66;
  if (!linha) throw criarErro('TEF_5147_TX3_AUSENTE', 'TX 3 ausente no banco oficial.');
  if (String(linha.status).toLowerCase() !== 'aprovado') {
    throw criarErro('TEF_5147_TX3_NAO_APROVADO', `TX 3 status=${linha.status}; esperado aprovado.`);
  }
  validarIdentidadeTx3({
    linha,
    venda,
    pedido: {
      transacaoId: 3,
      operador: 'PO/Cicero — SPRINT-51.47',
      confirmacaoExplicitaPo: true
    }
  });
  if (Number(venda.tef_transacao_id) !== 3) {
    throw criarErro('TEF_5147_VENDA_VINCULO', 'Venda 66 não vinculada à TX 3.');
  }
  if (snap.pendentes.length > 0) {
    throw criarErro('TEF_5147_OUTRAS_PENDENCIAS_CDS', 'Há pendências CDS além do escopo.', {
      pendentes: snap.pendentes
    });
  }
  return snap;
}

function checarDuplicidadeAmbiente() {
  let vspague = [];
  let electronWorkspace = [];
  try {
    const raw = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -match \'VSPague|electron\' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"',
      { encoding: 'utf8', windowsHide: true }
    );
    const parsed = JSON.parse(raw || '[]');
    const lista = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    vspague = lista.filter((p) => /VSPague/i.test(String(p.Name || '')));
    electronWorkspace = lista.filter((p) =>
      /electron/i.test(String(p.Name || ''))
      && /electron-pdv|electron-erp|tef-51-47|SPRINT-51\.47/i.test(String(p.CommandLine || ''))
    );
  } catch (error) {
    return {
      ok: false,
      codigo: 'TEF_5147_AMBIENTE_INSPECION_FALHOU',
      mensagem: error.message
    };
  }
  if (vspague.length > 1) {
    return {
      ok: false,
      codigo: 'TEF_5147_VESPAGUE_DUPLICADO',
      mensagem: 'Mais de um V$Pague Client — abortar sem inicializar outro.',
      vspague
    };
  }
  if (vspague.length === 0) {
    return {
      ok: false,
      codigo: 'TEF_5147_VESPAGUE_AUSENTE',
      mensagem: 'V$Pague Client não está ativo na sessão esperada.',
      vspague
    };
  }
  return {
    ok: true,
    vspague,
    electronWorkspaceConcorrente: electronWorkspace.filter((p) => Number(p.ProcessId) !== process.pid),
    mensagem: 'Um V$Pague Client ativo; sem segundo Client.'
  };
}

function criarClaimsBootstrap({
  hostSessionId,
  revision,
  blockedIdentities,
  operation = null,
  transactionId = null
}) {
  const identidades = Array.isArray(blockedIdentities) ? blockedIdentities.slice() : [];
  const bootstrapId = crypto.randomBytes(16).toString('hex');
  const tid = transactionId == null ? null : String(transactionId);
  const op = operation || null;
  let permit = null;
  if (op && tid && OPERACOES_TRANSACIONAIS.has(op)) {
    if (op !== 'TX_FINALIZE' || tid !== '3') {
      throw criarErro(
        'TEF_5147_PERMIT_FORA_ESCOPO',
        `Bootstrap só autoriza TX_FINALIZE/transactionId=3 (recebido ${op}/${tid}).`
      );
    }
    if (identidades.some((i) => String(i.transactionId) === '3')) {
      throw criarErro(
        'TEF_5147_PERMIT_BLOQUEADO_IDENTIDADE',
        'transactionId=3 está em blockedIdentities — permit de FINALIZE impossível.'
      );
    }
    permit = { permitId: bootstrapId, operation: op, transactionId: tid };
  }
  return {
    version: 1,
    protocol: PROTOCOLO,
    hostSessionId,
    bootstrapId,
    revision,
    issuedAt: Date.now(),
    recoveryComplete: true,
    recoveryResult: 'SUCCESS',
    securityState: identidades.length ? ESTADOS_BOOTSTRAP.BLOCKED : ESTADOS_BOOTSTRAP.VALIDATED,
    blockedIdentities: identidades,
    permit
  };
}

async function main() {
  fs.writeFileSync(AUDIT, '');
  logFase('BOOT', 'INICIO', { pid: process.pid, electron: process.versions.electron || null });

  if (transacaoRealHabilitada()) {
    throw criarErro('TEF_5147_GATE_ON', 'Gate DESTAXA_REAL_TRANSACTION_ENABLED=1 — abortar.');
  }
  process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';

  if (process.arch !== 'x64') {
    throw criarErro('TEF_5147_ARCH', `Arquitetura ${process.arch}; esperado x64.`);
  }
  if (!fs.existsSync(DLL_PATH)) {
    throw criarErro('TEF_5147_DLL_AUSENTE', `DLL ausente: ${DLL_PATH}`);
  }

  const ambiente = checarDuplicidadeAmbiente();
  evidencias.ambiente = ambiente;
  if (!ambiente.ok) {
    throw criarErro(ambiente.codigo, ambiente.mensagem, ambiente);
  }
  logFase('PRECHECK', 'AMBIENTE_OK', {
    vspaguePid: ambiente.vspague[0]?.ProcessId || null
  });

  const pre = await prevalidarCds();
  evidencias.prevalidacoes = {
    ok: true,
    snapshot: {
      tx3: pre.tx3,
      venda66: pre.venda66,
      pendentes: pre.pendentes,
      maxTefId: pre.maxTefId,
      tx2: pre.tx2
    }
  };
  logFase('PRECHECK', 'CDS_OK', evidencias.prevalidacoes.snapshot.tx3);

  await app.whenReady();
  if (!safeStorage.isEncryptionAvailable()) {
    throw criarErro('TEF_5147_SAFE_STORAGE', 'safeStorage indisponível.');
  }

  const originalKeyDir = process.env.DB_DIR
    || path.join(process.env.ProgramData || 'C:\\ProgramData', 'MercantilFiscal', 'dados');
  const isolatedRoot = path.join(__dirname, '_isolado-51-47');
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
  let segredoRef = null;
  const handle = await inicializarNativeHostIsolado({
    app,
    modulo: MODULE,
    safeStorage,
    env,
    dbDir: isolatedDatabaseDir,
    databasePath: isolatedDatabasePath,
    lerChaveTef: (options) => {
      segredoRef = lerChaveTefPersistida({
        ...options,
        dbDir: originalKeyDir
      });
      return segredoRef;
    },
    listarTransacoesPendentes: async () => [],
    permitirInicializacaoClientDestaxa: true,
    clientFactory: (clientOptions) => {
      clientRef = new DestaxaNativeHostClient(clientOptions);
      return clientRef;
    }
  });

  evidencias.sessao = {
    nativeHostPid: handle.status.pid,
    ppid: handle.status.ppid || null,
    hostSessionId: handle.status.hostSessionId || null,
    securityBootstrapState: handle.status.securityBootstrapState,
    gateReal: handle.status.gateReal,
    dllLoadedAntes: handle.status.diagnostics?.dllLoaded
  };
  logFase('HOST', 'NATIVEHOST_READY', evidencias.sessao);

  // Provider de recuperação: só emite permit TX_FINALIZE/3 sob demanda.
  clientRef.configurarProvedorBootstrapSeguranca(async ({ hostSessionId, revision, operation, transactionId }) => {
    const claims = criarClaimsBootstrap({
      hostSessionId,
      revision,
      blockedIdentities: [],
      operation,
      transactionId
    });
    const prev = process.env.TEF_ENCRYPTION_KEY;
    process.env.TEF_ENCRYPTION_KEY = segredoRef;
    try {
      return evidenceModule.assinarBootstrapSeguranca(claims);
    } finally {
      if (prev == null) delete process.env.TEF_ENCRYPTION_KEY;
      else process.env.TEF_ENCRYPTION_KEY = prev;
    }
  });

  // INIT_CLIENT único (atual) — A1 histórico NÃO substitui.
  const initAtual = await handle.inicializarClientDestaxa({ sdkPath: DLL_PATH });
  const codigoInit = String(
    initAtual?.client?.codigoDestaxa
    || initAtual?.statusAposClient?.diagnostics?.clientResultCode
    || ''
  ).toUpperCase();
  evidencias.initClientAtual = {
    sucessoDll: initAtual?.dll?.sucesso === true,
    codigoDestaxa: codigoInit || null,
    clientSucesso: initAtual?.client?.sucesso === true,
    bloqueadoA1: initAtual?.client?.bloqueadoA1 === true,
    mensagem: initAtual?.client?.mensagem || null,
    statusAposClient: {
      clientInitialized: initAtual?.statusAposClient?.diagnostics?.clientInitialized,
      clientResultCode: initAtual?.statusAposClient?.diagnostics?.clientResultCode,
      dllLoaded: initAtual?.statusAposClient?.diagnostics?.dllLoaded,
      operacaoAtiva: initAtual?.statusAposClient?.operacaoAtiva,
      gateReal: initAtual?.statusAposClient?.gateReal
    },
    leituraNativaAtual: true,
    fonte: `NativeHost pid=${handle.status.pid} INIT_CLIENT SPRINT-51.47`
  };
  logFase('INIT', 'INIT_CLIENT_ATUAL', {
    codigo: codigoInit,
    leituraNativaAtual: true
  });

  const classificado = classificarInitClientParaRecuperacao(codigoInit);
  if (!classificado.prosseguirFinalize) {
    evidencias.abortado = true;
    evidencias.codigoAbort = codigoInit === '00'
      ? 'TEF_5147_INIT_00'
      : codigoInit === 'F0'
        ? 'TEF_5147_INIT_F0'
        : 'TEF_5147_INIT_NAO_A1';
    evidencias.mensagem = classificado.mensagem;
    evidencias.classificacao = 'ABORTADO_PRE_FINALIZE';
    await handle.encerrar();
    gravarResultado();
    app.exit(2);
    return;
  }

  const exclusividade = avaliarExclusividadePendenciaDestaxa({
    codigoInitClient: codigoInit,
    nsu: OPERACAO_AUTORIZADA.nsu,
    autorizacao: OPERACAO_AUTORIZADA.autorizacao,
    codigoVespague: OPERACAO_AUTORIZADA.codigoVespague,
    pendenciasOperacionaisCds: pre.pendentes,
    finalizeDestaxaPosteriorATx3: false,
    multiplasPendenciasDestaxa: false,
    confirmacaoExclusividadePo: true,
    fonteEvidenciaA1: evidencias.initClientAtual.fonte
  });
  evidencias.exclusividade = exclusividade;
  if (!exclusividade.ok) {
    evidencias.abortado = true;
    evidencias.codigoAbort = exclusividade.codigo;
    evidencias.mensagem = exclusividade.mensagem;
    evidencias.classificacao = 'ABORTADO_EXCLUSIVIDADE';
    await handle.encerrar();
    gravarResultado();
    app.exit(2);
    return;
  }
  logFase('EXCLUSIVIDADE', 'OK', exclusividade.correlacao);

  const permitDoc = criarPermitRecuperacaoTx3({
    dryRun: false,
    operador: 'PO/Cicero — SPRINT-51.47'
  });
  const autorizacaoSemContexto = montarAutorizacaoFinalizarSemContextoCrt({
    hostPermit: permitDoc.hostPermit,
    exceptionalPermit: permitDoc.exceptionalPermit,
    exclusividade
  });
  evidencias.permit = {
    hostPermitPlanejado: permitDoc.hostPermit,
    exceptionalPermit: {
      purpose: permitDoc.exceptionalPermit.purpose,
      operation: permitDoc.exceptionalPermit.operation,
      confirmacao: permitDoc.exceptionalPermit.confirmacao,
      transactionId: permitDoc.exceptionalPermit.transactionId,
      oneShot: permitDoc.exceptionalPermit.oneShot,
      dryRun: permitDoc.exceptionalPermit.dryRun,
      exceptional: permitDoc.exceptionalPermit.exceptional
    },
    ledgerEscrito: false,
    notas: 'Host permit one-shot emitido no SECURITY_BOOTSTRAP imediatamente antes do TX_FINALIZE; exceptionalPermit em memória para gate OFF.'
  };
  logFase('PERMIT', 'PREPARADO', evidencias.permit.exceptionalPermit);

  const enableResp = await clientRef.enviar(OPERACOES_HOST.ENABLE_REAL, {
    exceptionalPermit: permitDoc.exceptionalPermit
  });
  evidencias.enableReal = {
    error: enableResp.error || null,
    output: enableResp.output || null
  };
  if (enableResp.error || enableResp.output?.sucesso !== true) {
    evidencias.abortado = true;
    evidencias.codigoAbort = 'TEF_5147_ENABLE_REAL_FALHOU';
    evidencias.mensagem = enableResp.error?.message
      || enableResp.output?.mensagem
      || 'ENABLE_REAL recusado';
    evidencias.classificacao = 'ABORTADO_PERMIT';
    await handle.encerrar();
    gravarResultado();
    app.exit(2);
    return;
  }
  logFase('PERMIT', 'ENABLE_REAL_OK', { exceptional: true });

  // Única chamada FINALIZE(0)
  evidencias.chamadasFinalize = 1;
  const finalizeResp = await clientRef.enviar(
    OPERACOES_HOST.TX_FINALIZE,
    {
      confirmacao: FINALIZACAO_CONFIRMAR,
      autorizacaoRecuperacao: autorizacaoSemContexto
    },
    { transactionId: '3' }
  );
  evidencias.finalize = {
    error: finalizeResp.error || null,
    output: finalizeResp.output || null,
    resultCode: finalizeResp.resultCode || null,
    requestId: finalizeResp.requestId || null,
    confirmacao: 0,
    transactionId: '3',
    chamadaUnica: true
  };
  logFase('FINALIZE', 'RESPOSTA', {
    error: finalizeResp.error?.code || null,
    codigoDestaxa: finalizeResp.output?.codigoDestaxa
      || finalizeResp.output?.codigo
      || null,
    sucesso: finalizeResp.output?.sucesso === true
  });

  const codigoFinalize = String(
    finalizeResp.output?.codigoDestaxa
    || finalizeResp.output?.codigo
    || finalizeResp.resultCode
    || ''
  ).toUpperCase();
  const finalizeOk = !finalizeResp.error
    && finalizeResp.output?.sucesso === true
    && (codigoFinalize === '00' || codigoFinalize === 'SUCCESS' || finalizeResp.output?.codigoDestaxa === '00');

  // Pós: um único INIT_CLIENT (sem retry de FINALIZE)
  let initPos = null;
  try {
    const initPosResp = await clientRef.enviar(OPERACOES_HOST.INIT_CLIENT, {
      config: { sdkPath: DLL_PATH }
    });
    initPos = {
      error: initPosResp.error || null,
      output: initPosResp.output || null,
      codigoDestaxa: initPosResp.output?.codigoDestaxa || null,
      clientInitialized: initPosResp.output?.diagnostico?.clientInitialized
        ?? initPosResp.output?.diagnostico?.clientInitialized
    };
  } catch (error) {
    initPos = { error: { message: error.message, code: error.code || null } };
  }
  evidencias.initClientPos = initPos;
  logFase('POS', 'INIT_CLIENT_POS', {
    codigo: initPos?.codigoDestaxa || initPos?.error?.code || null
  });

  const posCds = await snapshotCds();
  evidencias.posLeituraCds = {
    tx3: posCds.tx3,
    venda66: posCds.venda66,
    pendentes: posCds.pendentes,
    maxTefId: posCds.maxTefId,
    tx2: posCds.tx2
  };
  evidencias.novaCobranca = Number(posCds.maxTefId) !== Number(pre.maxTefId);
  evidencias.preservacao = {
    nsuIgual: String(posCds.tx3?.nsu) === String(pre.tx3?.nsu),
    authIgual: String(posCds.tx3?.autorizacao) === String(pre.tx3?.autorizacao),
    statusAprovado: String(posCds.tx3?.status) === 'aprovado',
    vendaVinculo: Number(posCds.venda66?.tef_transacao_id) === 3,
    comprovanteClienteLenIgual: posCds.tx3?.comprovante_cliente_len === pre.tx3?.comprovante_cliente_len,
    comprovanteLojaLenIgual: posCds.tx3?.comprovante_loja_len === pre.tx3?.comprovante_loja_len,
    tx2Inalterado: JSON.stringify(posCds.tx2) === JSON.stringify(pre.tx2)
  };

  const codigoPos = String(initPos?.codigoDestaxa || '').toUpperCase();
  if (finalizeOk && codigoPos === '00' && !evidencias.novaCobranca && evidencias.preservacao.nsuIgual) {
    evidencias.classificacao = 'SUCESSO_RECUPERACAO';
    evidencias.mensagem = 'FINALIZE(0)=00 e INIT pós=00; TX3/venda66 preservadas; sem nova cobrança.';
  } else if (finalizeOk && codigoPos === 'A1') {
    evidencias.classificacao = 'INCONCLUSIVO_A1_PERSISTENTE';
    evidencias.mensagem = 'FINALIZE retornou sucesso aparente mas A1 persistiu no INIT pós — sem retry.';
  } else if (finalizeOk) {
    evidencias.classificacao = 'INCONCLUSIVO_POS';
    evidencias.mensagem = `FINALIZE aparentemente OK; INIT pós=${codigoPos || 'null'} — sem retry.`;
  } else if (finalizeResp.error?.code === 'HOST_TIMEOUT' || /timeout/i.test(String(finalizeResp.error?.message || ''))) {
    evidencias.classificacao = 'INCONCLUSIVO_TIMEOUT';
    evidencias.mensagem = 'Timeout no FINALIZE — sem retry / sem FINALIZE(9).';
  } else {
    evidencias.classificacao = 'FALHA_FINALIZE';
    evidencias.mensagem = finalizeResp.error?.message
      || finalizeResp.output?.mensagem
      || `FINALIZE código=${codigoFinalize || 'null'}`;
  }

  // Observability correlacionada
  try {
    const logPath = destaxaLogger.obterArquivoAuditoria?.() || null;
    evidencias.observabilityPath = logPath;
    if (logPath && fs.existsSync(logPath)) {
      const linhas = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-120);
      evidencias.correlacaoLogs = linhas
        .map((l) => {
          try { return JSON.parse(l); } catch (_) { return null; }
        })
        .filter(Boolean)
        .filter((e) => {
          const fn = e.functionName || '';
          const op = e.operation || '';
          return /finalizaTransacaoDestaxa|iniciaClientDestaxa|TX_FINALIZE|INIT_CLIENT|ENABLE_REAL/i.test(`${fn} ${op} ${e.evento || ''}`);
        })
        .slice(-40)
        .map((e) => ({
          evento: e.evento || null,
          functionName: e.functionName || null,
          operation: e.operation || null,
          resultCode: e.resultCode || e.codigo || e.codigoDestaxa || null,
          requestId: e.requestId || null,
          registradoEm: e.registradoEm || null
        }));
    }
  } catch (errLog) {
    evidencias.correlacaoLogsErro = errLog.message;
  }

  logFase('FIM', evidencias.classificacao, {
    chamadasFinalize: evidencias.chamadasFinalize,
    novaCobranca: evidencias.novaCobranca
  });

  try {
    await handle.encerrar();
  } catch (errEnc) {
    evidencias.encerramentoErro = errEnc.message;
  }

  gravarResultado();
  const exitCode = evidencias.classificacao === 'SUCESSO_RECUPERACAO' ? 0 : 1;
  app.exit(exitCode);
}

main().catch((error) => {
  evidencias.abortado = true;
  evidencias.codigoAbort = error.code || 'TEF_5147_FALHOU';
  evidencias.mensagem = error.message;
  evidencias.classificacao = 'ABORTADO_ERRO';
  evidencias.detalhesErro = error.detalhes || null;
  try { logFase('ERRO', evidencias.codigoAbort, { mensagem: error.message }); } catch (_) { /* */ }
  try { gravarResultado(); } catch (_) { /* */ }
  process.exitCode = 1;
  try { app.quit(); } catch (_) { process.exit(1); }
});
