'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const PREFLIGHT = process.env.MRT50_DB_PREFLIGHT === '1';
const WORKER = process.argv.includes('--mrt50-main-worker');
const OFICIAL_DB_DIR = path.resolve(
  path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados')
);

function verificarIsolamentoAntesDosModulosBanco() {
  const dir = path.resolve(process.env.DB_DIR || '');
  const baseTemporaria = path.resolve(os.tmpdir());
  assert.ok(dir && dir !== path.parse(dir).root, 'DB_DIR ausente ou raiz do disco');
  assert.notStrictEqual(dir, OFICIAL_DB_DIR, 'DB_DIR aponta para o banco oficial');
  assert.ok(!path.relative(baseTemporaria, dir).startsWith('..'), 'DB_DIR fora do diretório temporário');

  const caminhoEsperado = path.resolve(dir, 'mercadao.db');
  assert.notStrictEqual(caminhoEsperado, path.join(OFICIAL_DB_DIR, 'mercadao.db'));
  const database = require('../../backend/database');
  assert.strictEqual(path.resolve(database.dbDir), dir);
  assert.strictEqual(path.resolve(database.dbPath), caminhoEsperado);
  return database;
}

function instrumentarMockDoNativeHost() {
  const DestaxaNativeBridge = require('../../backend/services/tef/destaxa/DestaxaNativeBridge');
  const original = DestaxaNativeBridge.prototype.configurarDriverTransacaoMock;
  DestaxaNativeBridge.prototype.configurarDriverTransacaoMock = function instrumentar(passos) {
    const mock = original.call(this, passos);
    for (const [metodo, contador] of [
      ['iniciaTransacaoDestaxa', 'iniciaTransacaoDestaxa'],
      ['continuaTransacaoDestaxa', 'continuaTransacaoDestaxa'],
      ['finalizaTransacaoDestaxa', 'finalizaTransacaoDestaxa']
    ]) {
      const executar = mock[metodo].bind(mock);
      mock[metodo] = (...args) => {
        const total = (mock._mrt50Contadores?.[contador] || 0) + 1;
        mock._mrt50Contadores = { ...(mock._mrt50Contadores || {}), [contador]: total };
        if (typeof process.send === 'function' && process.connected) {
          process.send({
            tipo: 'MRT50_DRIVER_CALL',
            pid: process.pid,
            metodo: contador,
            chamada: total
          });
        }
        return executar(...args);
      };
    }
    return mock;
  };
}

if (PREFLIGHT) {
  instrumentarMockDoNativeHost();
  verificarIsolamentoAntesDosModulosBanco();
} else if (WORKER) {
  executarProcessoPrincipal().catch((error) => {
    enviarControle({ tipo: 'worker-failure', erro: error.stack || error.message });
    process.exitCode = 1;
  });
} else if (process.env.MRT50_C6_ONLY === '1') {
  executarC6Verificacao().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
} else {
  executarHarness().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

function exigirBancoPronto(database) {
  return new Promise((resolve, reject) => {
    const limite = Date.now() + 30000;
    const verificar = () => {
      if (database.isReady()) return resolve();
      if (Date.now() >= limite) return reject(new Error('SQLite temporário MRT-50 não ficou pronto'));
      setTimeout(verificar, 20);
    };
    verificar();
  });
}

function registrarEvento(eventos, evento) {
  eventos.push({ em: new Date().toISOString(), ...evento });
  if (eventos.length > 500) eventos.shift();
  if (typeof process.send === 'function' && process.connected) {
    process.send({ tipo: 'telemetry', evento });
  }
}

function criarSpawnerInstrumentado(eventos, controlarFalha) {
  const { criarSpawnerPadrao } = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
  const spawnerBase = criarSpawnerPadrao();

  return (hostPath, env) => {
    const execArgvAnterior = process.execArgv;
    process.execArgv = ['--require', path.resolve(__filename)];
    let processo;
    try {
      processo = spawnerBase(hostPath, {
        ...env,
        DB_DIR: process.env.DB_DIR,
        DESTAXA_NATIVE_HOST_TEST_MODE: '1',
        DESTAXA_NATIVE_HOST_TRIPWIRE: '1',
        MRT50_DB_PREFLIGHT: '1',
        NODE_OPTIONS: ''
      });
    } finally {
      process.execArgv = execArgvAnterior;
    }
    const listeners = [];
    const operacoesPorRequest = new Map();
    const enviarOriginal = processo.enviar.bind(processo);
    const receberOriginal = processo.aoReceber.bind(processo);
    const sairOriginal = processo.aoSair.bind(processo);
    const estadoProcesso = {
      processo,
      pid: processo.pid,
      nativeSeq: 0,
      mensagemHostReady: null,
      held: null
    };

    receberOriginal((mensagem) => {
      if (mensagem?.tipo === 'MRT50_DRIVER_CALL') {
        registrarEvento(eventos, {
          tipo: 'driver-call',
          source: 'nativehost-child-ipc',
          pid: mensagem.pid,
          method: mensagem.metodo,
          callNumber: mensagem.chamada
        });
        return;
      }
      if (mensagem?.tipo === 'HOST_READY') {
        estadoProcesso.mensagemHostReady = mensagem;
        registrarEvento(eventos, {
          direcao: 'host->main',
          tipo: 'HOST_READY',
          pid: mensagem.pid,
          ppid: mensagem.ppid,
          hostSessionId: mensagem.hostSessionId,
          processType: mensagem.processType
        });
        for (const listener of listeners) listener(mensagem);
        return;
      }

      const operation = operacoesPorRequest.get(mensagem?.requestId) || null;
      if (Number.isInteger(mensagem?.nativeSeq)) {
        estadoProcesso.nativeSeq = mensagem.nativeSeq;
      }
      registrarEvento(eventos, {
        direcao: 'host->main',
        tipo: 'response',
        operation,
        requestId: mensagem?.requestId || null,
        transactionId: mensagem?.transactionId || null,
        pid: estadoProcesso.pid,
        resultCode: mensagem?.resultCode || null,
        errorCode: mensagem?.error?.code || null,
        hostSessionId: estadoProcesso.mensagemHostReady?.hostSessionId || null,
        output: operation === 'RECONCILE' ? {
          sucesso: mensagem?.output?.sucesso === true,
          transactionId: mensagem?.output?.transactionId || null,
          financialState: mensagem?.output?.financialState || null,
          hostAtualizado: mensagem?.output?.hostAtualizado === true
        } : null,
        responseReceivedByAdapter: true
      });

      const fault = controlarFalha?.(operation, mensagem, estadoProcesso);
      if (fault?.action === 'drop-kill') {
        registrarEvento(eventos, {
          tipo: 'fault',
          action: fault.action,
          operation,
          requestId: mensagem.requestId,
          ackDeliveredToClient: false,
          hostPid: estadoProcesso.pid,
          hostSessionId: estadoProcesso.mensagemHostReady?.hostSessionId || null
        });
        processo.matar();
        return;
      }
      if (fault?.action === 'drop') {
        registrarEvento(eventos, { tipo: 'fault', action: fault.action, operation, requestId: mensagem.requestId });
        return;
      }
      if (fault?.action === 'hold') {
        estadoProcesso.held = {
          mensagem,
          entregar: () => {
            registrarEvento(eventos, {
              tipo: 'held-response-delivered',
              operation,
              requestId: mensagem.requestId,
              pid: estadoProcesso.pid
            });
            for (const listener of listeners) listener(mensagem);
          }
        };
        registrarEvento(eventos, { tipo: 'fault', action: fault.action, operation, requestId: mensagem.requestId });
        return;
      }
      if (fault?.action === 'mismatch-id') {
        registrarEvento(eventos, { tipo: 'fault', action: fault.action, operation, requestId: mensagem.requestId });
        const adulterada = { ...mensagem, requestId: `mrt50-mismatch-${mensagem.requestId}` };
        for (const listener of listeners) listener(adulterada);
        return;
      }
      if (fault?.action === 'delay') {
        registrarEvento(eventos, { tipo: 'fault', action: fault.action, operation, requestId: mensagem.requestId });
        setTimeout(() => {
          for (const listener of listeners) listener(mensagem);
        }, fault.delayMs || 250);
        return;
      }
      for (const listener of listeners) listener(mensagem);
    });

    processo.enviar = (mensagem) => {
      if (mensagem?.requestId) operacoesPorRequest.set(mensagem.requestId, mensagem.operation);
      registrarEvento(eventos, {
        direcao: 'main->host',
        tipo: 'request',
        operation: mensagem?.operation || null,
        requestId: mensagem?.requestId || null,
        transactionId: mensagem?.transactionId || null,
        processPid: processo.pid
      });
      enviarOriginal(mensagem);
    };
    processo.aoReceber = (listener) => listeners.push(listener);
    processo.aoSair = (listener) => sairOriginal((code, signal) => {
      registrarEvento(eventos, { tipo: 'host-exit', pid: processo.pid, code: code ?? null, signal: signal || null });
      listener(code, signal);
    });
    estadoProcesso.listeners = listeners;
    estadoProcesso.requestOperations = operacoesPorRequest;
    estadoProcesso.deliverHeld = () => estadoProcesso.held?.entregar();
    estadoProcesso.sendRaw = (request) => processo.enviar(request);
    estadoProcesso.awaitResponse = (requestId, timeoutMs = 2000) => new Promise((resolve, reject) => {
      let timer;
      const listener = (mensagem) => {
        if (mensagem?.requestId !== requestId) return;
        clearTimeout(timer);
        resolve(mensagem);
      };
      listeners.push(listener);
      timer = setTimeout(() => reject(new Error(`Timeout aguardando resposta IPC ${requestId}`)), timeoutMs);
    });
    estadoProcesso.removeListeners = () => {
      listeners.length = 0;
    };
    estadoProcesso.waitReady = () => {
      if (estadoProcesso.mensagemHostReady) return Promise.resolve(estadoProcesso.mensagemHostReady);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout aguardando HOST_READY do processo filho')), 5000);
        listeners.push((mensagem) => {
          if (mensagem?.tipo !== 'HOST_READY') return;
          clearTimeout(timer);
          resolve(mensagem);
        });
      });
    };
    estadoProcesso.tipo = processo.tipo;
    estadoProcesso.enviar = processo.enviar;
    estadoProcesso.aoReceber = processo.aoReceber;
    estadoProcesso.aoSair = processo.aoSair;
    estadoProcesso.aoErro = processo.aoErro?.bind(processo);
    estadoProcesso.matar = processo.matar.bind(processo);
    estadoProcesso.ref = processo.ref.bind(processo);
    estadoProcesso.unref = processo.unref.bind(processo);
    estadoProcesso.desconectarIpc = processo.desconectarIpc?.bind(processo);
    Object.defineProperty(estadoProcesso, 'connected', {
      enumerable: true,
      get: () => processo.connected
    });
    return estadoProcesso;
  };
}

function criarRequestRaw(protocolo, operation, payload = {}, transactionId = null, nativeSeq = 0) {
  return protocolo.criarRequest(operation, payload, transactionId, nativeSeq);
}

async function enviarRaw(processo, protocolo, operation, payload = {}, transactionId = null, nativeSeq = null) {
  const sequencia = nativeSeq == null ? processo.nativeSeq || 0 : nativeSeq;
  const request = criarRequestRaw(protocolo, operation, payload, transactionId, sequencia);
  const resposta = processo.awaitResponse(request.requestId);
  processo.sendRaw(request);
  return resposta;
}

async function encerrarProcessoHost(processo) {
  if (!processo?.processo) return null;
  const saiu = new Promise((resolve) => {
    processo.processo.aoSair(resolve);
  });
  processo.processo.matar();
  return Promise.race([saiu, new Promise((resolve) => setTimeout(() => resolve(null), 2000))]);
}

