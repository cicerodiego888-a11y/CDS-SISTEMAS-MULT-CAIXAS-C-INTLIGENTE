'use strict';

/**
 * TEF-DESTAXA-06C-MITIGACAO — verificações do TEF Native Host executáveis em
 * Node (child_process) e no processo principal do Electron (utilityProcess).
 *
 * - responsividade/crash usam o host em modo de teste (chamada bloqueante simulada);
 * - validação nativa real usa o host com tripwire: somente LOAD e INIT_CLIENT
 *   alcançam a DLL; funções transacionais nunca são chamadas.
 */

const { Worker } = require('worker_threads');
const destaxaKoffiLoader = require('./destaxaKoffiLoader');
const { DestaxaNativeHostClient, ESTADOS_CLIENTE } = require('./DestaxaNativeHostClient');
const { TEST_MODE_ENV, TRIPWIRE_ENV } = require('./DestaxaNativeHost');
const { OPERACOES_HOST, ERROS_HOST, criarRequest } = require('./destaxaNativeHostProtocolo');
const { transacaoRealHabilitada, OPERACOES } = require('./destaxaConstantes');

function aguardar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function criarEcoIpc() {
  return new Worker(
    "const { parentPort } = require('worker_threads'); parentPort.on('message', (m) => parentPort.postMessage(m));",
    { eval: true }
  );
}

/** Mede o event loop do Main (timer + IPC eco) enquanto o host executa chamada bloqueante. */
async function verificarResponsividade({ blockMs = 1500 } = {}) {
  const cliente = new DestaxaNativeHostClient({ env: { [TEST_MODE_ENV]: '1' }, timeoutMs: blockMs + 10000 });
  const iniciado = await cliente.iniciar();
  if (!iniciado) {
    return { ok: false, motivo: 'host não iniciou', estado: cliente.getEstado() };
  }
  const info = cliente.getEstado();

  const eco = criarEcoIpc();
  let ecoIdas = 0;
  let ecoVoltas = 0;
  eco.on('message', () => { ecoVoltas += 1; });

  let ticks = 0;
  let ultimoTick = Date.now();
  let maiorIntervalo = 0;
  const heartbeat = setInterval(() => {
    const agora = Date.now();
    maiorIntervalo = Math.max(maiorIntervalo, agora - ultimoTick);
    ultimoTick = agora;
    ticks += 1;
    ecoIdas += 1;
    eco.postMessage(ticks);
  }, 10);

  const inicio = Date.now();
  const chamada = cliente.enviar(OPERACOES_HOST.SIMULATE_BLOCKING, { ms: blockMs, codigo: '99' });

  await aguardar(100);
  const segunda = await cliente.enviar(OPERACOES_HOST.SIMULATE_BLOCKING, { ms: 10 });
  const estadoDurante = cliente.getEstado();
  cliente._processo.enviar(criarRequest(OPERACOES_HOST.SIMULATE_BLOCKING, { ms: 10 }, null, cliente._nativeSeq));

  const resposta = await chamada;
  const duracaoMain = Date.now() - inicio;
  clearInterval(heartbeat);
  await aguardar(150);
  const tardias = cliente._respostasTardias.slice();
  await eco.terminate();
  const encerramento = await cliente.encerrar();

  const ticksEsperados = Math.floor(duracaoMain / 10);
  return {
    ok: true,
    mainPid: process.pid,
    hostPid: info.pid,
    processType: info.processType,
    hostVersions: info.versions,
    blockMs,
    hostDurationMs: resposta.output?.duracaoMs ?? null,
    hostResultCode: resposta.resultCode,
    mainElapsedMs: duracaoMain,
    ticks,
    expectedTicks: ticksEsperados,
    maxLoopGapMs: maiorIntervalo,
    ipcRoundTrips: ecoVoltas,
    ipcSent: ecoIdas,
    secondOperation: segunda.error?.code || null,
    secondOperationSentToHost: segunda.local !== true,
    stateDuringCall: estadoDurante.estado,
    inFlightDuringCall: estadoDurante.emVoo ? estadoDurante.emVoo.operation : null,
    hostSideBusy: tardias.some((t) => t.errorCode === ERROS_HOST.HOST_BUSY),
    shutdown: encerramento
  };
}

function esperarEvento(emissor, evento, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    emissor.once(evento, (dados) => { clearTimeout(timer); resolve(dados || {}); });
  });
}

