'use strict';

/**
 * MRT-23.1 — Validação de persistência da sessão Destaxa
 *
 * INIT homologação autorizado (mesmo padrão MRT-16).
 * PROIBIDO: CRT, EST, ENABLE_REAL, cobrança, cancelamento, estorno.
 * Continuidade: comprovada por contrato/IPC/PID — sem TX real.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-23-1-persistencia-sessao-destaxa-report.json');

const sdkDetector = require('../../backend/services/tef/sdkDetector');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const DestaxaHostBridge = require('../../backend/services/tef/destaxa/DestaxaHostBridge');
const {
  obterClienteCompartilhado,
  clienteCompartilhadoExistente,
  DestaxaNativeHostClient
} = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
const { OPERACOES_HOST } = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const { projetarEntradaIniciaClient } = require('../../backend/services/tef/destaxa/destaxaMapeamentoTerminal');
const {
  APLICACAO,
  REAL_TRANSACTION_ENV,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { TefManager } = require('../../backend/services/tef/TefManager');

function serializarErro(error) {
  if (!error) return null;
  return {
    message: error.message || String(error),
    codigo: error.codigo || error.code || null,
    detalhes: error.detalhes || null
  };
}

function bloquearTxEEnableReal(client) {
  const enviarOriginal = client.enviar.bind(client);
  const contadores = { init: 0, tx: 0, enableReal: 0, continueIpc: [] };
  client.enviar = async function enviarGuard(operacao, payload, opcoes = {}) {
    const op = String(operacao || '');
    if (op === OPERACOES_HOST.ENABLE_REAL) {
      contadores.enableReal += 1;
      const err = new Error('MRT-23.1: ENABLE_REAL bloqueado');
      err.codigo = 'MRT231_ENABLE_REAL_BLOQUEADO';
      throw err;
    }
    if (op === OPERACOES_HOST.TX_START
      || op === OPERACOES_HOST.TX_CONTINUE
      || op === OPERACOES_HOST.TX_FINALIZE) {
      contadores.tx += 1;
      const err = new Error(`MRT-23.1: operação TX bloqueada (${op}) — sem cobrança`);
      err.codigo = 'MRT231_TX_BLOQUEADO';
      throw err;
    }
    if (op === OPERACOES_HOST.INIT_CLIENT) {
      contadores.init += 1;
      if (contadores.init > 1) {
        const err = new Error('MRT-23.1: segundo INIT_CLIENT bloqueado');
        err.codigo = 'MRT231_INIT_REPETIDO';
        throw err;
      }
    }
    return enviarOriginal(operacao, payload, opcoes);
  };
  return contadores;
}

async function carregarConfigSomenteLeitura() {
  try {
    const tefConfigService = require('../../backend/services/tef/tefConfigService');
    const config = await tefConfigService.obterConfiguracao();
    return {
      ok: true,
      provedor: config.tefProvedor || null,
      ambiente: config.tefAmbiente || null,
      empresaCodigo: config.empresaCodigo || null,
      lojaCodigo: config.lojaCodigo || null,
      terminalCodigo: config.terminalCodigo || null,
      pdvCodigo: config.pdvCodigo || null,
      caixaCodigo: config.caixaCodigo || null,
      defaults: config._defaultsAplicados === true
    };
  } catch (error) {
    return { ok: false, erro: serializarErro(error) };
  }
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-23.1 — Persistência sessão Destaxa (INIT + mesma sessão; sem CRT) ===\n');

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const pkg = require('../../package.json');
  const versao = String(pkg.version || '').trim();

  const report = {
    sprint: 'MRT-23.1',
    title: 'Validação de persistência da sessão Destaxa',
    generatedAt: geradoEm,
    classificacao: null,
    restricoesObservadas: {
      initHomologacao: true,
      crt: false,
      est: false,
      enableReal: false,
      cobranca: false,
      cancelamento: false,
      estorno: false,
      gateOff: true,
      configDestaxaAlterada: false,
      bancoProducao: false
    },
    auditoriaCodigoMrt23: {},
    evidencias: {},
    testes: [],
    problemas: [],
    resultadoFinal: null
  };

  const ok = (nome, cond, extra = {}) => {
    report.testes.push({ nome, ok: !!cond, ...extra });
    console.log(`  ${cond ? 'OK' : 'FAIL'} — ${nome}`);
    assert.ok(cond, nome);
  };

  // ——— 1. Auditoria código corrigido ———
  console.log('1. Auditoria código MRT-23');
  const hostBridgeSrc = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/destaxa/DestaxaHostBridge.js'),
    'utf8'
  );
  const tefMgrSrc = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/TefManager.js'),
    'utf8'
  );
  report.auditoriaCodigoMrt23 = {
    hostBridgePropagaTransactionId: /opcoes\.transactionId != null/.test(hostBridgeSrc)
      && /continuarTransacaoDestaxa/.test(hostBridgeSrc),
    tefManagerAncoraSessaoHost: /sessaoHost:\s*this\._capturarSessaoNativeHost/.test(tefMgrSrc),
    continuarUsaHostCompartilhado: /obterClienteCompartilhado/.test(tefMgrSrc)
      && /executionMode:\s*'native-host'/.test(tefMgrSrc),
    pidDivergenteInconclusivo: /TEF_NATIVE_HOST_SESSAO_REINICIADA/.test(tefMgrSrc)
      && /TEF_NATIVE_HOST_SESSAO_PERDIDA/.test(tefMgrSrc)
  };
  ok('Código: transactionId no IPC (HostBridge)', report.auditoriaCodigoMrt23.hostBridgePropagaTransactionId);
  ok('Código: sessaoHost.pid ancorada', report.auditoriaCodigoMrt23.tefManagerAncoraSessaoHost);
  ok('Código: /continuar usa hostClient compartilhado', report.auditoriaCodigoMrt23.continuarUsaHostCompartilhado);
  ok('Código: PID divergente → inconclusivo', report.auditoriaCodigoMrt23.pidDivergenteInconclusivo);

  // ——— 2. Gate + V$Pague ———
  console.log('\n2. Pré-condições ambiente');
  ok('Gate financeiro OFF', transacaoRealHabilitada() === false);

  const vspague = sdkDetector.detectarVsPagueClient();
  report.evidencias.vspague = {
    detectado: vspague.detectado === true,
    executando: vspague.executando === true,
    responding: vspague.responding,
    pid: vspague.pid || null,
    caminho: vspague.caminho || null
  };
  if (!report.evidencias.vspague.detectado
    || !report.evidencias.vspague.executando
    || report.evidencias.vspague.responding === false) {
    report.classificacao = 'SESSÃO NÃO VALIDADA';
    report.resultadoFinal = 'MRT-23.1 BLOQUEADA — V$PAGUE CLIENT INDISPONÍVEL';
    report.problemas.push({ item: 'V$Pague', erro: 'Client não ativo/Responding' });
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.error(report.resultadoFinal);
    process.exit(1);
  }
  ok('V$Pague Client ativo', true, { detalhe: `pid=${vspague.pid}` });

  if (!versao) {
    report.classificacao = 'SESSÃO NÃO VALIDADA';
    report.resultadoFinal = 'MRT-23.1 BLOQUEADA — VERSÃO AUSENTE';
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    process.exit(1);
  }

  const configRo = await carregarConfigSomenteLeitura();
  const configInit = {
    provedor: 'destaxa',
    ambiente: (configRo.ambiente && configRo.ambiente !== 'simulacao') ? configRo.ambiente : 'homologacao',
    empresa_codigo: configRo.empresaCodigo || null,
    loja_codigo: configRo.lojaCodigo || null,
    terminal_codigo: configRo.terminalCodigo || null,
    pdv_codigo: configRo.pdvCodigo || null,
    caixa_codigo: configRo.caixaCodigo || null
  };
  const projecao = projetarEntradaIniciaClient(configInit, { versao, aplicacao: APLICACAO });
  report.evidencias.configSomenteLeitura = configRo;
  report.evidencias.entradaInit = {
    texto: projecao.texto,
    chaves: projecao.chaves,
    incluiPdvOuCaixa: projecao.incluiPdvOuCaixa,
    ambiente: configInit.ambiente
  };

  // ——— 3. Host compartilhado + LOAD + INIT ———
  console.log('\n3. INIT homologação no Native Host compartilhado');
  const clientShared = obterClienteCompartilhado();
  const clientSharedRef2 = obterClienteCompartilhado();
  ok('Identidade host compartilhado (singleton)', clientShared === clientSharedRef2);

  const segundoClienteNaoIniciado = new DestaxaNativeHostClient();
  ok('Segundo Native Host não substitui o compartilhado (instância distinta)',
    segundoClienteNaoIniciado !== clientShared
    && clienteCompartilhadoExistente() === clientShared);

  const contadores = bloquearTxEEnableReal(clientShared);
  const started = await clientShared.iniciar();
  ok('Native Host compartilhado READY', started === true);

  const bridge = new DestaxaHostBridge({ client: clientShared, config: configInit });
  const adapterA = new DestaxaRealAdapter(configInit, { bridge, executionMode: 'native-host' });

  const carga = await bridge.load();
  report.evidencias.load = {
    sucesso: carga?.sucesso === true,
    estado: carga?.estado || carga?.diagnostico?.estado || null,
    dllLoaded: carga?.diagnostico?.dllLoaded === true || carga?.dllLoaded === true,
    exportsValid: carga?.diagnostico?.exportsValid === true,
    clientInitializedAntes: carga?.diagnostico?.clientInitialized === true,
    codigo: carga?.codigo || null,
    mensagem: carga?.mensagem || null
  };
  ok('LOAD pré-INIT', report.evidencias.load.sucesso === true);

  const statusAntes = await bridge.getHostStatus();
  const pidAntes = statusAntes?.pid || clientShared.getEstado().pid;
  report.evidencias.pidAntesInit = pidAntes;
  report.evidencias.statusAntesInit = {
    disponivel: statusAntes?.disponivel === true,
    pid: pidAntes,
    clientInitialized: statusAntes?.diagnostics?.clientInitialized === true,
    estado: statusAntes?.diagnostics?.estado || null,
    processType: statusAntes?.processType || null
  };
  console.log(`  PID antes INIT: ${pidAntes}`);

  const t0 = Date.now();
  let initResultado = null;
  let initErro = null;
  try {
    initResultado = await bridge.iniciarClient(configInit);
  } catch (error) {
    initErro = error;
  }
  const duracaoWallMs = Date.now() - t0;

  report.evidencias.init = {
    sucesso: initResultado?.sucesso === true,
    codigoDestaxa: initResultado?.codigoDestaxa || null,
    codigo: initResultado?.codigo || null,
    estado: initResultado?.estado || null,
    mensagem: initResultado?.mensagem || null,
    duracaoWallMs,
    chamadasInit: contadores.init,
    erro: initErro ? serializarErro(initErro) : null,
    diagnostico: initResultado?.diagnostico
      ? {
        clientInitialized: initResultado.diagnostico.clientInitialized === true,
        clientResultCode: initResultado.diagnostico.clientResultCode || null,
        estado: initResultado.diagnostico.estado || null,
        dllLoaded: initResultado.diagnostico.dllLoaded === true
      }
      : null
  };
  console.log('  INIT:', JSON.stringify({
    sucesso: report.evidencias.init.sucesso,
    codigoDestaxa: report.evidencias.init.codigoDestaxa,
    estado: report.evidencias.init.estado,
    chamadasInit: contadores.init
  }));

  ok('INIT único (sem retry)', contadores.init <= 1);
  ok('Nenhuma TX / ENABLE_REAL durante INIT', contadores.tx === 0 && contadores.enableReal === 0);

  const statusDepois = await bridge.getHostStatus();
  const pidDepois = statusDepois?.pid || clientShared.getEstado().pid;
  report.evidencias.pidDepoisInit = pidDepois;
  report.evidencias.statusDepoisInit = {
    disponivel: statusDepois?.disponivel === true,
    pid: pidDepois,
    clientInitialized: statusDepois?.diagnostics?.clientInitialized === true,
    clientResultCode: statusDepois?.diagnostics?.clientResultCode || null,
    estado: statusDepois?.diagnostics?.estado || null,
    dllLoaded: statusDepois?.diagnostics?.dllLoaded === true
  };
  console.log(`  PID depois INIT: ${pidDepois}; clientInitialized=${report.evidencias.statusDepoisInit.clientInitialized}`);

  const initOk = report.evidencias.init.sucesso === true
    && (report.evidencias.init.codigoDestaxa === '00'
      || report.evidencias.statusDepoisInit.clientInitialized === true);

  ok('clientInitialized=true após INIT', report.evidencias.statusDepoisInit.clientInitialized === true);
  ok('Mesmo PID antes e depois do INIT',
    pidAntes != null && pidDepois != null && String(pidAntes) === String(pidDepois),
    { detalhe: `${pidAntes}→${pidDepois}` });

  // ——— 4. Continuidade na mesma sessão (sem CRT) ———
  console.log('\n4. Continuidade na mesma sessão (sem TX)');

  // Adapter recriado apontando ao mesmo client compartilhado
  const bridgeB = new DestaxaHostBridge({ client: clientShared, config: configInit });
  const adapterB = new DestaxaRealAdapter(configInit, {
    executionMode: 'native-host',
    hostClient: obterClienteCompartilhado()
  });
  const statusViaB = await bridgeB.getHostStatus();
  const diagB = await adapterB.bridge.getDiagnostics();
  report.evidencias.adapterRecriadoMesmaSessao = {
    mesmoClient: adapterB.bridge.client === clientShared,
    bridgesDistintos: bridge !== bridgeB,
    pid: statusViaB?.pid || null,
    clientInitialized: statusViaB?.diagnostics?.clientInitialized === true
      || diagB?.clientInitialized === true,
    estado: statusViaB?.diagnostics?.estado || diagB?.estado || null
  };
  ok('Continuidade: adapter recriado usa mesma sessão (PID + clientInitialized)',
    adapterB.bridge.client === clientShared
    && String(statusViaB?.pid) === String(pidDepois)
    && (statusViaB?.diagnostics?.clientInitialized === true || diagB?.clientInitialized === true),
    { detalhe: `pid=${statusViaB?.pid}` });

  // TefManager ancora PID da sessão viva
  const mgr = new TefManager({ recuperarNoInicio: false });
  mgr._marcarContinuidadeCrt('mrt231-tx', { idempotency_key: 'ik-231' }, { acao: { tipo: 'COLETA' } });
  report.evidencias.ancoraContinuidade = mgr._continuidadeCrt?.sessaoHost || null;
  const validMesmo = mgr._validarSessaoNativeHostContinuidade(mgr._continuidadeCrt.sessaoHost);
  ok('Continuidade: validação PID aceita sessão atual do host compartilhado',
    validMesmo.ok === true
    && mgr._continuidadeCrt.sessaoHost
    && String(mgr._continuidadeCrt.sessaoHost.pid) === String(pidDepois));

  // IPC transactionId (contrato HostBridge — sem TX real no host)
  {
    const ipcLog = [];
    const fake = {
      async enviar(operation, payload, opcoes = {}) {
        ipcLog.push({ operation, transactionId: opcoes.transactionId ?? null });
        return {
          error: null,
          output: {
            sucesso: true,
            codigoDestaxa: '00',
            contexto: { transactionId: opcoes.transactionId }
          }
        };
      }
    };
    const bNovo = new DestaxaHostBridge({ client: fake });
    assert.strictEqual(bNovo._transactionId, null);
    await bNovo.continuarTransacaoDestaxa({ informacao: 'x' }, { transactionId: 'persist-231' });
    await bNovo.finalizarTransacaoDestaxa(0, { transactionId: 'persist-231' });
    const cont = ipcLog.find((c) => c.operation === OPERACOES_HOST.TX_CONTINUE);
    const fin = ipcLog.find((c) => c.operation === OPERACOES_HOST.TX_FINALIZE);
    ok('transactionId propagada no IPC CONTINUE/FINALIZE (bridge novo)',
      cont?.transactionId === 'persist-231' && fin?.transactionId === 'persist-231');
    report.evidencias.ipcTransactionId = {
      continue: cont?.transactionId || null,
      finalize: fin?.transactionId || null,
      nota: 'Prova de contrato IPC — TX não enviada ao Native Host real (guard ativo)'
    };
  }

  // PID divergente
  {
    const v = mgr._validarSessaoNativeHostContinuidade({ pid: 1, estado: 'READY' });
    ok('PID divergente → estado inconclusivo (sem retry financeiro)',
      v.ok === false
      && (v.codigo === 'TEF_NATIVE_HOST_SESSAO_REINICIADA'
        || v.codigo === 'TEF_NATIVE_HOST_SESSAO_PERDIDA'),
      { detalhe: v.codigo });
  }

  ok('Nenhuma TX real / ENABLE_REAL no ciclo completo',
    contadores.tx === 0 && contadores.enableReal === 0);

  // ——— Classificação ———
  const persistente = initOk
    && report.evidencias.statusDepoisInit.clientInitialized === true
    && String(pidAntes) === String(pidDepois)
    && report.evidencias.adapterRecriadoMesmaSessao.clientInitialized === true
    && report.evidencias.adapterRecriadoMesmaSessao.mesmoClient === true
    && report.testes.every((t) => t.ok);

  if (persistente) {
    report.classificacao = 'SESSÃO PERSISTENTE VALIDADA';
  } else if (initOk && report.evidencias.statusDepoisInit.clientInitialized) {
    report.classificacao = 'SESSÃO PARCIALMENTE VALIDADA';
  } else {
    report.classificacao = 'SESSÃO NÃO VALIDADA';
  }

  report.confirmacaoNenhumaOperacaoFinanceiraReal = {
    gateOff: true,
    crt: false,
    enableReal: false,
    txBloqueadasPeloGuard: contadores.tx,
    mensagem: 'INIT homologação executado; nenhuma CRT/EST/ENABLE_REAL/cobrança'
  };
  report.resultadoFinal = `MRT-23.1 CONCLUÍDA — ${report.classificacao}`;

  // Encerrar host ao fim (sessão morre com o processo — documentado)
  try {
    await clientShared.encerrar({ aguardarMs: 4000 });
    report.evidencias.hostEncerradoAoFim = true;
    report.evidencias.notaEncerramento = 'Sessão CLIENT_INITIALIZED vive no processo host; encerrar ao fim da sprint destrói a sessão (esperado).';
  } catch (error) {
    report.evidencias.hostEncerradoAoFim = false;
    report.problemas.push({ item: 'encerrar', erro: error.message });
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  PID: ${pidAntes} → ${pidDepois}`);
  console.log(`  Classificação: ${report.classificacao}`);
  console.log(`  ${report.resultadoFinal}\n`);

  assert.ok(initOk, 'INIT homologação deve estabelecer sessão');
  assert.strictEqual(report.classificacao, 'SESSÃO PERSISTENTE VALIDADA');
}

main().catch((error) => {
  console.error('MRT-23.1 FALHOU:', error);
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify({
      sprint: 'MRT-23.1',
      fatal: true,
      classificacao: 'SESSÃO NÃO VALIDADA',
      erro: serializarErro(error),
      stack: error.stack
    }, null, 2));
  } catch (_) { /* ignore */ }
  process.exitCode = 1;
});
