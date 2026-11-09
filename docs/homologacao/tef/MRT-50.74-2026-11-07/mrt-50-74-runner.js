'use strict';

/**
 * MRT-50.74 — UMA CRT real débito R$1,00 (autorização pontual do usuário).
 * Gate OFF no start; ON só na janela financeira; OFF imediatamente após.
 * Sem retry. Timeout/UNKNOWN → INCONCLUSIVA e parar.
 */

const fs = require('fs');
const path = require('path');
function bootLog(msg) {
  try {
    fs.appendFileSync(
      path.join(__dirname, 'runner-boot.txt'),
      `${msg} ${new Date().toISOString()}\n`
    );
  } catch (_) { /* best-effort */ }
}
fs.writeFileSync(
  path.join(__dirname, 'runner-boot.txt'),
  `boot ${new Date().toISOString()} electron=${process.versions.electron || 'none'} pid=${process.pid}\n`
);
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
bootLog('electron-require-ok');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
bootLog(`root=${ROOT}`);
const destaxaDllResolver = require(path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaDllResolver'));
bootLog('loaded-dllResolver');
const {
  APP_NAME,
  PROFILE_NAMES,
  validarPerfilTefOriginalSomenteLeitura,
  validarSnapshotPerfilTefIsolado
} = require(path.join(ROOT, 'backend', 'services', 'tef', 'tefCryptoProfileProvisioner'));
bootLog('loaded-cryptoProfile');
const { lerChaveTefPersistida } = require(path.join(ROOT, 'backend', 'services', 'tef', 'tefSigningKeyProvisioner'));
bootLog('loaded-signingKey');
const destaxaLogger = require(path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaLogger'));
bootLog('loaded-logger');
const { DestaxaNativeHostClient } = require(path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'DestaxaNativeHostClient'));
bootLog('loaded-nativeHostClient');
const DestaxaHostBridge = require(path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'DestaxaHostBridge'));
bootLog('loaded-hostBridge');
const { buildCrtInput } = require(path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaProtocolo'));
bootLog('loaded-protocolo');
const {
  REAL_TRANSACTION_ENV,
  VALOR_HOMOLOGACAO_CENTAVOS,
  OPERACOES,
  FINALIZACAO_CONFIRMAR,
  TIPOS_ACAO,
  transacaoRealHabilitada
} = require(path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaConstantes'));
bootLog('loaded-constantes');
const {
  PROTOCOLO,
  ESTADOS_BOOTSTRAP,
  OPERACOES_TRANSACIONAIS
} = require(path.join(ROOT, 'backend', 'services', 'tef', 'destaxa', 'destaxaNativeHostProtocolo'));
bootLog('loaded-hostProtocolo');
const evidenceModule = require(path.join(ROOT, 'backend', 'services', 'tef', 'tefReconciliationEvidence'));
bootLog('loaded-evidence');

/**
 * Bootstrap de segurança homologatório.
 * Sem operation → permit null (sessão).
 * Com TX_* + transactionId → permit pontual (contrato Host / TefManager).
 */
function criarClaimsBootstrap({ hostSessionId, revision, blockedIdentities, operation = null, transactionId = null }) {
  if (typeof hostSessionId !== 'string' || !hostSessionId.trim()
      || !Number.isSafeInteger(revision) || revision < 1) {
    throw criarErro('TEF_MRT74_BOOTSTRAP_CTX');
  }
  const identidades = Array.isArray(blockedIdentities) ? blockedIdentities.slice() : [];
  const bootstrapId = crypto.randomBytes(16).toString('hex');
  const tid = transactionId == null ? null : String(transactionId);
  const op = operation || null;
  const permit = (op && tid && OPERACOES_TRANSACIONAIS.has(op))
    ? { permitId: bootstrapId, operation: op, transactionId: tid }
    : null;
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

const MODULE = 'erp';
const EXPECTED_ELECTRON_VERSION = '22.3.27';
const EXPECTED_KEY_DIR = 'C:\\ProgramData\\MercantilFiscal\\dados';
const EXPECTED_DLL_SHA256 = '65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279';
const CRT_ENTRADA_ESPERADA = 'transacao_valor=1.00;transacao_tipo_cartao=Debito;transacao_pagamento=A vista';
const EXPECTED_PROTOCOLO_SHA256 = 'FA0EF0D0430EBE190724D98BCD4D40930017E5D8B6C3AE368F8FC9C607AD551F';
const EXPECTED_CONSTANTES_SHA256 = '0E0A992B13349A62847266D048A1938399EB53E49FF611E44034CB241C751EF2';

const profileRootArgument = process.argv.find((a) => a.startsWith('--mrt53-root='));
const keyDirArgument = process.argv.find((a) => a.startsWith('--mrt53-key-dir='));
const isolatedRoot = profileRootArgument
  ? path.resolve(profileRootArgument.slice('--mrt53-root='.length))
  : '';
const originalKeyDir = keyDirArgument
  ? path.resolve(keyDirArgument.slice('--mrt53-key-dir='.length))
  : '';
const resultFile = process.env.MRT5074_RESULT_FILE;
const stdoutLog = process.env.MRT5074_STDOUT_FILE;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

let exitCode = 0;
let keepAliveForInFlight = false;
let evidencias = {
  confirmacaoUsuario: true,
  gateJanela: { ligadoEm: null, desligadoEm: null, motivoOff: null },
  nativeHostPid: null,
  clientInit: null,
  enableReal: null,
  crt: {
    transactionId: null,
    entrada: null,
    passos: [],
    resultadoFinal: null
  },
  pinpad: {
    displayVistos: [],
    coletas: [],
    opcoes: [],
    evidenciaInteracao: false
  },
  classificacao: 'INCONCLUSIVA',
  shutdown: null
};

function agora() {
  return new Date().toISOString();
}

function criarErro(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function escreverStdout(registro) {
  const linha = `${JSON.stringify(registro)}\n`;
  if (stdoutLog) fs.appendFileSync(stdoutLog, linha);
  return new Promise((resolve, reject) => {
    process.stdout.write(linha, (error) => (error ? reject(error) : resolve()));
  });
}

function gravarResultado(extra = {}) {
  if (!resultFile) return;
  fs.writeFileSync(resultFile, `${JSON.stringify({
    mrt: 'MRT-50.74',
    classificacao: evidencias.classificacao,
    keepAlive: keepAliveForInFlight === true,
    evidencias,
    gateApos: {
      process: process.env[REAL_TRANSACTION_ENV] || null,
      habilitado: transacaoRealHabilitada()
    },
    ...extra,
    geradoEm: agora()
  }, null, 2)}\n`);
}

function gateOff(motivo) {
  process.env[REAL_TRANSACTION_ENV] = '0';
  evidencias.gateJanela.desligadoEm = agora();
  evidencias.gateJanela.motivoOff = motivo;
  destaxaLogger.registrarPersistente('mrt5074.gate.off', {
    motivo,
    habilitado: transacaoRealHabilitada()
  });
}

function inspecionarDll() {
  const arch = process.arch;
  if (arch !== 'x64') throw criarErro('TEF_MRT74_ARCH');
  const resolucao = destaxaDllResolver.resolverDll({}, { arch });
  if (!resolucao.sucesso || !resolucao.dllPath) {
    throw criarErro(resolucao.codigo || 'TEF_MRT74_DLL');
  }
  const sha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(resolucao.dllPath))
    .digest('hex')
    .toUpperCase();
  if (sha256 !== EXPECTED_DLL_SHA256) throw criarErro('TEF_MRT74_DLL_HASH');
  return { path: path.resolve(resolucao.dllPath), sha256, arch };
}

function comChaveTemporaria(segredo, fn) {
  const anterior = process.env.TEF_ENCRYPTION_KEY;
  process.env.TEF_ENCRYPTION_KEY = segredo;
  try {
    return fn();
  } finally {
    if (anterior === undefined) delete process.env.TEF_ENCRYPTION_KEY;
    else process.env.TEF_ENCRYPTION_KEY = anterior;
  }
}

function registrarPasso(tipo, payload) {
  const acao = payload?.acao || null;
  const entrada = {
    tipo,
    em: agora(),
    codigo: payload?.codigoDestaxa || payload?.codigo || payload?.code || null,
    estado: payload?.estado || null,
    requerContinuacao: payload?.requerContinuacao === true,
    acaoTipo: acao?.tipo || null,
    acaoMensagem: acao?.mensagem || null,
    financialState: payload?.financialState || null,
    sucesso: payload?.sucesso === true,
    mensagem: payload?.mensagem || payload?.descricao || null,
    naoExecutada: payload?.naoExecutada === true
  };
  evidencias.crt.passos.push(entrada);

  if (acao?.tipo === TIPOS_ACAO.DISPLAY || acao?.tipo === 'DISPLAY') {
    evidencias.pinpad.displayVistos.push({ em: entrada.em, mensagem: acao.mensagem || null });
    evidencias.pinpad.evidenciaInteracao = true;
  }
  if (acao?.tipo === TIPOS_ACAO.COLETA || acao?.tipo === 'COLETA') {
    evidencias.pinpad.coletas.push({
      em: entrada.em,
      mensagem: acao.mensagem || null,
      tipoDado: acao.tipoDado || acao.parametros?.tipo || null
    });
    evidencias.pinpad.evidenciaInteracao = true;
  }
  if (acao?.tipo === TIPOS_ACAO.OPCAO || acao?.tipo === 'OPCAO') {
    evidencias.pinpad.opcoes.push({
      em: entrada.em,
      mensagem: acao.mensagem || null,
      opcoes: acao.opcoes || null
    });
    evidencias.pinpad.evidenciaInteracao = true;
  }
  return entrada;
}

async function executarCicloDebito(bridge, transactionId, camposEntrada) {
  await escreverStdout({
    event: 'pinpad-operator-prompt',
    message: 'Use o cartão pessoal no Gertec PPC-930 (COM4) quando a PinPad solicitar. Uma tentativa. Sem retry.'
  });

  let atual = await bridge.iniciarTransacaoDestaxa(OPERACOES.CRT, camposEntrada, { transactionId });
  registrarPasso('TX_START', atual);
  await escreverStdout({
    event: 'tx-start',
    codigo: atual?.codigoDestaxa || atual?.codigo || null,
    requerContinuacao: atual?.requerContinuacao === true,
    acaoTipo: atual?.acao?.tipo || null,
    acaoMensagem: atual?.acao?.mensagem || null,
    naoExecutada: atual?.naoExecutada === true
  });

  if (atual?.naoExecutada === true) {
    return {
      sucesso: false,
      bloqueadaPre: true,
      atual,
      codigoDestaxa: atual.codigoDestaxa || atual.codigo || null,
      mensagem: atual.mensagem || 'TX não executada'
    };
  }

  let continues = 0;
  while (atual && atual.requerContinuacao === true && continues < 32) {
    continues += 1;
    const acao = atual.acao || {};
    const tipo = acao.tipo || null;
    let resposta;

    if (!tipo || tipo === TIPOS_ACAO.DISPLAY || tipo === 'DISPLAY') {
      resposta = { displayAck: true };
    } else if (tipo === TIPOS_ACAO.OPCAO || tipo === 'OPCAO') {
      const ops = Array.isArray(acao.opcoes) ? acao.opcoes.map(String) : [];
      const deb = ops.find((o) => /d[eé]bito/i.test(o));
      if (!deb) {
        return {
          sucesso: false,
          inconclusivo: true,
          codigoDestaxa: 'DESTAXA_OPCAO_SEM_DEBITO',
          mensagem: 'OPCAO sem alternativa Debito — interrompido sem retry',
          atual
        };
      }
      resposta = { informacao: deb };
    } else if (tipo === TIPOS_ACAO.COLETA || tipo === 'COLETA') {
      // PinPad (senha etc.): AC envia informacao vazia; sem inventar valor.
      resposta = { informacao: '' };
    } else {
      return {
        sucesso: false,
        inconclusivo: true,
        codigoDestaxa: 'DESTAXA_ACAO_99_DESCONHECIDA',
        mensagem: `Ação 99 não tratável sem retry: ${tipo}`,
        atual
      };
    }

    await escreverStdout({
      event: 'tx-continue-send',
      n: continues,
      tipoAcao: tipo,
      mensagemAcao: acao.mensagem || null,
      respostaChaves: Object.keys(resposta)
    });

    atual = await bridge.continuarTransacaoDestaxa(resposta, { transactionId });
    registrarPasso('TX_CONTINUE', atual);
    await escreverStdout({
      event: 'tx-continue-result',
      n: continues,
      codigo: atual?.codigoDestaxa || atual?.codigo || null,
      requerContinuacao: atual?.requerContinuacao === true,
      acaoTipo: atual?.acao?.tipo || null,
      acaoMensagem: atual?.acao?.mensagem || null
    });
  }

  const codigo = String(atual?.codigoDestaxa || atual?.codigo || '').toUpperCase();

  if (codigo === '08' || /TIMEOUT|UNKNOWN|HOST_TIMEOUT/i.test(codigo)) {
    return {
      sucesso: false,
      inconclusivo: true,
      atual,
      codigoDestaxa: codigo || 'TIMEOUT',
      financialState: atual?.financialState || 'UNKNOWN',
      mensagem: atual?.mensagem || 'Timeout/UNKNOWN — sem retry'
    };
  }

  if (atual?.sucesso === true || codigo === '00') {
    const fin = await bridge.finalizarTransacaoDestaxa(FINALIZACAO_CONFIRMAR, { transactionId });
    registrarPasso('TX_FINALIZE', fin);
    await escreverStdout({
      event: 'tx-finalize',
      codigo: fin?.codigoDestaxa || fin?.codigo || null,
      sucesso: fin?.sucesso === true
    });
    return {
      sucesso: fin?.sucesso === true || String(fin?.codigoDestaxa || fin?.codigo || '') === '00',
      atual,
      fin,
      codigoDestaxa: '00'
    };
  }

  if (['03', '04', '09', '05'].includes(codigo)) {
    return {
      sucesso: false,
      recusada: true,
      atual,
      codigoDestaxa: codigo,
      financialState: atual?.financialState || null,
      mensagem: atual?.mensagem || atual?.descricao || null
    };
  }

  return {
    sucesso: false,
    inconclusivo: true,
    atual,
    codigoDestaxa: codigo || null,
    financialState: atual?.financialState || 'UNKNOWN'
  };
}

async function iniciarHostFinanceiro(dllPath) {
  const segredo = lerChaveTefPersistida({
    safeStorage,
    dbDir: originalKeyDir
  });
  if (typeof segredo !== 'string' || !/^[a-f0-9]{64}$/i.test(segredo)) {
    throw criarErro('TEF_MRT74_CHAVE');
  }
  const chavePublica = comChaveTemporaria(segredo, () => evidenceModule.obterChavePublica());
  const securityBootstrapProvider = async ({ hostSessionId, revision, operation = null, transactionId = null }) => {
    const claims = criarClaimsBootstrap({
      hostSessionId,
      revision,
      blockedIdentities: [],
      operation,
      transactionId
    });
    // Sessão inicial: permit deve ser null. Operações TX_*: permit obrigatório e pontual.
    if (!operation && claims.permit !== null) {
      throw criarErro('TEF_MRT74_PERMIT_INDEVIDO');
    }
    if (operation && OPERACOES_TRANSACIONAIS.has(operation) && !claims.permit) {
      throw criarErro('TEF_MRT74_PERMIT_AUSENTE', `Permit obrigatório para ${operation}`);
    }
    return comChaveTemporaria(segredo, () => evidenceModule.assinarBootstrapSeguranca(claims));
  };

  const envHost = {
    ...process.env,
    [REAL_TRANSACTION_ENV]: '1',
    DESTAXA_NATIVE_HOST_TEST_MODE: '0',
    DESTAXA_NATIVE_HOST_TRIPWIRE: '0'
  };
  delete envHost.TEF_ENCRYPTION_KEY;

  const client = new DestaxaNativeHostClient({
    reconciliationPublicKey: chavePublica,
    securityBootstrapProvider,
    env: envHost,
    timeoutInicioMs: 30000
  });

  const ok = await client.iniciar();
  if (!ok) {
    const estado = client.getEstado?.() || {};
    throw criarErro(
      'TEF_MRT74_HOST_START',
      `NativeHost não ficou READY: ${estado.ultimaSaida?.motivo || estado.securityBootstrapState || estado.estado || 'sem detalhe'}`
    );
  }

  const bridge = new DestaxaHostBridge({
    client,
    config: { sdkPath: dllPath, provedor: 'destaxa', ambiente: 'homologacao' }
  });

  const load = await bridge.load();
  if (!load || load.sucesso !== true) {
    throw criarErro(load?.codigo || 'TEF_MRT74_LOAD', load?.mensagem || 'LOAD falhou');
  }

  const init = await bridge.iniciarClient({
    sdkPath: dllPath,
    provedor: 'destaxa',
    ambiente: 'homologacao'
  });
  evidencias.clientInit = {
    sucesso: init?.sucesso === true,
    codigo: init?.codigoDestaxa || init?.codigo || null,
    estado: init?.estado || null,
    mensagem: init?.mensagem || null
  };
  const diag = await bridge.getDiagnostics();
  const initOk = (init?.sucesso === true)
    || String(init?.codigoDestaxa || init?.codigo || '') === '00'
    || (diag.clientInitialized === true && String(diag.clientResultCode || '') === '00');
  if (!initOk) {
    throw criarErro(init?.codigo || 'TEF_MRT74_INIT', init?.mensagem || 'INIT_CLIENT falhou');
  }

  const enable = await bridge.habilitarTransacaoReal();
  evidencias.enableReal = {
    sucesso: enable?.sucesso === true,
    codigo: enable?.codigo || null,
    mensagem: enable?.mensagem || null
  };
  if (!enable || enable.sucesso !== true) {
    throw criarErro(enable?.codigo || 'TEF_MRT74_ENABLE', enable?.mensagem || 'ENABLE_REAL falhou');
  }

  return { client, bridge };
}

async function executar() {
  bootLog('executar-start');
  if (process.versions.electron !== EXPECTED_ELECTRON_VERSION) {
    throw criarErro('TEF_MRT74_ELECTRON');
  }
  if (!isolatedRoot || !originalKeyDir) throw criarErro('TEF_MRT74_PATHS');
  if (path.resolve(originalKeyDir).toLowerCase() !== path.resolve(EXPECTED_KEY_DIR).toLowerCase()) {
    throw criarErro('TEF_MRT74_KEY_DIR');
  }
  if (fs.existsSync(isolatedRoot)) throw criarErro('TEF_MRT74_ROOT_EXISTS');

  // Gate OFF no bootstrap do processo
  process.env[REAL_TRANSACTION_ENV] = '0';
  delete process.env.TEF_ENCRYPTION_KEY;
  app.setName(APP_NAME);

  const originalAppDataPath = app.getPath('appData');
  const originalUserDataPath = path.join(originalAppDataPath, PROFILE_NAMES[MODULE]);
  const profileOriginal = validarPerfilTefOriginalSomenteLeitura({
    appName: app.getName(),
    modulo: MODULE,
    appDataPath: originalAppDataPath,
    userDataPath: originalUserDataPath
  });

  const dll = inspecionarDll();
  const shaArquivo = (rel) => crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, ...rel.split('/'))))
    .digest('hex')
    .toUpperCase();
  const hashProtocolo = shaArquivo('backend/services/tef/destaxa/destaxaProtocolo.js');
  const hashConstantes = shaArquivo('backend/services/tef/destaxa/destaxaConstantes.js');
  if (hashProtocolo !== EXPECTED_PROTOCOLO_SHA256 || hashConstantes !== EXPECTED_CONSTANTES_SHA256) {
    throw criarErro(
      'TEF_MRT74_HASH_5073',
      `Hashes MRT-50.73 divergentes protocolo=${hashProtocolo} constantes=${hashConstantes}`
    );
  }
  evidencias.hashes5073 = { protocolo: hashProtocolo, constantes: hashConstantes };
  fs.mkdirSync(isolatedRoot, { recursive: false });
  const snapshotUserDataPath = path.join(isolatedRoot, 'profile', PROFILE_NAMES[MODULE]);
  fs.mkdirSync(snapshotUserDataPath, { recursive: true });
  fs.copyFileSync(
    path.join(profileOriginal.userDataPath, 'Local State'),
    path.join(snapshotUserDataPath, 'Local State'),
    fs.constants.COPYFILE_EXCL
  );
  app.setPath('userData', snapshotUserDataPath);
  await app.whenReady();
  if (!safeStorage.isEncryptionAvailable()) throw criarErro('TEF_MRT74_SAFE_STORAGE');
  validarSnapshotPerfilTefIsolado({
    app,
    modulo: MODULE,
    perfilOriginal: profileOriginal,
    snapshotUserDataPath
  });

  // Janela financeira — gate ON (confirmação explícita já recebida)
  process.env[REAL_TRANSACTION_ENV] = '1';
  evidencias.gateJanela.ligadoEm = agora();
  destaxaLogger.registrarPersistente('mrt5074.gate.on', {
    confirmacaoUsuario: true,
    valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
    tipo: 'cartao_debito'
  });
  await escreverStdout({ event: 'gate-on', em: evidencias.gateJanela.ligadoEm });

  const txId = `mrt74_${crypto.randomBytes(8).toString('hex')}`;
  evidencias.crt.transactionId = txId;
  const entrada = buildCrtInput({
    valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
    tipoPdv: 'cartao_debito',
    parcelas: 1
  });
  evidencias.crt.entrada = entrada.texto;
  if (entrada.texto !== CRT_ENTRADA_ESPERADA) {
    gateOff('crt-entrada-invalida');
    throw criarErro('TEF_MRT74_CRT_ENTRADA', `Entrada CRT divergente: ${entrada.texto}`);
  }

  let sessao = null;
  try {
    sessao = await iniciarHostFinanceiro(dll.path);
    evidencias.nativeHostPid = sessao.client.getEstado()?.pid || null;
    await escreverStdout({
      event: 'financial-host-ready',
      pid: evidencias.nativeHostPid,
      transactionId: txId,
      entrada: entrada.texto
    });

    const ciclo = await executarCicloDebito(sessao.bridge, txId, entrada.campos);
    evidencias.crt.resultadoFinal = {
      sucesso: ciclo.sucesso === true,
      recusada: ciclo.recusada === true,
      inconclusivo: ciclo.inconclusivo === true,
      bloqueadaPre: ciclo.bloqueadaPre === true,
      codigoDestaxa: ciclo.codigoDestaxa || ciclo.atual?.codigoDestaxa || null,
      financialState: ciclo.financialState || ciclo.atual?.financialState || null,
      mensagem: ciclo.mensagem || ciclo.atual?.mensagem || null
    };

    if (ciclo.bloqueadaPre) evidencias.classificacao = 'BLOQUEADA';
    else if (ciclo.sucesso) evidencias.classificacao = 'APROVADA';
    else if (ciclo.recusada) evidencias.classificacao = 'REJEITADA';
    else evidencias.classificacao = 'INCONCLUSIVA';
  } catch (error) {
    const emVoo = sessao?.client?.getEstado?.()?.emVoo || null;
    if (emVoo) {
      keepAliveForInFlight = true;
      evidencias.classificacao = 'INCONCLUSIVA';
      evidencias.crt.resultadoFinal = {
        sucesso: false,
        inconclusivo: true,
        financialState: 'UNKNOWN',
        codigo: error.code || 'TEF_MRT74_IN_FLIGHT',
        mensagem: error.message,
        emVoo
      };
      gateOff('exception-em-voo');
      gravarResultado({ keepAlive: true });
      await escreverStdout({
        event: 'in-flight-keepalive',
        code: error.code || null,
        message: error.message,
        emVoo
      });
      return;
    }
    evidencias.classificacao = /PRE|LOAD|INIT|ENABLE|HASH|ARCH|PATH|CHAVE|HOST_START|CRT_ENTRADA|HASH_5073/i.test(error.code || '')
      ? 'BLOQUEADA'
      : 'INCONCLUSIVA';
    evidencias.crt.resultadoFinal = {
      sucesso: false,
      inconclusivo: evidencias.classificacao === 'INCONCLUSIVA',
      codigo: error.code || 'TEF_MRT74_ERRO',
      mensagem: error.message
    };
    await escreverStdout({
      event: 'financial-error',
      code: error.code || null,
      message: error.message
    });
  } finally {
    if (!keepAliveForInFlight) {
      gateOff('pos-ciclo-crt');
      try {
        if (sessao?.client) {
          const shut = await sessao.client.encerrar({ aguardarMs: 8000 });
          evidencias.shutdown = {
            encerrado: shut?.encerrado === true || shut?.estado === 'STOPPED',
            estado: shut?.estado || null,
            forcado: shut?.forcado === true,
            adiado: shut?.adiado === true
          };
        }
      } catch (error) {
        evidencias.shutdown = { erro: error.message };
      }
      gravarResultado();
      await escreverStdout({
        event: 'mrt5074-end',
        classificacao: evidencias.classificacao,
        gateOff: transacaoRealHabilitada() === false,
        pinpadEvidencia: evidencias.pinpad.evidenciaInteracao,
        shutdown: evidencias.shutdown
      });
    }
  }

  if (evidencias.classificacao !== 'APROVADA') exitCode = 1;
}

executar()
  .catch(async (error) => {
    exitCode = 1;
    try { gateOff('exception'); } catch (_) { /* */ }
    evidencias.classificacao = 'BLOQUEADA';
    evidencias.crt.resultadoFinal = { codigo: error.code || 'TEF_MRT74_FAIL', mensagem: error.message };
    gravarResultado({ success: false });
    await escreverStdout({ event: 'fatal', code: error.code || null, message: error.message });
  })
  .finally(() => {
    if (keepAliveForInFlight) {
      // Não matar o pai enquanto a DLL pode estar ativa.
      return;
    }
    try { gateOff('finally'); } catch (_) { /* */ }
    app.exit(exitCode);
  });