/** Queda do host (ociosa e durante TX_START) não derruba o Main e nunca vira aprovado/negado. */
async function verificarCrash() {
  const cliente = new DestaxaNativeHostClient({ env: { [TEST_MODE_ENV]: '1' }, timeoutMs: 10000 });
  await cliente.iniciar();
  const pidInicial = cliente.getEstado().pid;

  const crashOcioso = esperarEvento(cliente, 'crash', 5000);
  await cliente.enviar(OPERACOES_HOST.SIMULATE_CRASH);
  const eventoOcioso = await crashOcioso;
  const estadoAposCrash = cliente.estado;
  const aposCrash = await cliente.enviar(OPERACOES_HOST.PING);

  const reinicio = await cliente.reiniciar();
  await cliente.enviar(OPERACOES_HOST.CONFIGURE_MOCK, {
    passos: [{ fn: 'inicia', codigo: '00', saida: 'transacao_nsu=1', bloqueioMs: 200, crashHost: true }]
  });
  const transacional = await cliente.enviar(
    OPERACOES_HOST.TX_START,
    { operacao: OPERACOES.CRT, campos: { transacao_valor: '1.00' } },
    { transactionId: 'tx-crash' }
  );
  const estadoAposTx = cliente.getEstado();
  const novaTransacao = await cliente.enviar(
    OPERACOES_HOST.TX_START,
    { operacao: OPERACOES.CRT, campos: { transacao_valor: '1.00' } },
    { transactionId: 'tx-nova' }
  );
  const reinicioSemReconciliar = await cliente.reiniciar();
  const reinicioReconciliado = await cliente.reiniciar({ reconciliado: true });
  const ping = await cliente.enviar(OPERACOES_HOST.PING);
  const encerramento = await cliente.encerrar();

  return {
    mainPid: process.pid,
    mainAlive: true,
    idle: {
      hostPid: pidInicial,
      crashDetected: eventoOcioso != null,
      state: estadoAposCrash,
      nextRequest: aposCrash.error?.code || null
    },
    restart: reinicio,
    duringTransaction: {
      errorCode: transacional.error?.code || null,
      output: transacional.output,
      transactionId: transacional.transactionId,
      reconciliation: estadoAposTx.reconciliacaoPendente,
      state: estadoAposTx.estado,
      newTransaction: novaTransacao.error?.code || null,
      restartWithoutReconciliation: reinicioSemReconciliar,
      restartReconciled: reinicioReconciliado.sucesso,
      pingAfterRestart: ping.output?.pong === true
    },
    shutdown: encerramento
  };
}

/** DLL real no host com tripwire; Main não carrega a DLL. */
async function verificarNativoReal() {
  if (transacaoRealHabilitada()) {
    throw new Error('DESTAXA_REAL_TRANSACTION_ENABLED deve permanecer desabilitada');
  }
  let cargasMain = 0;
  const original = destaxaKoffiLoader.carregarBiblioteca;
  destaxaKoffiLoader.carregarBiblioteca = function contarCargaMain(...args) {
    cargasMain += 1;
    return original.apply(this, args);
  };

  const cliente = new DestaxaNativeHostClient({ env: { [TRIPWIRE_ENV]: '1' }, timeoutMs: 60000 });
  try {
    const iniciado = await cliente.iniciar();
    const info = cliente.getEstado();
    const carga = await cliente.enviar(OPERACOES_HOST.LOAD, { config: {} });
    const client = await cliente.enviar(OPERACOES_HOST.INIT_CLIENT, { config: {} });
    const habilitar = await cliente.enviar(OPERACOES_HOST.ENABLE_REAL);
    const tx = await cliente.enviar(
      OPERACOES_HOST.TX_START,
      { operacao: OPERACOES.CRT, campos: { transacao_valor: '1.00' } },
      { transactionId: 'tx-nativo-real' }
    );
    const testeRecusado = await cliente.enviar(OPERACOES_HOST.SIMULATE_BLOCKING, { ms: 10 });
    const status = await cliente.enviar(OPERACOES_HOST.STATUS);
    const diag = status.output?.diagnostics || {};
    const exportsValidos = Object.values(diag.exports || {}).filter(Boolean).length;
    return {
      hostStarted: iniciado,
      hostPid: info.pid,
      processType: info.processType,
      hostVersions: info.versions,
      mainPid: process.pid,
      mainProcessDllLoads: cargasMain,
      tripwire: status.output?.tripwire === true,
      testModeInHost: status.output?.modoTeste === true,
      dll: {
        loaded: diag.dllLoaded === true,
        exports: exportsValidos,
        path: diag.dllPath || null,
        loadSuccess: carga.output?.sucesso === true
      },
      client: {
        initialized: diag.clientInitialized === true,
        code: client.output?.codigoDestaxa || diag.clientResultCode || null
      },
      enableReal: habilitar.output?.codigo || habilitar.error?.code || null,
      txStart: tx.output?.codigoDestaxa || tx.error?.code || null,
      testOperationInProduction: testeRecusado.error?.code || null,
      counters: status.output?.contadores || null,
      gateReal: status.output?.gateReal === true
    };
  } finally {
    destaxaKoffiLoader.carregarBiblioteca = original;
    await cliente.encerrar();
  }
}

async function executarTodas() {
  const responsividade = await verificarResponsividade();
  const crash = await verificarCrash();
  const nativo = await verificarNativoReal();
  return { responsividade, crash, nativo, estadosCliente: ESTADOS_CLIENTE };
}

module.exports = {
  verificarResponsividade,
  verificarCrash,
  verificarNativoReal,
  executarTodas
};