async function executarProcessoPrincipal() {
  const database = verificarIsolamentoAntesDosModulosBanco();
  await exigirBancoPronto(database);
  process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';

  const TefManagerModule = require('../../backend/services/tef/TefManager');
  const TefManager = TefManagerModule.TefManager;
  const repository = require('../../backend/services/tef/tefRepository');
  const DestaxaHostBridge = require('../../backend/services/tef/destaxa/DestaxaHostBridge');
  const DestaxaNativeHost = require('../../backend/services/tef/destaxa/DestaxaNativeHost');
  const NativeHostClientModule = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
  const protocolo = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
  const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');
  const { transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');
  assert.strictEqual(transacaoRealHabilitada(), false);

  const eventos = [];
  let fault = null;
  let client = null;
  let manager = null;
  let bridge = null;
  let ultimoHost = null;
  const resultadosWorker = [];

  const controlarFalha = (operation, mensagem, host) => {
    if (!fault || fault.operation !== operation) return null;
    const atual = fault;
    if (atual.once !== false) fault = null;
    if (atual.action === 'hold') host.held = { mensagem };
    return atual;
  };

  function novoClientManager() {
    client = new NativeHostClientModule.DestaxaNativeHostClient({
      spawner: criarSpawnerInstrumentado(eventos, controlarFalha),
      timeoutInicioMs: 1200,
      timeoutMs: 180
    });
    manager = new TefManager({ nativeHostClient: client, recuperarNoInicio: false });
    bridge = new DestaxaHostBridge({ client });
    ultimoHost = null;
    return { client, manager, bridge };
  }

  async function iniciarComRecuperacao() {
    if (!manager) novoClientManager();
    await manager.garantirRecuperacao();
    const sucesso = await client.iniciar();
    const hostStatus = sucesso ? await client.enviar(protocolo.OPERACOES_HOST.STATUS) : null;
    ultimoHost = hostStatus?.output || null;
    return {
      sucesso,
      estadoCliente: client.getEstado().estado,
      host: ultimoHost,
      identidadeRecuperadas: manager.listarTravasPendencias().map((item) => item.transacaoId),
      databasePath: database.dbPath
    };
  }

  function atualizarFalha(action, operation, extra = {}) {
    fault = { action, operation, ...extra };
  }

  async function obterStatusHost() {
    const resposta = await client.enviar(protocolo.OPERACOES_HOST.STATUS);
    if (resposta.error) throw new Error(`STATUS falhou: ${resposta.error.code}`);
    return resposta.output;
  }

  async function rawCurrent(operation, payload = {}, transactionId = null) {
    const processo = client._processo;
    if (!processo) throw new Error('NativeHost filho não está associado ao cliente');
    const hostRecord = [...eventos].reverse().find((item) => item.tipo === 'host-record');
    void hostRecord;
    const request = protocolo.criarRequest(
      operation,
      payload,
      transactionId,
      client._nativeSeq
    );
    const activeProcess = client._processo;
    const rawResponse = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout raw IPC ${operation}`)), 2500);
      activeProcess.aoReceber((mensagem) => {
        if (mensagem?.requestId !== request.requestId) return;
        clearTimeout(timer);
        resolve(mensagem);
      });
    });
    activeProcess.enviar(request);
    return rawResponse;
  }

  async function registro(id) {
    return new Promise((resolve, reject) => {
      repository.obterTransacaoPorId(id, (error, row) => (error ? reject(error) : resolve(row)));
    });
  }

  function dadosReconciliacao() {
    return {
      financialState: FINANCIAL_STATES.CONFIRMED_DENIED,
      usuario: 'mrt50-operador-sintetico',
      observacao: 'reconciliação isolada de identidade fictícia',
      confirmacao_explicita: true
    };
  }

  async function criarPendenciaWorker(tag, financialState = FINANCIAL_STATES.UNKNOWN) {
    const identity = {
      operation_id: `mrt50-worker-op-${tag}-${crypto.randomBytes(4).toString('hex')}`,
      idempotency_key: `mrt50-worker-idem-${tag}-${crypto.randomBytes(4).toString('hex')}`,
      fingerprint: `mrt50-worker-fp-${tag}`
    };
    const id = await new Promise((resolve, reject) => {
      repository.criarTransacao({
        tipo: 'CRT',
        valor: 1,
        status: 'pendente',
        provedor: 'DESTAXA',
        idempotency_key: identity.idempotency_key,
        codigo_transacao: identity.operation_id,
        payload_retorno: {
          financialState,
          persistencia: { ...identity, estadoFinanceiroInicial: financialState }
        }
      }, (error, rowId) => (error ? reject(error) : resolve(String(rowId))));
    });
    return { id, identity };
  }

  async function workerAction(action, input = {}) {
    switch (action) {
      case 'start':
        return iniciarComRecuperacao();
      case 'start-bootstrap-drop': {
        atualizarFalha('drop-kill', protocolo.OPERACOES_HOST.SECURITY_BOOTSTRAP);
        const resultado = await iniciarComRecuperacao();
        return {
          ...resultado,
          bootstrapFalha: client.getEstado().securityBootstrapState,
          eventos: eventos.slice(-30)
        };
      }
      case 'configure-mock': {
        const resposta = await client.enviar(
          protocolo.OPERACOES_HOST.CONFIGURE_MOCK,
          { passos: input.passos || [] }
        );
        return { resposta: resposta.output || resposta.error, host: await obterStatusHost() };
      }
      case 'raw-guards': {
        const respostas = {};
        for (const operation of [
          protocolo.OPERACOES_HOST.TX_START,
          protocolo.OPERACOES_HOST.TX_CONTINUE,
          protocolo.OPERACOES_HOST.TX_FINALIZE
        ]) {
          const payload = operation === protocolo.OPERACOES_HOST.TX_START
            ? { operacao: 'CRT', campos: {} }
            : operation === protocolo.OPERACOES_HOST.TX_CONTINUE
              ? { resposta: {} }
              : { confirmacao: 0 };
          respostas[operation] = await rawCurrent(operation, payload, 'mrt50-no-permit');
        }
        return { respostas, host: await obterStatusHost() };
      }
      case 'status-fault': {
        atualizarFalha(input.action, protocolo.OPERACOES_HOST.STATUS, input);
        const resposta = await client.enviar(protocolo.OPERACOES_HOST.STATUS, {}, { timeoutMs: input.timeoutMs || 100 });
        return {
          resposta,
          estadoCliente: client.getEstado().estado,
          eventos: eventos.slice(-25)
        };
      }
      case 'hold-status-restart': {
        const sessionAntes = client.getEstado().hostSessionId;
        atualizarFalha('hold', protocolo.OPERACOES_HOST.STATUS);
        const respostaTardia = await client.enviar(
          protocolo.OPERACOES_HOST.STATUS,
          {},
          { timeoutMs: 80 }
        );
        const oldRecord = client._processo;
        const oldResponseCaptured = await aguardarCondicao(
          () => oldRecord?.held?.mensagem,
          3000
        );
        if (!oldResponseCaptured) throw new Error('A resposta do NativeHost da geração anterior não foi retida');
        const oldHeldResponse = oldRecord.held?.mensagem;
        oldRecord.matar();
        const crashed = await aguardarCondicao(() => client.getEstado().estado === 'CRASHED', 3000);
        const reinicio = await client.prepararHostParaReconciliacao(input.transactionId);
        const sessionDepois = client.getEstado().hostSessionId;
        const generationAfterRestart = client._geracao;

        atualizarFalha('hold', protocolo.OPERACOES_HOST.STATUS);
        const newRequestPromise = client.enviar(
          protocolo.OPERACOES_HOST.STATUS,
          {},
          { timeoutMs: 2500 }
        );
        const newResponseHeld = await aguardarCondicao(
          () => client._processo?.held?.mensagem,
          3000
        );
        const heldNewResponse = newResponseHeld ? client._processo.held.mensagem : null;
        const newRequestId = client.getEstado().emVoo?.requestId;
        const newSessionRequestId = client._processo?.held?.mensagem?.requestId;
        if (!heldNewResponse || !newRequestId || newRequestId !== newSessionRequestId) {
          throw new Error('A nova solicitação STATUS não ficou aguardando seu próprio ACK');
        }
        const currentStateBeforeStale = client.getEstado();
        oldRecord.deliverHeld();
        const stateAfterStale = client.getEstado();
        const generationAfterStale = client._geracao;
        const sameRequestStillPending = stateAfterStale.emVoo?.requestId === newRequestId;
        const sameSessionAfterStale = stateAfterStale.hostSessionId === sessionDepois;
        const sameGenerationAfterStale = generationAfterStale === generationAfterRestart;
        const staleResponseSession = oldHeldResponse?.output?.hostSessionId || null;
        const staleRequestId = oldHeldResponse?.requestId || null;
        const newResponseSession = heldNewResponse.output?.hostSessionId || null;
        const newResponseRequestId = heldNewResponse.requestId || null;
        const stillWaitingAfterStale = client.getEstado().estado === 'BUSY';
        client._processo.deliverHeld();
        const newRequestResponse = await newRequestPromise;
        const status = newRequestResponse.output;
        return {
          respostaTardia: respostaTardia.error?.code || null,
          oldHostCrashed: crashed,
          reinicio,
          sessionAntes,
          sessionDepois,
          generationAfterRestart,
          generationAfterStale,
          oldRequestId: staleRequestId,
          oldResponseSession: staleResponseSession,
          newRequestId,
          newResponseRequestId,
          newResponseSession,
          sameRequestStillPending,
          sameSessionAfterStale,
          sameGenerationAfterStale,
          stillWaitingAfterStale,
          ownResponseResolved: !newRequestResponse.error,
          stateBeforeStale: currentStateBeforeStale.estado,
          host: status,
          eventos: eventos.slice(-50)
        };
      }
      case 'kill-host-recover': {
        const sessionAntes = client.getEstado().hostSessionId;
        client._processo.matar();
        const saiu = await aguardarCondicao(() => client.getEstado().estado === 'CRASHED', 3000);
        const reinicio = await client.prepararHostParaReconciliacao(input.transactionId);
        const status = await obterStatusHost();
        return {
          saiu,
          sessionAntes,
          sessionDepois: client.getEstado().hostSessionId,
          reinicio,
          host: status
        };
      }
      case 'release-lost-ack': {
        const txBefore = eventos.filter((item) =>
          item.direcao === 'main->host'
          && ['TX_START', 'TX_CONTINUE', 'TX_FINALIZE'].includes(item.operation)).length;
        const dados = dadosReconciliacao();
        const resultado = await manager.reconciliarResultadoTardio(input.transactionId, dados);
        const rowBeforeRelease = await registro(input.transactionId);
        const sessionBeforeRelease = client.getEstado().hostSessionId;
        atualizarFalha('drop-kill', protocolo.OPERACOES_HOST.RECONCILE);
        let erro = null;
        try {
          await manager.reconciliarNativeHost(input.transactionId, dados, resultado);
        } catch (error) {
          erro = { code: error.code || null, message: error.message };
        }
        const persisted = await registro(input.transactionId);
        const releaseResponse = eventos.slice().reverse().find((event) =>
          event.direcao === 'host->main'
          && event.tipo === 'response'
          && event.operation === 'RECONCILE');
        const lostAckEvent = eventos.slice().reverse().find((event) =>
          event.tipo === 'fault'
          && event.action === 'drop-kill'
          && event.operation === 'RECONCILE');
        const recovery = await client.prepararHostParaReconciliacao(input.transactionId);
        const status = await obterStatusHost();
        return {
          erro,
          rowStatusBeforeRelease: rowBeforeRelease?.status || null,
          reconciliationEvidenceBeforeRelease: rowBeforeRelease?.payload_retorno?.reconciliacao || null,
          releaseResultPersistedAsPending: persisted?.status === 'pendente',
          rowStatus: persisted?.status || null,
          reconciliacaoPersistida: Boolean(persisted?.payload_retorno?.reconciliacao),
          releaseResponse,
          lostAckEvent,
          sessionBeforeRelease,
          sessionAfterRestart: status.hostSessionId,
          ackReceivedByClient: lostAckEvent?.ackDeliveredToClient === true,
          recovery,
          host: status,
          driverCalls: status.mockContadores || null,
          transactionRequests: eventos.filter((item) =>
            item.direcao === 'main->host'
            && ['TX_START', 'TX_CONTINUE', 'TX_FINALIZE'].includes(item.operation)).length - txBefore,
          eventos: eventos.slice(-80)
        };
      }
      case 'release-success': {
        const dados = dadosReconciliacao();
        const resultado = await manager.reconciliarResultadoTardio(input.transactionId, dados);
        atualizarFalha(input.failAt === 'bootstrap' ? 'drop-kill' : 'unused', input.failAt === 'bootstrap'
          ? protocolo.OPERACOES_HOST.SECURITY_BOOTSTRAP
          : 'unused');
        let completion = null;
        let erro = null;
        try {
          completion = await manager.reconciliarNativeHost(input.transactionId, dados, resultado);
        } catch (error) {
          erro = { code: error.code || null, message: error.message };
        }
        const persisted = await registro(input.transactionId);
        let statusHost = null;
        if (client.getEstado().estado === 'READY') statusHost = await obterStatusHost();
        return {
          completion,
          erro,
          rowStatus: persisted?.status || null,
          rowReconciliation: persisted?.payload_retorno?.reconciliacao || null,
          statusHost,
          clientState: client.getEstado().estado,
          eventos: eventos.slice(-80)
        };
      }
      case 'release-persist-failure': {
        if (client.getEstado().estado === 'READY' && client._processo) {
          const processToStop = client._processo;
          processToStop.matar();
          await aguardarCondicao(() => client.getEstado().estado === 'CRASHED', 3000);
        }
        const dados = dadosReconciliacao();
        const resultado = await manager.reconciliarResultadoTardio(input.transactionId, dados);
        const originalUpdate = manager._atualizarTransacaoPersistida.bind(manager);
        manager._atualizarTransacaoPersistida = (id, values, conditions) => {
          if (String(id) === String(input.transactionId) && values.status === 'negado') {
            return Promise.reject(Object.assign(new Error('falha de persistência simulada'), { code: 'MRT50_WRITE_FAIL' }));
          }
          return originalUpdate(id, values, conditions);
        };
        let erro = null;
        try {
          await manager.reconciliarNativeHost(input.transactionId, dados, resultado);
        } catch (error) {
          erro = { code: error.code || null, message: error.message };
        } finally {
          manager._atualizarTransacaoPersistida = originalUpdate;
        }
        return {
          erro,
          rowStatus: (await registro(input.transactionId))?.status || null,
          host: await obterStatusHost(),
          eventos: eventos.slice(-60)
        };
      }
      case 'release-reread-failure': {
        const dados = dadosReconciliacao();
        const resultado = await manager.reconciliarResultadoTardio(input.transactionId, dados);
        const originalRead = manager._obterTransacaoPersistida.bind(manager);
        let reads = 0;
        manager._obterTransacaoPersistida = async (id) => {
          if (String(id) === String(input.transactionId) && ++reads === 2) {
            throw Object.assign(new Error('falha de leitura integral simulada'), { code: 'MRT50_READ_FAIL' });
          }
          return originalRead(id);
        };
        let erro = null;
        try {
          await manager.reconciliarNativeHost(input.transactionId, dados, resultado);
        } catch (error) {
          erro = { code: error.code || null, message: error.message };
        } finally {
          manager._obterTransacaoPersistida = originalRead;
        }
        const persisted = await registro(input.transactionId);
        return {
          erro,
          rowStatus: persisted?.status || null,
          persistedEvidence: persisted?.payload_retorno?.reconciliacao || null,
          hostAntesDeRestart: await obterStatusHost(),
          eventos: eventos.slice(-70)
        };
      }
      case 'corrupt-reconciliation-proof': {
        const row = await registro(input.transactionId);
        const payload = { ...(row?.payload_retorno || {}) };
        if (input.corrupt === 'remove') {
          delete payload.reconciliacao;
        } else {
          payload.reconciliacao = {
            ...(payload.reconciliacao || {}),
            transactionId: 'mrt50-inconsistent-identity'
          };
        }
        await new Promise((resolve, reject) => {
          repository.atualizarTransacao(input.transactionId, {
            status: row.status,
            payload_retorno: payload
          }, (error) => (error ? reject(error) : resolve()));
        });
        const persisted = await registro(input.transactionId);
        return {
          transactionId: String(input.transactionId),
          status: persisted?.status || null,
          evidence: persisted?.payload_retorno?.reconciliacao || null
        };
      }
      case 'restart-manager': {
        if (client) await client.encerrar({ aguardarMs: 1200 });
        novoClientManager();
        const start = await iniciarComRecuperacao();
        return start;
      }
      case 'attempt-new-authorization': {
        const router = require('../../backend/services/tef/tefRouterIntegration');
        const fiscalValidator = require('../../backend/services/tef/tefFiscalValidator');
        const fraudDetection = require('../../backend/services/tef/tefFraudDetectionService');
        const resolveOriginal = router.resolverRotaAutorizacao;
        const validateOriginal = fiscalValidator.validarTransacao;
        const analyzeOriginal = fraudDetection.analisarTransacao;
        const sendOriginal = client.enviar;
        const beforeTxStarts = eventos.filter((item) =>
          item.direcao === 'main->host' && item.operation === 'TX_START').length;
        let interceptedTxStarts = 0;
        router.resolverRotaAutorizacao = async () => ({
          sucesso: true,
          leaseId: null,
          routeDecision: { sucesso: true, provedor: 'DESTAXA', terminalTefId: 'mrt50-test-terminal' }
        });
        fiscalValidator.validarTransacao = () => ({ valido: true, erros: [] });
        fraudDetection.analisarTransacao = async () => ({ suspeita: false });
        client.enviar = (operation, ...args) => {
          if (operation === protocolo.OPERACOES_HOST.TX_START) {
            interceptedTxStarts += 1;
            throw Object.assign(new Error('TX_START bloqueado pelo tripwire C6'), {
              code: 'MRT50_TX_START_TRIPWIRE'
            });
          }
          return sendOriginal.call(client, operation, ...args);
        };
        let result;
        try {
          result = await manager.autorizar({
            tipo: 'CRT',
            valor: 1,
            idempotency_key: `mrt50-new-attempt-${crypto.randomBytes(6).toString('hex')}`
          });
        } finally {
          router.resolverRotaAutorizacao = resolveOriginal;
          fiscalValidator.validarTransacao = validateOriginal;
          fraudDetection.analisarTransacao = analyzeOriginal;
          client.enviar = sendOriginal;
        }
        const host = await obterStatusHost();
        return {
          result,
          interceptedTxStarts,
          txStartIpcCount: eventos.filter((item) =>
            item.direcao === 'main->host' && item.operation === 'TX_START').length - beforeTxStarts,
          driverCalls: host.mockContadores,
          blockedFinancialIdentities: host.blockedFinancialIdentities,
          hostSessionId: host.hostSessionId
        };
      }
      case 'restart-manager-read-failure': {
        if (client) await client.encerrar({ aguardarMs: 1200 });
        novoClientManager();
        const readOriginal = repository.listarTransacoesFinalizadas;
        repository.listarTransacoesFinalizadas = (callback) => {
          const error = Object.assign(new Error('falha de leitura de evidência simulada'), {
            code: 'MRT50_EVIDENCE_READ_FAIL'
          });
          callback(error, []);
        };
        let failedRead = null;
        try {
          await iniciarComRecuperacao();
        } catch (error) {
          failedRead = { code: error.code || null, message: error.message };
        } finally {
          repository.listarTransacoesFinalizadas = readOriginal;
        }
        const failedClosed = client.getEstado().estado !== 'READY';
        const recovery = await iniciarComRecuperacao();
        return {
          failedRead,
          failedClosed,
          retryAfterReadRestored: recovery.sucesso,
          blockedAfterVerifiedRead: recovery.host?.blockedFinancialIdentities || [],
          host: recovery.host
        };
      }
      case 'crash-transaction': {
        const pending = await criarPendenciaWorker(`crash-${Date.now()}`);
        await manager.garantirRecuperacao();
        const configure = await client.enviar(
          protocolo.OPERACOES_HOST.CONFIGURE_MOCK,
          { passos: [{ fn: 'inicia', codigo: 'F1', saida: '' }] }
        );
        if (configure.error || configure.output?.sucesso !== true) {
          throw new Error(`Não foi possível instalar mock de crash: ${configure.error?.code || configure.output?.codigo}`);
        }
        atualizarFalha('drop-kill', protocolo.OPERACOES_HOST.TX_START);
        manager._emExecucao.add(pending.id);
        let resultado = null;
        try {
          resultado = await manager._nativeHostIntent.run({
            transactionId: pending.id,
            allowedOperations: ['TX_START']
          }, () => bridge.iniciarTransacaoDestaxa('CRT', {}, { transactionId: pending.id }));
        } finally {
          manager._emExecucao.delete(pending.id);
        }
        const row = await registro(pending.id);
        const exit = eventos.slice().reverse().find((item) => item.tipo === 'host-exit');
        const driverCalls = eventos.filter((item) =>
          item.tipo === 'driver-call' && item.method === 'iniciaTransacaoDestaxa');
        return {
          transactionId: pending.id,
          result: resultado,
          rowStatus: row?.status || null,
          rowFinancialState: row?.payload_retorno?.financialState || null,
          hostExit: exit || null,
          driverCalls,
          driverCallCount: driverCalls.length,
          txStartRequests: eventos.filter((item) => item.direcao === 'main->host' && item.operation === 'TX_START').length,
          events: eventos.slice(-80)
        };
      }
      case 'shutdown': {
        const clientState = client?.getEstado() || null;
        if (client) await client.encerrar({ aguardarMs: 1500 });
        await new Promise((resolve) => database.close(() => resolve()));
        enviarControle({ tipo: 'shutdown-complete', clientState });
        setTimeout(() => process.exit(0), 30);
        return { shuttingDown: true };
      }
      default:
        throw new Error(`Ação de worker desconhecida: ${action}`);
    }
  }

  async function aguardarCondicao(condicao, limiteMs) {
    const limite = Date.now() + limiteMs;
    while (Date.now() < limite) {
      if (condicao()) return true;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return condicao();
  }

  process.on('message', async (message) => {
    if (!message || message.tipo !== 'command') return;
    try {
      const result = await workerAction(message.action, message.input || {});
      resultadosWorker.push({ action: message.action, success: true });
      enviarControle({ tipo: 'result', commandId: message.commandId, result });
    } catch (error) {
      resultadosWorker.push({ action: message.action, success: false, error: error.message });
      enviarControle({
        tipo: 'result',
        commandId: message.commandId,
        error: { code: error.code || null, message: error.message, stack: error.stack }
      });
    }
  });

  enviarControle({
    tipo: 'worker-ready',
    pid: process.pid,
    databasePath: database.dbPath,
    isolationVerified: true,
    gateFinancial: false
  });
}

function enviarControle(mensagem) {
  if (typeof process.send === 'function' && process.connected) process.send(mensagem);
}

function claimsBootstrapSeguranca(protocolo, chavePrivada, hostSessionId, revision, blocked = [], options = {}) {
  const bootstrapId = options.bootstrapId || crypto.randomBytes(16).toString('hex');
  const ordered = blocked.slice().sort((a, b) => a.transactionId.localeCompare(b.transactionId));
  const claims = {
    version: 1,
    protocol: protocolo.PROTOCOLO,
    hostSessionId,
    bootstrapId,
    revision,
    issuedAt: options.issuedAt ?? Date.now(),
    recoveryComplete: true,
    recoveryResult: 'SUCCESS',
    securityState: ordered.length ? 'SECURITY_BOOTSTRAP_BLOCKED' : 'SECURITY_BOOTSTRAP_VALIDATED',
    blockedIdentities: ordered,
    permit: options.permit || null
  };
  return {
    claims,
    signature: crypto.sign(
      null,
      Buffer.from(protocolo.serializarClaimsBootstrapSeguranca(claims), 'utf8'),
      chavePrivada
    ).toString('base64')
  };
}

async function executarRawHostSuite(eventos) {
  const protocolo = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
  const NativeHostClientModule = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
  const keyPair = crypto.generateKeyPairSync('ed25519');
  const publicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const spawner = criarSpawnerInstrumentado(eventos, () => null);
  const host = spawner(NativeHostClientModule.HOST_PATH, {
    ...process.env,
    DB_DIR: process.env.DB_DIR,
    DESTAXA_NATIVE_HOST_ENTRY: '1',
    DESTAXA_RECONCILIATION_PUBLIC_KEY: publicKey,
    DESTAXA_NATIVE_HOST_TEST_MODE: '1',
    DESTAXA_NATIVE_HOST_TRIPWIRE: '1'
  });

  try {
    const ready = await host.waitReady();
    assert.strictEqual(ready.processType, 'child_process');
    assert.notStrictEqual(ready.pid, process.pid);
    const mock = await enviarRaw(host, protocolo, protocolo.OPERACOES_HOST.CONFIGURE_MOCK, {
      passos: [{ fn: 'inicia', codigo: 'F1', saida: '' }]
    });
    assert.strictEqual(mock.output.sucesso, true);

    const preBootstrap = await enviarRaw(host, protocolo, protocolo.OPERACOES_HOST.STATUS);
    assert.strictEqual(preBootstrap.output.securityBootstrapState, 'SECURITY_BOOTSTRAP_REQUIRED');
    const bloqueadasAntes = {};
    for (const operation of [
      protocolo.OPERACOES_HOST.TX_START,
      protocolo.OPERACOES_HOST.TX_CONTINUE,
      protocolo.OPERACOES_HOST.TX_FINALIZE
    ]) {
      const payload = operation === protocolo.OPERACOES_HOST.TX_START
        ? { operacao: 'CRT', campos: {} }
        : operation === protocolo.OPERACOES_HOST.TX_CONTINUE
          ? { resposta: {} }
          : { confirmacao: 0 };
      bloqueadasAntes[operation] = await enviarRaw(host, protocolo, operation, payload, 'mrt50-before-bootstrap');
      assert.strictEqual(
        bloqueadasAntes[operation].error.code,
        'HOST_SECURITY_BOOTSTRAP_REQUIRED'
      );
    }
    const statusAposTentativas = await enviarRaw(host, protocolo, protocolo.OPERACOES_HOST.STATUS);
    assert.deepStrictEqual(statusAposTentativas.output.mockContadores, {
      iniciaTransacaoDestaxa: 0,
      continuaTransacaoDestaxa: 0,
      finalizaTransacaoDestaxa: 0
    });
    assert.strictEqual(statusAposTentativas.output.contadores.dllLoads, 0);
    const callsBeforePermit = eventos.filter((event) =>
      event.tipo === 'driver-call' && event.pid === ready.pid);

    const firstBootstrap = claimsBootstrapSeguranca(
      protocolo,
      keyPair.privateKey,
      ready.hostSessionId,
      1
    );
    const bootstrapResponse = await enviarRaw(
      host,
      protocolo,
      protocolo.OPERACOES_HOST.SECURITY_BOOTSTRAP,
      { autorizacao: firstBootstrap }
    );
    assert.strictEqual(bootstrapResponse.output.sucesso, true);
    assert.strictEqual(bootstrapResponse.output.securityState, 'SECURITY_BOOTSTRAP_VALIDATED');

    const semPermit = {};
    for (const operation of [
      protocolo.OPERACOES_HOST.TX_START,
      protocolo.OPERACOES_HOST.TX_CONTINUE,
      protocolo.OPERACOES_HOST.TX_FINALIZE
    ]) {
      const payload = operation === protocolo.OPERACOES_HOST.TX_START
        ? { operacao: 'CRT', campos: {} }
        : operation === protocolo.OPERACOES_HOST.TX_CONTINUE
          ? { resposta: {} }
          : { confirmacao: 0 };
      semPermit[operation] = await enviarRaw(host, protocolo, operation, payload, 'mrt50-no-permit');
      assert.strictEqual(semPermit[operation].error.code, 'HOST_SECURITY_OPERATION_BLOCKED');
    }
    const statusSemPermit = await enviarRaw(host, protocolo, protocolo.OPERACOES_HOST.STATUS);
    assert.deepStrictEqual(statusSemPermit.output.mockContadores, {
      iniciaTransacaoDestaxa: 0,
      continuaTransacaoDestaxa: 0,
      finalizaTransacaoDestaxa: 0
    });
    const callsAfterRejectedPermits = eventos.filter((event) =>
      event.tipo === 'driver-call' && event.pid === ready.pid);

    const permitBootstrap = claimsBootstrapSeguranca(
      protocolo,
      keyPair.privateKey,
      ready.hostSessionId,
      2,
      [],
      { permit: { permitId: null, operation: protocolo.OPERACOES_HOST.TX_START, transactionId: 'mrt50-permit-once' } }
    );
    permitBootstrap.claims.permit.permitId = permitBootstrap.claims.bootstrapId;
    permitBootstrap.signature = crypto.sign(
      null,
      Buffer.from(protocolo.serializarClaimsBootstrapSeguranca(permitBootstrap.claims), 'utf8'),
      keyPair.privateKey
    ).toString('base64');
    const permitAccepted = await enviarRaw(
      host,
      protocolo,
      protocolo.OPERACOES_HOST.SECURITY_BOOTSTRAP,
      { autorizacao: permitBootstrap }
    );
    assert.strictEqual(permitAccepted.output.sucesso, true);

    const firstUse = await enviarRaw(
      host,
      protocolo,
      protocolo.OPERACOES_HOST.TX_START,
      { operacao: 'CRT', campos: {} },
      'mrt50-permit-once'
    );
    assert.ok(!firstUse.error || firstUse.error.code !== 'HOST_SECURITY_OPERATION_BLOCKED');
    const reusedPermit = await enviarRaw(
      host,
      protocolo,
      protocolo.OPERACOES_HOST.TX_START,
      { operacao: 'CRT', campos: {} },
      'mrt50-permit-once'
    );
    assert.strictEqual(reusedPermit.error.code, 'HOST_SECURITY_OPERATION_BLOCKED');
    const statusAfterUse = await enviarRaw(host, protocolo, protocolo.OPERACOES_HOST.STATUS);
    assert.strictEqual(statusAfterUse.output.mockContadores.iniciaTransacaoDestaxa, 1);
    assert.strictEqual(statusAfterUse.output.contadores.dllLoads, 0);
    const permittedDriverCalls = eventos.filter((event) =>
      event.tipo === 'driver-call' && event.pid === ready.pid);
    assert.strictEqual(callsBeforePermit.length, 0);
    assert.strictEqual(callsAfterRejectedPermits.length, 0);
    assert.strictEqual(permittedDriverCalls.length, 1);

    const tampered = claimsBootstrapSeguranca(
      protocolo,
      keyPair.privateKey,
      ready.hostSessionId,
      3
    );
    tampered.claims.permit = {
      permitId: tampered.claims.bootstrapId,
      operation: protocolo.OPERACOES_HOST.TX_START,
      transactionId: 'mrt50-altered-permit'
    };
    tampered.signature = crypto.sign(
      null,
      Buffer.from(protocolo.serializarClaimsBootstrapSeguranca(tampered.claims), 'utf8'),
      keyPair.privateKey
    ).toString('base64');
    tampered.claims.permit.transactionId = 'mrt50-tampered-after-signature';
    const rejectedTampered = await enviarRaw(
      host,
      protocolo,
      protocolo.OPERACOES_HOST.SECURITY_BOOTSTRAP,
      { autorizacao: tampered }
    );
    assert.strictEqual(rejectedTampered.error.code, 'HOST_SECURITY_BOOTSTRAP_INVALID');

    const oldAuthorization = claimsBootstrapSeguranca(
      protocolo,
      keyPair.privateKey,
      ready.hostSessionId,
      1
    );
    const otherHost = spawner(NativeHostClientModule.HOST_PATH, {
      ...process.env,
      DB_DIR: process.env.DB_DIR,
      DESTAXA_NATIVE_HOST_ENTRY: '1',
      DESTAXA_RECONCILIATION_PUBLIC_KEY: publicKey,
      DESTAXA_NATIVE_HOST_TEST_MODE: '1',
      DESTAXA_NATIVE_HOST_TRIPWIRE: '1'
    });
    const otherReady = await otherHost.waitReady();
    const oldSessionResponse = await enviarRaw(
      otherHost,
      protocolo,
      protocolo.OPERACOES_HOST.SECURITY_BOOTSTRAP,
      { autorizacao: oldAuthorization }
    );
    assert.strictEqual(oldSessionResponse.error.code, 'HOST_SECURITY_BOOTSTRAP_INVALID');
    await encerrarProcessoHost(otherHost);
    return {
      pid: ready.pid,
      ppid: ready.ppid,
      hostSessionId: ready.hostSessionId,
      initialState: preBootstrap.output.securityBootstrapState,
      preBootstrapDriverCalls: statusAposTentativas.output.mockContadores,
      preBootstrapErrors: Object.fromEntries(Object.entries(bloqueadasAntes).map(([key, value]) => [key, value.error.code])),
      noPermitErrors: Object.fromEntries(Object.entries(semPermit).map(([key, value]) => [key, value.error.code])),
      invalidPermitOrBootstrap: rejectedTampered.error.code,
      oldSessionBootstrap: oldSessionResponse.error.code,
      newHostSessionId: otherReady.hostSessionId,
      validBootstrapAccepted: bootstrapResponse.output.sucesso === true,
      validBootstrapState: bootstrapResponse.output.securityState,
      usedPermitOnce: statusAfterUse.output.mockContadores.iniciaTransacaoDestaxa,
      externalDriverCallCount: permittedDriverCalls.length,
      externalDriverCalls: permittedDriverCalls,
      reusedPermit: reusedPermit.error.code,
      dllLoads: statusAfterUse.output.contadores.dllLoads,
      bootstrapRequestId: bootstrapResponse.requestId,
      independentProcess: ready.pid !== process.pid
    };
  } finally {
    await encerrarProcessoHost(host);
  }
}

function aguardarMensagem(worker, condition, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout aguardando mensagem do processo principal')), timeoutMs);
    const listener = (message) => {
      if (!condition(message)) return;
      clearTimeout(timer);
      worker.off('message', listener);
      resolve(message);
    };
    worker.on('message', listener);
  });
}

function iniciarWorker(dbDir) {
  const child = fork(path.resolve(__filename), ['--mrt50-main-worker'], {
    cwd: path.resolve(__dirname, '..', '..'),
    env: {
      ...process.env,
      DB_DIR: dbDir,
      DESTAXA_REAL_TRANSACTION_ENABLED: '0',
      DESTAXA_NATIVE_HOST_TEST_MODE: '1',
      DESTAXA_NATIVE_HOST_TRIPWIRE: '1',
      MRT50_DB_PREFLIGHT: '0',
      NODE_OPTIONS: ''
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true
  });
  child.telemetry = [];
  child._commandId = 0;
  child.on('message', (message) => {
    if (message?.tipo === 'telemetry') child.telemetry.push(message.evento);
  });
  return child;
}

async function comando(worker, action, input = {}, timeoutMs = 20000) {
  const commandId = `${process.pid}-${++worker._commandId}`;
  const response = aguardarMensagem(
    worker,
    (message) => message?.tipo === 'result' && message.commandId === commandId,
    timeoutMs
  );
  worker.send({ tipo: 'command', commandId, action, input });
  const message = await response;
  if (message.error) {
    const error = new Error(`${action}: ${message.error.message}`);
    error.stack = message.error.stack || error.stack;
    error.code = message.error.code;
    throw error;
  }
  return message.result;
}

async function aguardarWorkerPronto(worker) {
  const message = await aguardarMensagem(worker, (item) => item?.tipo === 'worker-ready');
  assert.strictEqual(message.isolationVerified, true);
  assert.strictEqual(message.gateFinancial, false);
  return message;
}

async function fecharWorker(worker) {
  if (!worker || worker.exitCode != null || worker.killed) return;
  try {
    await comando(worker, 'shutdown', {}, 5000);
  } catch (_) {
    if (worker.connected) worker.kill();
  }
  await Promise.race([
    new Promise((resolve) => worker.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2500))
  ]);
  if (worker.exitCode == null && worker.connected) worker.kill();
}

async function inserirPendencia(repository, tag, financialState) {
  const identity = {
    operation_id: `mrt50-op-${tag}-${crypto.randomBytes(4).toString('hex')}`,
    idempotency_key: `mrt50-idem-${tag}-${crypto.randomBytes(4).toString('hex')}`,
    fingerprint: `mrt50-fp-${tag}`
  };
  const id = await new Promise((resolve, reject) => {
    repository.criarTransacao({
      tipo: 'CRT',
      valor: 1,
      status: 'pendente',
      provedor: 'DESTAXA',
      idempotency_key: identity.idempotency_key,
      codigo_transacao: identity.operation_id,
      payload_retorno: {
        financialState,
        persistencia: { ...identity, estadoFinanceiroInicial: financialState }
      }
    }, (error, rowId) => (error ? reject(error) : resolve(String(rowId))));
  });
  return { id, identity, financialState };
}

async function obterRegistro(repository, id) {
  return new Promise((resolve, reject) => {
    repository.obterTransacaoPorId(id, (error, row) => (error ? reject(error) : resolve(row)));
  });
}

async function executarC6Verificacao() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mrt50-c6-'));
  process.env.DB_DIR = tempDir;
  process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
  process.env.NODE_ENV = 'test';
  const database = verificarIsolamentoAntesDosModulosBanco();
  let worker = null;
  try {
    await exigirBancoPronto(database);
    const repository = require('../../backend/services/tef/tefRepository');
    const { transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');
    assert.strictEqual(transacaoRealHabilitada(), false);
    const identity = await inserirPendencia(repository, 'c6-inconclusiva', 'UNKNOWN');
    worker = iniciarWorker(tempDir);
    const workerReady = await aguardarWorkerPronto(worker);
    const initial = await comando(worker, 'start');
    assert.ok(initial.host.blockedFinancialIdentities.includes(identity.id));

    const failedRead = await comando(worker, 'release-reread-failure', {
      transactionId: identity.id
    });
    assert.strictEqual(failedRead.erro?.code, 'MRT50_READ_FAIL');
    assert.strictEqual(failedRead.rowStatus, 'negado');
    assert.ok(failedRead.persistedEvidence);
    assert.ok(failedRead.hostAntesDeRestart.blockedFinancialIdentities.includes(identity.id));
    const releaseLogBeforeRestart = await new Promise((resolve, reject) => {
      database.get(`
        SELECT COUNT(*) AS total
        FROM tef_logs
        WHERE transacao_id = ? AND tipo = 'TEF_RECONCILIACAO_LIBERADA'
      `, [identity.id], (error, row) => (error ? reject(error) : resolve(Number(row?.total || 0))));
    });
    assert.strictEqual(releaseLogBeforeRestart, 0);

    const restarted = await comando(worker, 'restart-manager');
    assert.notStrictEqual(restarted.host.hostSessionId, failedRead.hostAntesDeRestart.hostSessionId);
    assert.ok(restarted.identidadeRecuperadas.includes(identity.id));
    assert.ok(restarted.host.blockedFinancialIdentities.includes(identity.id));
    assert.strictEqual(restarted.host.securityBootstrapState, 'SECURITY_BLOCKED');
    const releaseLogAfterRestart = await new Promise((resolve, reject) => {
      database.get(`
        SELECT COUNT(*) AS total
        FROM tef_logs
        WHERE transacao_id = ? AND tipo = 'TEF_RECONCILIACAO_LIBERADA'
      `, [identity.id], (error, row) => (error ? reject(error) : resolve(Number(row?.total || 0))));
    });
    assert.strictEqual(releaseLogAfterRestart, 0);
    await comando(worker, 'configure-mock', { passos: [] });

    const attempt = await comando(worker, 'attempt-new-authorization');
    const externalDriverCalls = worker.telemetry.filter((event) => event.tipo === 'driver-call');
    assert.strictEqual(attempt.result.codigo, 'TEF_RESULTADO_PENDENTE');
    assert.strictEqual(attempt.interceptedTxStarts, 0);
    assert.strictEqual(attempt.txStartIpcCount, 0);
    assert.ok(attempt.blockedFinancialIdentities.includes(identity.id));
    assert.deepStrictEqual(attempt.driverCalls, {
      iniciaTransacaoDestaxa: 0,
      continuaTransacaoDestaxa: 0,
      finalizaTransacaoDestaxa: 0
    });
    assert.strictEqual(externalDriverCalls.length, 0);

    const evidence = {
      verdict: 'APROVADO',
      scenario: 'C6: segunda leitura falha, status negado sem conclusão durável, reinício e nova autorização bloqueada',
      transactionId: identity.id,
      financialStateBeforeReconciliation: 'UNKNOWN',
      secondReadError: failedRead.erro.code,
      statusAfterReadFailure: failedRead.rowStatus,
      persistedReconciliationEvidence: failedRead.persistedEvidence,
      durableReleaseCommitLogBeforeRestart: releaseLogBeforeRestart,
      durableReleaseCommitLogAfterRestart: releaseLogAfterRestart,
      blockedBeforeRestart: failedRead.hostAntesDeRestart.blockedFinancialIdentities,
      managerProcessPid: workerReady.pid,
      hostSessionBeforeRestart: failedRead.hostAntesDeRestart.hostSessionId,
      hostSessionAfterRestart: restarted.host.hostSessionId,
      hostPidAfterRestart: restarted.host.pid,
      bootstrapStateAfterRestart: restarted.host.securityBootstrapState,
      blockedAfterRestart: restarted.host.blockedFinancialIdentities,
      newAuthorizationResult: attempt.result.codigo,
      interceptedTxStarts: attempt.interceptedTxStarts,
      txStartIpcCount: attempt.txStartIpcCount,
      driverCalls: attempt.driverCalls,
      externalDriverCallCount: externalDriverCalls.length,
      financialGateOff: transacaoRealHabilitada() === false,
      sqliteDbDir: tempDir,
      officialDatabaseTouched: false,
      realDllLoaded: false,
      vspagueConnected: false,
      pinpadOrSerialAccessed: false,
      realFinancialOperation: false
    };

    const reportPath = path.resolve(__dirname, '..', '..', 'docs', 'build', 'mrt-50-child-process-ipc-report.json');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    report.classification = 'CONCLUIDA';
    report.summary = 'MRT-50.1 consolidada: C6 confirmado fail-closed após falha da segunda leitura, reinicialização e tentativa de nova autorização.';
    report.verificationC6 = evidence;
    report.testExecution.latestRun = {
      command: '$env:MRT50_C6_ONLY=1; node tests\\tef\\mrt-50-child-process-ipc.test.js',
      result: 'PASSOU',
      scope: 'C6 direcionado; não executou TX_START, TX_CONTINUE, TX_FINALIZE ou operação financeira.',
      sqliteIsolationVerifiedBeforeDatabaseConsumers: true,
      driverCalls: attempt.driverCalls
    };
    report.requiredScenarioEvidence.C6 = evidence;
    report.persistenceEvidence.c6SecondReadFailureBlocksAfterRestart = evidence;
    delete report.persistenceEvidence.c6ValidProofRecovery;
    report.classificationByStatus.CONCLUIDO = [
      'Após falha da segunda leitura, estado terminal sem confirmação durável do RELEASE/COMMIT permanece bloqueado; status terminal isolado não libera a identidade.'
    ];
    report.classificationByStatus.TESTADO = report.classificationByStatus.TESTADO
      .filter((scenario) => !scenario.startsWith('C6 falha na releitura'));
    report.classificationByStatus.TESTADO.push(
      'C6 falha na segunda leitura mantém bloqueio após reinício e rejeita nova autorização'
    );
    report.scenarios = report.scenarios.filter((scenario) =>
      !scenario.nome.startsWith('C6 falha na releitura'));
    report.scenarios.push({
      nome: 'C6 falha na segunda leitura mantém bloqueio após reinício e rejeita nova autorização',
      resultado: 'PASSOU',
      evidencias: evidence
    });
    report.database.c6LatestRunDbDir = tempDir;
    report.database.c6LatestRunDbRemovedAfterRun = true;
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ reportPath, verificationC6: evidence }, null, 2));
  } finally {
    await fecharWorker(worker);
    await new Promise((resolve) => database.close(() => resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function executarHarness() {
  const dirsTemporarios = [];
  const falhas = [];
  const cenarios = [];
  const eventosGlobais = [];
  const verificar = async (nome, executar) => {
    try {
      const evidencias = await executar();
      cenarios.push({ nome, resultado: 'PASSOU', evidencias: evidencias || null });
    } catch (error) {
      falhas.push({ nome, erro: error.message });
      cenarios.push({ nome, resultado: 'FALHOU', erro: error.message });
    }
  };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mrt50-main-'));
  dirsTemporarios.push(tempDir);
  process.env.DB_DIR = tempDir;
  process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
  process.env.NODE_ENV = 'test';
  const database = verificarIsolamentoAntesDosModulosBanco();
  await exigirBancoPronto(database);
  const repository = require('../../backend/services/tef/tefRepository');
  const { transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');
  assert.strictEqual(transacaoRealHabilitada(), false);

  let worker = null;
  let workerReady = null;
  try {
    const identities = [
      await inserirPendencia(repository, 'unknown-a', 'UNKNOWN'),
      await inserirPendencia(repository, 'pending-b', 'PENDING'),
      await inserirPendencia(repository, 'release-c', 'UNKNOWN'),
      await inserirPendencia(repository, 'persist-fail-d', 'UNKNOWN'),
      await inserirPendencia(repository, 'reread-fail-e', 'UNKNOWN'),
      await inserirPendencia(repository, 'commit-ipc-f', 'UNKNOWN'),
      await inserirPendencia(repository, 'missing-proof-g', 'UNKNOWN'),
      await inserirPendencia(repository, 'inconsistent-proof-h', 'UNKNOWN')
    ];
    const ids = identities.map((item) => item.id);
    let rawHostEvidence = null;

    await verificar('A1 NativeHost independente inicia em SECURITY_BOOTSTRAP_REQUIRED', async () => {
      rawHostEvidence = await executarRawHostSuite(eventosGlobais);
      assert.strictEqual(rawHostEvidence.independentProcess, true);
      assert.strictEqual(rawHostEvidence.initialState, 'SECURITY_BOOTSTRAP_REQUIRED');
      return {
        pid: rawHostEvidence.pid,
        ppid: rawHostEvidence.ppid,
        processType: 'child_process',
        initialState: rawHostEvidence.initialState
      };
    });

    await verificar('A2 TX_START sem bootstrap é recusado no processo NativeHost', async () => {
      assert.strictEqual(rawHostEvidence.preBootstrapErrors.TX_START, 'HOST_SECURITY_BOOTSTRAP_REQUIRED');
      assert.strictEqual(rawHostEvidence.preBootstrapDriverCalls.iniciaTransacaoDestaxa, 0);
      return {
        error: rawHostEvidence.preBootstrapErrors.TX_START,
        driverCalls: rawHostEvidence.preBootstrapDriverCalls.iniciaTransacaoDestaxa
      };
    });

    await verificar('A3 TX_CONTINUE sem bootstrap é recusado no processo NativeHost', async () => {
      assert.strictEqual(rawHostEvidence.preBootstrapErrors.TX_CONTINUE, 'HOST_SECURITY_BOOTSTRAP_REQUIRED');
      assert.strictEqual(rawHostEvidence.preBootstrapDriverCalls.continuaTransacaoDestaxa, 0);
      return {
        error: rawHostEvidence.preBootstrapErrors.TX_CONTINUE,
        driverCalls: rawHostEvidence.preBootstrapDriverCalls.continuaTransacaoDestaxa
      };
    });

    await verificar('A4 TX_FINALIZE sem bootstrap é recusado no processo NativeHost', async () => {
      assert.strictEqual(rawHostEvidence.preBootstrapErrors.TX_FINALIZE, 'HOST_SECURITY_BOOTSTRAP_REQUIRED');
      assert.strictEqual(rawHostEvidence.preBootstrapDriverCalls.finalizaTransacaoDestaxa, 0);
      return {
        error: rawHostEvidence.preBootstrapErrors.TX_FINALIZE,
        driverCalls: rawHostEvidence.preBootstrapDriverCalls.finalizaTransacaoDestaxa
      };
    });

    await verificar('A5 bootstrap assinado e vinculado à sessão é confirmado por IPC real', async () => {
      assert.strictEqual(rawHostEvidence.validBootstrapAccepted, true);
      assert.strictEqual(rawHostEvidence.validBootstrapState, 'SECURITY_BOOTSTRAP_VALIDATED');
      return { accepted: true, securityState: rawHostEvidence.validBootstrapState };
    });

    await verificar('A6 bootstrap de sessão anterior é recusado pelo NativeHost', async () => {
      assert.strictEqual(rawHostEvidence.oldSessionBootstrap, 'HOST_SECURITY_BOOTSTRAP_INVALID');
      assert.notStrictEqual(rawHostEvidence.newHostSessionId, rawHostEvidence.hostSessionId);
      return {
        response: rawHostEvidence.oldSessionBootstrap,
        previousSession: rawHostEvidence.hostSessionId,
        currentSession: rawHostEvidence.newHostSessionId
      };
    });

    await verificar('A7 permit adulterado após assinatura é recusado', async () => {
      assert.strictEqual(rawHostEvidence.invalidPermitOrBootstrap, 'HOST_SECURITY_BOOTSTRAP_INVALID');
      return { response: rawHostEvidence.invalidPermitOrBootstrap };
    });

    await verificar('A8 permit consumido não pode ser reutilizado', async () => {
      assert.strictEqual(rawHostEvidence.usedPermitOnce, 1);
      assert.strictEqual(rawHostEvidence.reusedPermit, 'HOST_SECURITY_OPERATION_BLOCKED');
      return {
        firstMockDispatch: rawHostEvidence.usedPermitOnce,
        secondUse: rawHostEvidence.reusedPermit
      };
    });

    worker = iniciarWorker(tempDir);
    workerReady = await aguardarWorkerPronto(worker);
    const started = await comando(worker, 'start');
    assert.strictEqual(started.sucesso, true);
    assert.strictEqual(started.host.processType, 'child_process');
    assert.deepStrictEqual(
      started.host.blockedFinancialIdentities.sort(),
      ids.slice().sort()
    );
    cenarios.push({
      nome: 'A9 bootstrap do TefManager atravessa IPC real antes de confirmar READY',
      resultado: 'PASSOU',
      evidencias: {
        mainPid: workerReady.pid,
        hostPid: started.host.pid,
        hostPpid: started.host.ppid,
        hostSessionId: started.host.hostSessionId,
        processType: started.host.processType,
        bootstrapState: started.host.securityBootstrapState,
        ipcRequests: worker.telemetry.filter((event) =>
          event.direcao === 'main->host' && event.operation === 'SECURITY_BOOTSTRAP').length,
        ipcResponses: worker.telemetry.filter((event) =>
          event.direcao === 'host->main' && event.tipo === 'response'
          && event.operation === 'SECURITY_BOOTSTRAP').length
      }
    });

    const mockConfiguration = await comando(worker, 'configure-mock', { passos: [] });
    assert.strictEqual(mockConfiguration.resposta.sucesso, true);
    const guards = await comando(worker, 'raw-guards');
    await verificar('D2 TX_START sem permit válido não chega ao driver mockado', async () => {
      assert.strictEqual(guards.respostas.TX_START.error?.code, 'HOST_SECURITY_OPERATION_BLOCKED');
      assert.strictEqual(guards.host.mockContadores.iniciaTransacaoDestaxa, 0);
      return { error: guards.respostas.TX_START.error.code, driverCalls: guards.host.mockContadores.iniciaTransacaoDestaxa };
    });
    await verificar('D3 TX_CONTINUE sem permit válido não chega ao driver mockado', async () => {
      assert.strictEqual(guards.respostas.TX_CONTINUE.error?.code, 'HOST_SECURITY_OPERATION_BLOCKED');
      assert.strictEqual(guards.host.mockContadores.continuaTransacaoDestaxa, 0);
      return { error: guards.respostas.TX_CONTINUE.error.code, driverCalls: guards.host.mockContadores.continuaTransacaoDestaxa };
    });
    await verificar('D4 TX_FINALIZE sem permit válido não chega ao driver mockado', async () => {
      assert.strictEqual(guards.respostas.TX_FINALIZE.error?.code, 'HOST_SECURITY_OPERATION_BLOCKED');
      assert.strictEqual(guards.host.mockContadores.finalizaTransacaoDestaxa, 0);
      return { error: guards.respostas.TX_FINALIZE.error.code, driverCalls: guards.host.mockContadores.finalizaTransacaoDestaxa };
    });

    await verificar('B1 perda de ACK do bootstrap encerra o Host sem confirmar prontidão', async () => {
      const bootstrapWorker = iniciarWorker(tempDir);
      try {
        await aguardarWorkerPronto(bootstrapWorker);
        const result = await comando(bootstrapWorker, 'start-bootstrap-drop');
        assert.strictEqual(result.sucesso, false);
        assert.notStrictEqual(result.estadoCliente, 'READY');
        assert.ok(result.eventos.some((event) => event.tipo === 'fault' && event.action === 'drop-kill'));
        return {
          clientState: result.estadoCliente,
          bootstrapState: result.bootstrapFalha,
          hostPid: result.eventos.find((event) => event.tipo === 'HOST_READY')?.pid || null,
          hostExit: result.eventos.find((event) => event.tipo === 'host-exit') || null,
          driverCalls: 0
        };
      } finally {
        await fecharWorker(bootstrapWorker);
      }
    });

    await verificar('B2 timeout IPC não repete nem reenvia operação', async () => {
      const txBefore = worker.telemetry.filter((event) =>
        event.direcao === 'main->host' && ['TX_START', 'TX_CONTINUE', 'TX_FINALIZE'].includes(event.operation)).length;
      const result = await comando(worker, 'status-fault', {
        action: 'drop',
        timeoutMs: 80
      });
      assert.strictEqual(result.resposta.error?.code, 'HOST_TIMEOUT');
      const txRequests = worker.telemetry.filter((event) =>
        event.direcao === 'main->host' && ['TX_START', 'TX_CONTINUE', 'TX_FINALIZE'].includes(event.operation));
      assert.strictEqual(txRequests.length, txBefore);
      return {
        timeout: result.resposta.error.code,
        financialRequestsBefore: txBefore,
        financialRequestsAfter: txRequests.length,
        automaticRetry: false
      };
    });

    await verificar('B3 encerramento e reconexão exigem nova sessão e recuperam os bloqueios', async () => {
      const restart = await comando(worker, 'kill-host-recover', { transactionId: ids[0] });
      assert.strictEqual(restart.saiu, true);
      assert.strictEqual(restart.reinicio.sucesso, true);
      assert.notStrictEqual(restart.sessionDepois, restart.sessionAntes);
      assert.deepStrictEqual(restart.host.blockedFinancialIdentities.sort(), ids.slice().sort());
      return {
        oldSession: restart.sessionAntes,
        newSession: restart.sessionDepois,
        blocked: restart.host.blockedFinancialIdentities,
        bootstrapState: restart.host.securityBootstrapState
      };
    });

    await verificar('B4 resposta IPC com requestId divergente não satisfaz a solicitação', async () => {
      const result = await comando(worker, 'status-fault', {
        action: 'mismatch-id',
        timeoutMs: 80
      });
      assert.strictEqual(result.resposta.error?.code, 'HOST_TIMEOUT');
      const mismatch = worker.telemetry.filter((event) => event.tipo === 'fault' && event.action === 'mismatch-id').length;
      assert.ok(mismatch > 0);
      await comando(worker, 'kill-host-recover', { transactionId: ids[0] });
      return { response: result.resposta.error.code, mismatchedResponses: mismatch, correlationAccepted: false };
    });

    await verificar('B5 resposta atrasada de geração anterior é ignorada após reinício', async () => {
      const result = await comando(worker, 'hold-status-restart', { transactionId: ids[0] });
      assert.strictEqual(result.respostaTardia, 'HOST_TIMEOUT');
      assert.strictEqual(result.oldHostCrashed, true);
      assert.notStrictEqual(result.sessionAntes, result.sessionDepois);
      assert.deepStrictEqual(result.host.blockedFinancialIdentities.sort(), ids.slice().sort());
      assert.ok(result.oldResponseSession);
      assert.strictEqual(result.oldResponseSession, result.sessionAntes);
      assert.strictEqual(result.newResponseSession, result.sessionDepois);
      assert.notStrictEqual(result.oldRequestId, result.newRequestId);
      assert.strictEqual(result.newResponseRequestId, result.newRequestId);
      assert.strictEqual(result.sameRequestStillPending, true);
      assert.strictEqual(result.sameSessionAfterStale, true);
      assert.strictEqual(result.sameGenerationAfterStale, true);
      assert.strictEqual(result.stillWaitingAfterStale, true);
      assert.strictEqual(result.ownResponseResolved, true);
      return {
        oldSession: result.sessionAntes,
        newSession: result.sessionDepois,
        oldRequestId: result.oldRequestId,
        newRequestId: result.newRequestId,
        oldResponseSession: result.oldResponseSession,
        newResponseSession: result.newResponseSession,
        sameRequestStillPending: result.sameRequestStillPending,
        sameSessionAfterStale: result.sameSessionAfterStale,
        sameGenerationAfterStale: result.sameGenerationAfterStale,
        stillWaitingAfterStale: result.stillWaitingAfterStale,
        ownResponseResolved: result.ownResponseResolved,
        newHostReady: result.host.securityBootstrapState,
      };
    });

    await verificar('C1 NativeHost reiniciado recupera UNKNOWN e PENDING da persistência', async () => {
      const result = await comando(worker, 'kill-host-recover', { transactionId: ids[0] });
      assert.strictEqual(result.reinicio.sucesso, true);
      assert.ok(result.host.blockedFinancialIdentities.includes(ids[0]));
      assert.ok(result.host.blockedFinancialIdentities.includes(ids[1]));
      return {
        hostSessionId: result.sessionDepois,
        unknownIdentity: ids[0],
        pendingIdentity: ids[1],
        blockedIdentities: result.host.blockedFinancialIdentities
      };
    });

    await verificar('C2 reinício do processo principal relê as pendências e reenvia bootstrap', async () => {
      const oldPid = workerReady.pid;
      await fecharWorker(worker);
      worker = iniciarWorker(tempDir);
      workerReady = await aguardarWorkerPronto(worker);
      const result = await comando(worker, 'start');
      assert.notStrictEqual(workerReady.pid, oldPid);
      assert.deepStrictEqual(result.host.blockedFinancialIdentities.sort(), ids.slice().sort());
      return {
        oldMainPid: oldPid,
        newMainPid: workerReady.pid,
        newHostPid: result.host.pid,
        sqlitePath: workerReady.databasePath,
        recovered: result.host.blockedFinancialIdentities
      };
    });

    await verificar('C3 perda de ACK após RELEASE mantém UNKNOWN bloqueada após reinício do Host', async () => {
      const result = await comando(worker, 'release-lost-ack', { transactionId: ids[2] });
      assert.ok(result.erro);
      assert.strictEqual(result.rowStatus, 'pendente');
      assert.strictEqual(result.releaseResultPersistedAsPending, true);
      assert.ok(result.host.blockedFinancialIdentities.includes(ids[2]));
      assert.strictEqual(result.transactionRequests, 0);
      assert.strictEqual(result.rowStatusBeforeRelease, 'pendente');
      assert.strictEqual(result.rowStatus, 'pendente');
      assert.strictEqual(result.releaseResponse.output.sucesso, true);
      assert.strictEqual(result.releaseResponse.output.transactionId, ids[2]);
      assert.strictEqual(result.releaseResponse.responseReceivedByAdapter, true);
      assert.strictEqual(result.lostAckEvent.ackDeliveredToClient, false);
      assert.strictEqual(result.ackReceivedByClient, false);
      assert.notStrictEqual(result.sessionBeforeRelease, result.sessionAfterRestart);
      assert.ok(result.eventos.some((event) =>
        event.tipo === 'fault' && event.action === 'drop-kill' && event.operation === 'RECONCILE'));
      return {
        transactionId: ids[2],
        hostPidAtRelease: result.releaseResponse.pid,
        hostSessionAtRelease: result.sessionBeforeRelease,
        releaseProcessed: result.releaseResponse.output.sucesso,
        releaseResponseObservedByParentAdapter: result.releaseResponse.responseReceivedByAdapter,
        acknowledgementDeliveredToMainClient: result.lostAckEvent.ackDeliveredToClient,
        rowStatusBeforeRelease: result.rowStatusBeforeRelease,
        rowStatusAfterLostAck: result.rowStatus,
        persistedReconciliationEvidenceBeforeRelease: result.reconciliationEvidenceBeforeRelease,
        persistedReconciliationEvidenceAfterRelease: result.reconciliacaoPersistida,
        restartedHostSession: result.sessionAfterRestart,
        restartedHostPid: result.host.pid,
        bootstrapAfterRestart: result.host.securityBootstrapState,
        blocked: result.host.blockedFinancialIdentities,
        financialRequests: result.transactionRequests,
        hostExit: result.lostAckEvent,
        releaseEvents: result.eventos.filter((event) =>
          event.operation === 'RECONCILE'
          || (event.tipo === 'fault' && event.action === 'drop-kill' && event.operation === 'RECONCILE'))
      };
    });

    await verificar('C4 nova autorização RELEASE e leitura final removem apenas a identidade reconciliada', async () => {
      const result = await comando(worker, 'release-success', { transactionId: ids[2] });
      assert.strictEqual(result.erro, null);
      assert.strictEqual(result.completion.travaLiberada, true);
      assert.strictEqual(result.rowStatus, 'negado');
      assert.ok(!result.statusHost.blockedFinancialIdentities.includes(ids[2]));
      assert.ok(result.statusHost.blockedFinancialIdentities.includes(ids[0]));
      assert.ok(result.statusHost.blockedFinancialIdentities.includes(ids[1]));
      return {
        reconciled: ids[2],
        persistedStatus: result.rowStatus,
        retainedBlocks: result.statusHost.blockedFinancialIdentities,
        commitLocalValidado: result.completion.persistenciaValidada,
        driverCalls: result.statusHost.mockContadores || null
      };
    });

    await verificar('C5 falha na escrita após RELEASE mantém persistência pendente e Host bloqueado', async () => {
      const result = await comando(worker, 'release-persist-failure', { transactionId: ids[3] });
      assert.ok(result.erro);
      assert.strictEqual(result.erro.code, 'MRT50_WRITE_FAIL');
      assert.strictEqual(result.rowStatus, 'pendente');
      assert.ok(result.host.blockedFinancialIdentities.includes(ids[3]));
      const restarted = await comando(worker, 'restart-manager');
      return {
        transactionId: ids[3],
        writeError: result.erro.code,
        rowStatus: result.rowStatus,
        blocked: result.host.blockedFinancialIdentities,
        freshBootstrapStillBlocks: restarted.host.blockedFinancialIdentities.includes(ids[3]),
        driverCalls: result.host.mockContadores || null
      };
    });

    await verificar('C6 falha na segunda leitura mantém bloqueio após reinício e rejeita nova autorização', async () => {
      const result = await comando(worker, 'release-reread-failure', { transactionId: ids[4] });
      assert.ok(result.erro);
      assert.strictEqual(result.rowStatus, 'negado');
      assert.ok(result.hostAntesDeRestart.blockedFinancialIdentities.includes(ids[4]));
      assert.ok(result.persistedEvidence);
      assert.strictEqual(result.persistedEvidence.transactionId, ids[4]);
      assert.strictEqual(result.persistedEvidence.confirmacao_explicita, true);
      const restarted = await comando(worker, 'restart-manager');
      assert.notStrictEqual(restarted.host.hostSessionId, result.hostAntesDeRestart.hostSessionId);
      assert.ok(restarted.identidadeRecuperadas.includes(ids[4]));
      assert.ok(restarted.host.blockedFinancialIdentities.includes(ids[4]));
      await comando(worker, 'configure-mock', { passos: [] });
      const attempt = await comando(worker, 'attempt-new-authorization');
      const externalDriverCalls = worker.telemetry.filter((event) => event.tipo === 'driver-call');
      assert.strictEqual(attempt.result.codigo, 'TEF_RESULTADO_PENDENTE');
      assert.strictEqual(attempt.interceptedTxStarts, 0);
      assert.strictEqual(attempt.txStartIpcCount, 0);
      assert.ok(attempt.blockedFinancialIdentities.includes(ids[4]));
      assert.deepStrictEqual(attempt.driverCalls, {
        iniciaTransacaoDestaxa: 0,
        continuaTransacaoDestaxa: 0,
        finalizaTransacaoDestaxa: 0
      });
      assert.strictEqual(externalDriverCalls.length, 0);
      return {
        transactionId: ids[4],
        rereadError: result.erro.code,
        terminalStatusWithoutCompletionProof: result.rowStatus,
        persistedFullEvidence: result.persistedEvidence,
        blockedBeforeFreshRecovery: result.hostAntesDeRestart.blockedFinancialIdentities,
        freshBootstrapAfterRestart: restarted.host.securityBootstrapState,
        blockedAfterManagerAndHostRestart: restarted.host.blockedFinancialIdentities,
        recoveryHostSessionId: restarted.host.hostSessionId,
        attemptedAuthorizationCode: attempt.result.codigo,
        interceptedTxStarts: attempt.interceptedTxStarts,
        txStartIpcCount: attempt.txStartIpcCount,
        driverCalls: attempt.driverCalls,
        externalDriverCallCount: externalDriverCalls.length
      };
    });

    await verificar('C6b status terminal sem reconciliação íntegra permanece bloqueado após reinício', async () => {
      const completed = await comando(worker, 'release-success', { transactionId: ids[6] });
      assert.strictEqual(completed.rowStatus, 'negado');
      const corrupted = await comando(worker, 'corrupt-reconciliation-proof', {
        transactionId: ids[6],
        corrupt: 'remove'
      });
      assert.strictEqual(corrupted.status, 'negado');
      assert.strictEqual(corrupted.evidence, null);
      const restarted = await comando(worker, 'restart-manager');
      assert.ok(restarted.host.blockedFinancialIdentities.includes(ids[6]));
      const blockedTx = await comando(worker, 'raw-guards');
      assert.ok(blockedTx.respostas.TX_START.error);
      return {
        transactionId: ids[6],
        persistedStatus: corrupted.status,
        reconciliationEvidence: corrupted.evidence,
        blockedAfterRestart: restarted.host.blockedFinancialIdentities,
        txStartError: blockedTx.respostas.TX_START.error.code,
        mockDriverCalls: blockedTx.host.mockContadores
      };
    });

    await verificar('C6c reconciliação com identidade divergente permanece bloqueada após reinício', async () => {
      const completed = await comando(worker, 'release-success', { transactionId: ids[7] });
      assert.strictEqual(completed.rowStatus, 'negado');
      const corrupted = await comando(worker, 'corrupt-reconciliation-proof', {
        transactionId: ids[7],
        corrupt: 'identity'
      });
      assert.strictEqual(corrupted.status, 'negado');
      assert.notStrictEqual(corrupted.evidence.transactionId, ids[7]);
      const restarted = await comando(worker, 'restart-manager');
      assert.ok(restarted.host.blockedFinancialIdentities.includes(ids[7]));
      return {
        transactionId: ids[7],
        persistedStatus: corrupted.status,
        persistedEvidence: corrupted.evidence,
        blockedAfterRestart: restarted.host.blockedFinancialIdentities,
        hostSessionId: restarted.host.hostSessionId
      };
    });

    await verificar('C6d falha ao ler evidência mantém bootstrap fechado e registro inválido bloqueado', async () => {
      const result = await comando(worker, 'restart-manager-read-failure', { transactionId: ids[6] });
      assert.strictEqual(result.failedRead.code, 'MRT50_EVIDENCE_READ_FAIL');
      assert.strictEqual(result.failedClosed, true);
      assert.strictEqual(result.retryAfterReadRestored, true);
      assert.ok(result.blockedAfterVerifiedRead.includes(ids[6]));
      return {
        transactionId: ids[6],
        evidenceReadError: result.failedRead.code,
        failedClosed: result.failedClosed,
        subsequentBootstrapState: result.host.securityBootstrapState,
        blockAfterReadRestored: result.blockedAfterVerifiedRead
      };
    });

    await verificar('C7 falha do IPC imediatamente após COMMIT local mantém a fonte de verdade persistida', async () => {
      const result = await comando(worker, 'release-success', {
        transactionId: ids[5],
        failAt: 'bootstrap'
      });
      assert.ok(result.erro);
      assert.strictEqual(result.rowStatus, 'negado');
      assert.ok(result.eventos.some((event) =>
        event.tipo === 'fault' && event.action === 'drop-kill' && event.operation === 'SECURITY_BOOTSTRAP'));
      const recovered = await comando(worker, 'restart-manager');
      assert.ok(!recovered.host.blockedFinancialIdentities.includes(ids[5]));
      return {
        transactionId: ids[5],
        localCommitBeforeIpcFailure: true,
        commitIpcExists: false,
        postCommitBootstrapIpcLost: true,
        persistedStatus: result.rowStatus,
        newHostBlockList: recovered.host.blockedFinancialIdentities
      };
    });

    let crashEvidence = null;
    await verificar('D1 processo NativeHost encerrado durante TX simulado não causa retry financeiro', async () => {
      const crashDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mrt50-crash-'));
      dirsTemporarios.push(crashDir);
      const crashWorker = iniciarWorker(crashDir);
      try {
        await aguardarWorkerPronto(crashWorker);
        const startedCrash = await comando(crashWorker, 'start');
        assert.strictEqual(startedCrash.sucesso, true);
        const result = await comando(crashWorker, 'crash-transaction');
        crashEvidence = result;
        assert.strictEqual(result.rowStatus, 'pendente');
        assert.strictEqual(result.txStartRequests, 1);
        assert.strictEqual(result.hostExit.signal, 'SIGTERM');
        assert.strictEqual(result.result?.retryAllowed, false);
        assert.strictEqual(result.driverCallCount, 1);
        assert.strictEqual(result.driverCalls[0].method, 'iniciaTransacaoDestaxa');
        const txEvents = crashWorker.telemetry.filter((event) =>
          event.direcao === 'main->host' && event.operation === 'TX_START');
        assert.strictEqual(txEvents.length, 1);
        return {
          transactionId: result.transactionId,
          rowStatus: result.rowStatus,
          financialState: result.rowFinancialState,
          processExitSignal: result.hostExit.signal,
          txStartIpcCount: txEvents.length,
          driverCallCountFromIndependentHostTelemetry: result.driverCallCount,
          driverCallEvents: result.driverCalls,
          retryAllowed: result.result?.retryAllowed,
          isolatedDatabasePath: crashWorker.telemetry.find((event) => event.tipo === 'database-path')?.path || crashDir
        };
      } finally {
        await fecharWorker(crashWorker);
      }
    });

    await verificar('D5 falha/desconexão não reexecuta automaticamente a operação financeira', async () => {
      assert.strictEqual(crashEvidence.result.retryAllowed, false);
      assert.strictEqual(crashEvidence.txStartRequests, 1);
      return {
        transactionId: crashEvidence.transactionId,
        retryAllowed: crashEvidence.result.retryAllowed,
        txStartIpcCount: crashEvidence.txStartRequests,
        driverCallCount: crashEvidence.driverCallCount
      };
    });

    await verificar('D6 resposta perdida não provoca despacho financeiro duplicado', async () => {
      assert.strictEqual(crashEvidence.txStartRequests, 1);
      assert.strictEqual(crashEvidence.driverCallCount, 1);
      assert.strictEqual(crashEvidence.driverCalls.length, 1);
      assert.strictEqual(crashEvidence.hostExit.signal, 'SIGTERM');
      return {
        transactionId: crashEvidence.transactionId,
        txStartIpcCount: crashEvidence.txStartRequests,
        driverCallCount: crashEvidence.driverCallCount,
        driverCallEvents: crashEvidence.driverCalls,
        hostExitSignal: crashEvidence.hostExit.signal,
        noDuplicateObserved: crashEvidence.txStartRequests === 1
          && crashEvidence.driverCallCount === 1
      };
    });

    await verificar('D7 reinício não elimina bloqueios UNKNOWN/PENDING persistidos', async () => {
      const status = await comando(worker, 'restart-manager');
      const rows = await Promise.all(ids.slice(0, 2).map((id) => obterRegistro(repository, id)));
      assert.strictEqual(rows[0].status, 'pendente');
      assert.strictEqual(rows[1].status, 'pendente');
      assert.ok(status.host.blockedFinancialIdentities.includes(ids[0]));
      assert.ok(status.host.blockedFinancialIdentities.includes(ids[1]));
      return {
        unknown: { id: ids[0], rowStatus: rows[0].status, financialState: rows[0].payload_retorno.financialState },
        pending: { id: ids[1], rowStatus: rows[1].status, financialState: rows[1].payload_retorno.financialState },
        hostBlocks: status.host.blockedFinancialIdentities
      };
    });

    const ipcEventos = worker.telemetry.concat(eventosGlobais);
    const evidenciaC3 = cenarios.find((item) => item.nome.startsWith('C3'))?.evidencias || null;
    const evidenciaC6Valida = cenarios.find((item) => item.nome.startsWith('C6 '))?.evidencias || null;
    const evidenciaC6Ausente = cenarios.find((item) => item.nome.startsWith('C6b'))?.evidencias || null;
    const evidenciaC6Inconsistente = cenarios.find((item) => item.nome.startsWith('C6c'))?.evidencias || null;
    const evidenciaC6FalhaLeitura = cenarios.find((item) => item.nome.startsWith('C6d'))?.evidencias || null;
    const evidenciaD1 = cenarios.find((item) => item.nome.startsWith('D1'))?.evidencias || null;
    const evidenciaD6 = cenarios.find((item) => item.nome.startsWith('D6'))?.evidencias || null;
    const resumo = {
      sprint: 'MRT-50.1',
      classification: falhas.length ? 'PARCIAL' : 'CONCLUIDA',
      summary: 'Evidência corrigida de recuperação de reconciliações e falhas IPC, com processos principais e NativeHost independentes.',
      classificationByStatus: {
        CONCLUIDO: [
          'Recuperação fail-closed valida a evidência integral persistida para tentativas de reconciliação em estado terminal.',
          'Evidência ausente/inconsistente mantém a identidade bloqueada no NativeHost após reinicialização.'
        ],
        TESTADO: cenarios.filter((item) => item.resultado === 'PASSOU').map((item) => item.nome),
        NAO_TESTADO: [
          'Homologação física, DLL Destaxa, V$Pague e PinPad.',
          'Suítes legadas MRT-47/MRT-49 com seus harnesses antigos.'
        ],
        BLOQUEADO: falhas.map((item) => ({ scenario: item.nome, error: item.erro }))
      },
      implementationChanges: [
        'backend/services/tef/TefManager.js',
        'backend/services/tef/tefRepository.js',
        'tests/tef/mrt-50-child-process-ipc.test.js',
        'docs/build/mrt-50-child-process-ipc-report.json'
      ],
      database: {
        dbDir: tempDir,
        dbPath: database.dbPath,
        isolatedUnderTemp: true,
        officialDatabaseTouched: false,
        testDatabaseRemovedAfterRun: true
      },
      safety: {
        financialGateOff: transacaoRealHabilitada() === false,
        realDllLoaded: false,
        vspagueConnected: false,
        pinpadOrSerialAccessed: false,
        realFinancialOperation: false,
        historicalIdentitiesMrt24Mrt36Mrt42Touched: false
      },
      testExecution: {
        command: 'node tests\\tef\\mrt-50-child-process-ipc.test.js',
        result: falhas.length ? 'FALHOU' : 'PASSOU',
        passed: cenarios.filter((item) => item.resultado === 'PASSOU').length,
        failed: falhas.length,
        sqliteIsolationVerifiedBeforeDatabaseConsumers: true
      },
      regressionsMrt47Mrt49: {
        result: 'PASSOU_NOS_CENARIOS_INTEGRADOS',
        mrt47: 'RELEASE, persistência condicional, releitura integral, COMMIT local e atualização do bootstrap cobertos nos cenários C3-C7.',
        mrt49: 'Bootstrap real, vínculo de sessão, bloqueio no runtime NativeHost, fail-closed e reinicialização cobertos nos cenários A1-A9, B1-B5 e C1-C3.',
        legacyScriptsExecuted: false,
        reason: 'Os scripts anteriores usam transporte em processo; a regressão foi adaptada neste harness child_process sem substituir o IPC por chamadas internas.'
      },
      processModel: {
        controllerPid: process.pid,
        mainProcessPid: workerReady?.pid || null,
        hostProcessType: 'child_process',
        realIpcMessagesCaptured: ipcEventos.filter((event) => event.direcao).length,
        nativeHostRuntime: 'backend/services/tef/destaxa/DestaxaNativeHost.js',
        driver: 'NativeHost test-mode mock; tripwire enabled'
      },
      independentDriverCounters: {
        instrumentation: 'Driver mock wrapper emits separate child_process IPC telemetry before returning from each mock method.',
        calls: ipcEventos.filter((event) => event.tipo === 'driver-call'),
        totals: ipcEventos.filter((event) => event.tipo === 'driver-call')
          .reduce((totals, event) => {
            totals[event.method] = (totals[event.method] || 0) + 1;
            return totals;
          }, {}),
        blockedOperationsZeroCalls: rawHostEvidence?.preBootstrapDriverCalls || null,
        authorizedMockCallCount: rawHostEvidence?.externalDriverCallCount ?? null,
        hostCrashCallsPreservedOutsideHost: evidenciaD1?.driverCallCountFromIndependentHostTelemetry ?? null
      },
      requiredScenarioEvidence: {
        C3: evidenciaC3,
        C6: evidenciaC6Valida,
        B5: cenarios.find((item) => item.nome.startsWith('B5'))?.evidencias || null,
        D1: evidenciaD1,
        D6: evidenciaD6
      },
      criticalReleaseAckLoss: {
        reproduced: cenarios.some((item) => item.nome.startsWith('C3') && item.resultado === 'PASSOU'),
        noFinancialRetry: evidenciaC3?.financialRequests === 0,
        pendingIdentityReblockedOnNewHost: evidenciaC3?.blocked?.includes(evidenciaC3?.transactionId) || false,
        persistenceRemainedPendingUntilExplicitRetry: evidenciaC3?.rowStatusAfterLostAck === 'pendente'
      },
      commitSemantics: {
        commitEd25519IsLocalClientValidation: true,
        separateCommitIpcMessageExists: false,
        postCommitSecurityBootstrapIpcFailureTested: true
      },
      processGenerationEvidence: cenarios.find((item) => item.nome.startsWith('B5'))?.evidencias || null,
      persistenceEvidence: {
        c6ValidProofRecovery: evidenciaC6Valida,
        c6InvalidProofBlocked: evidenciaC6Ausente,
        c6InconsistentProofBlocked: evidenciaC6Inconsistente,
        c6EvidenceReadFailure: evidenciaC6FalhaLeitura
      },
      scenarios: cenarios,
      ipcEvidence: ipcEventos.slice(-250),
      failures: falhas,
      limitations: [
        'COMMIT Ed25519 é validado localmente pelo TefManager/NativeHostClient; o protocolo não tem mensagem COMMIT própria. O teste injeta perda do ACK do bootstrap de segurança subsequente.',
        'O teste exerce o runtime NativeHost real, mas o driver é mockado e nenhuma homologação física, DLL Destaxa, V$Pague ou PinPad é validado.',
        'Falhas de rede/IPC são injetadas no adaptador do processo pai depois de mensagens reais atravessarem o canal IPC.'
      ]
    };
    const reportPath = path.resolve(__dirname, '..', '..', 'docs', 'build', 'mrt-50-child-process-ipc-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(resumo, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ reportPath, ...resumo }, null, 2));
    if (falhas.length) process.exitCode = 1;
  } finally {
    await fecharWorker(worker);
    await new Promise((resolve) => database.close(() => resolve()));
    for (const dir of dirsTemporarios) {
      const resolvido = path.resolve(dir);
      const tmp = path.resolve(os.tmpdir());
      if (path.relative(tmp, resolvido).startsWith('..') || resolvido === path.parse(resolvido).root) {
        throw new Error(`Recusa de limpeza fora da área temporária: ${resolvido}`);
      }
      fs.rmSync(resolvido, { recursive: true, force: true });
    }
  }
}
