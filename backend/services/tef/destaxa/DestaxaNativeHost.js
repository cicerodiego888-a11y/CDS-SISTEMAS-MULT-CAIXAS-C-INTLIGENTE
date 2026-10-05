'use strict';

/**
 * TEF Native Host — fronteira de execução nativa Destaxa em processo isolado.
 *
 * Executado como Electron utilityProcess (app) ou child_process.fork (Node).
 * É o único processo que carrega a DLL Destaxa para transacionar. Não é um
 * motor TEF: não decide fluxo, não persiste e não faz retry — apenas executa
 * DestaxaNativeBridge/DestaxaTransacaoOrquestrador e devolve o resultado.
 *
 * Serialização: as chamadas nativas são síncronas e o host processa uma
 * mensagem por vez; requisições enviadas enquanto uma chamada nativa estava
 * ativa são recusadas com HOST_BUSY (nunca enfileiradas para depois).
 */

const DestaxaNativeBridge = require('./DestaxaNativeBridge');
const destaxaKoffiLoader = require('./destaxaKoffiLoader');
const { ESTADOS_BLOQUEIAM_NOVA } = require('./destaxaTransacaoOrquestrador');
const { transacaoRealHabilitada } = require('./destaxaConstantes');
const {
  PROTOCOLO,
  OPERACOES_HOST,
  OPERACOES_NATIVAS,
  OPERACOES_TRANSACIONAIS,
  OPERACOES_TESTE,
  ERROS_HOST,
  validarRequest,
  criarResponse,
  erroHost,
  resultadoHostIndisponivel
} = require('./destaxaNativeHostProtocolo');

const TEST_MODE_ENV = 'DESTAXA_NATIVE_HOST_TEST_MODE';
const TRIPWIRE_ENV = 'DESTAXA_NATIVE_HOST_TRIPWIRE';
const ENTRY_ENV = 'DESTAXA_NATIVE_HOST_ENTRY';

const TRIPWIRES = Object.freeze({
  iniciaTransacaoDestaxa: 'inicia',
  continuaTransacaoDestaxa: 'continua',
  finalizaTransacaoDestaxa: 'finaliza'
});

function envAtiva(nome) {
  return String(process.env[nome] || '').trim() === '1';
}

function ocuparThread(ms) {
  const fim = Date.now() + Math.max(0, Number(ms) || 0);
  while (Date.now() < fim) { /* simula chamada nativa síncrona */ }
}

/** Conta cargas da DLL; com tripwire, as funções transacionais nunca alcançam a DLL. */
function criarLoaderInstrumentado(loaderBase, contadores, tripwire) {
  return {
    carregarBiblioteca(dllPath) {
      const lib = loaderBase.carregarBiblioteca(dllPath);
      contadores.dllLoads += 1;
      if (tripwire) {
        for (const [nome, chave] of Object.entries(TRIPWIRES)) {
          lib.exports[nome] = function tripwireHost() {
            contadores[chave] += 1;
            const error = new Error(`${nome} bloqueado pelo tripwire do TEF Native Host`);
            error.code = 'DESTAXA_HOST_TRIPWIRE';
            throw error;
          };
        }
      }
      return lib;
    }
  };
}

class ErroHost extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class DestaxaNativeHostRuntime {
  constructor(opcoes = {}) {
    this._enviar = opcoes.enviar;
    this._encerrarProcesso = opcoes.encerrarProcesso || ((codigo) => process.exit(codigo));
    this.processType = opcoes.processType || 'in-process';
    this.modoTeste = opcoes.modoTeste === true;
    this.tripwire = opcoes.tripwire === true;
    this.contadores = { dllLoads: 0, inicia: 0, continua: 0, finaliza: 0 };
    this.bridge = opcoes.bridge || new DestaxaNativeBridge({
      nativeLoader: criarLoaderInstrumentado(opcoes.loader || destaxaKoffiLoader, this.contadores, this.tripwire)
    });
    this._operacaoAtiva = null;
    this._seqNativo = 0;
    this._encerrando = false;
    this._mock = null;
  }

  _transacaoAtiva() {
    const contexto = this.bridge.getTransacaoContexto();
    return Boolean(contexto && ESTADOS_BLOQUEIAM_NOVA.has(contexto.estado));
  }

  status() {
    return {
      pid: process.pid,
      processType: this.processType,
      modoTeste: this.modoTeste,
      tripwire: this.tripwire,
      contadores: { ...this.contadores },
      gateReal: transacaoRealHabilitada(),
      encerrando: this._encerrando,
      operacaoAtiva: this._operacaoAtiva ? { ...this._operacaoAtiva } : null,
      diagnostics: this.bridge.getDiagnostics(),
      contexto: this.bridge.getTransacaoContexto(),
      mockContadores: this._mock ? { ...this._mock.contadores } : null
    };
  }

  receber(req) {
    const resposta = this.processar(req);
    this._enviar(resposta);
    return resposta;
  }

  processar(req) {
    const resposta = this._processar(req);
    resposta.nativeSeq = this._seqNativo;
    return resposta;
  }

  _processar(req) {
    const invalido = validarRequest(req);
    if (invalido) {
      return criarResponse(req, { error: erroHost(ERROS_HOST.HOST_INVALID_REQUEST, invalido) });
    }

    const operacao = req.operation;
    if (OPERACOES_TESTE.has(operacao) && !this.modoTeste) {
      return criarResponse(req, {
        error: erroHost(ERROS_HOST.HOST_OPERATION_NOT_ALLOWED, `${operacao} disponível somente em modo de teste`)
      });
    }
    if (this._encerrando && operacao !== OPERACOES_HOST.PING && operacao !== OPERACOES_HOST.STATUS) {
      return criarResponse(req, { error: erroHost(ERROS_HOST.HOST_SHUTTING_DOWN, 'TEF Native Host em encerramento') });
    }

    if (OPERACOES_NATIVAS.has(operacao)) {
      return this._processarNativa(req);
    }

    switch (operacao) {
      case OPERACOES_HOST.PING:
        return criarResponse(req, { output: { pong: true, pid: process.pid } });
      case OPERACOES_HOST.STATUS:
        return criarResponse(req, { output: this.status() });
      case OPERACOES_HOST.CONFIGURE_MOCK:
        return criarResponse(req, { output: this._configurarMock(req.payload.passos) });
      case OPERACOES_HOST.SIMULATE_CRASH:
        setImmediate(() => { throw new Error('SIMULATED_HOST_CRASH'); });
        return criarResponse(req, { output: { crashAgendado: true } });
      case OPERACOES_HOST.SHUTDOWN: {
        this._encerrando = true;
        const contexto = this.bridge.getTransacaoContexto();
        setImmediate(() => {
          try { this.bridge.unload(); } catch (_) { /* encerrando */ }
          this._encerrarProcesso(0);
        });
        return criarResponse(req, {
          output: { encerrando: true, transacaoPendente: this._transacaoAtiva() ? contexto : null }
        });
      }
      default:
        return criarResponse(req, { error: erroHost(ERROS_HOST.HOST_INVALID_REQUEST, `operação sem handler: ${operacao}`) });
    }
  }

  _processarNativa(req) {
    if (this._operacaoAtiva || req.nativeSeq < this._seqNativo) {
      return criarResponse(req, {
        error: erroHost(ERROS_HOST.HOST_BUSY, 'Requisição enviada durante chamada nativa Destaxa ativa — não executada')
      });
    }

    this._operacaoAtiva = { requestId: req.requestId, operation: req.operation, transactionId: req.transactionId };
    try {
      const output = this._executarNativa(req);
      const transactionId = output?.contexto?.transactionId || req.transactionId;
      return criarResponse(req, { output, transactionId });
    } catch (error) {
      const code = error instanceof ErroHost ? error.code : ERROS_HOST.HOST_INTERNAL_ERROR;
      const output = OPERACOES_TRANSACIONAIS.has(req.operation) && code === ERROS_HOST.HOST_INTERNAL_ERROR
        ? resultadoHostIndisponivel(code, req.transactionId, error.message)
        : null;
      return criarResponse(req, { output, error: erroHost(code, error.message) });
    } finally {
      this._seqNativo += 1;
      this._operacaoAtiva = null;
    }
  }

  _validarTransactionId(transactionId) {
    const contexto = this.bridge.getTransacaoContexto();
    if (transactionId && contexto && contexto.transactionId !== transactionId) {
      throw new ErroHost(
        ERROS_HOST.HOST_TRANSACTION_MISMATCH,
        `transactionId ${transactionId} difere da transação ativa no host`
      );
    }
  }

  _exigirSemTransacaoAtiva(operacao) {
    if (this._transacaoAtiva()) {
      throw new ErroHost(ERROS_HOST.HOST_TRANSACTION_ACTIVE, `${operacao} recusado: transação Destaxa ativa no host`);
    }
  }

  _executarNativa(req) {
    const { payload, transactionId } = req;
    switch (req.operation) {
      case OPERACOES_HOST.LOAD:
        if (this.bridge.isLoaded() && payload.recarregar !== true) {
          return { sucesso: true, jaCarregada: true, diagnostico: this.bridge.getDiagnostics() };
        }
        this._exigirSemTransacaoAtiva(req.operation);
        if (payload.config) this.bridge.config = payload.config;
        return this.bridge.load();
      case OPERACOES_HOST.INIT_CLIENT:
        this._exigirSemTransacaoAtiva(req.operation);
        return this.bridge.iniciarClient(payload.config || {});
      case OPERACOES_HOST.ENABLE_REAL:
        return this.bridge.habilitarTransacaoReal();
      case OPERACOES_HOST.TX_START:
        return this.bridge.iniciarTransacaoDestaxa(payload.operacao, payload.campos || {}, { transactionId });
      case OPERACOES_HOST.TX_CONTINUE:
        this._validarTransactionId(transactionId);
        return this.bridge.continuarTransacaoDestaxa(payload.resposta || {});
      case OPERACOES_HOST.TX_FINALIZE:
        this._validarTransactionId(transactionId);
        return this.bridge.finalizarTransacaoDestaxa(payload.confirmacao);
      case OPERACOES_HOST.UNLOAD:
        this._exigirSemTransacaoAtiva(req.operation);
        this.bridge.unload();
        return { sucesso: true };
      case OPERACOES_HOST.SIMULATE_BLOCKING: {
        const inicio = Date.now();
        ocuparThread(payload.ms);
        return { sucesso: true, codigo: payload.codigo || '00', duracaoMs: Date.now() - inicio };
      }
      default:
        throw new ErroHost(ERROS_HOST.HOST_INVALID_REQUEST, `operação nativa sem handler: ${req.operation}`);
    }
  }

  /**
   * Modo de teste: driver mock no orquestrador real. `bloqueioMs` simula a DLL
   * ocupando a thread; `crashHost` simula a DLL derrubando o processo no meio da chamada.
   */
  _configurarMock(passos = []) {
    const lista = Array.isArray(passos) ? passos : [];
    this.bridge.getOrquestradorTransacao().reset();
    const mock = this.bridge.configurarDriverTransacaoMock(lista);
    for (const metodo of ['iniciaTransacaoDestaxa', 'continuaTransacaoDestaxa', 'finalizaTransacaoDestaxa']) {
      const original = mock[metodo].bind(mock);
      mock[metodo] = (...args) => {
        const passo = mock._passos[mock._indice];
        ocuparThread(passo?.bloqueioMs);
        if (passo?.crashHost === true) this._encerrarProcesso(70);
        return original(...args);
      };
    }
    this._mock = mock;
    return { sucesso: true, passos: lista.length };
  }
}

function criarCanal() {
  if (process.parentPort) {
    return {
      tipo: 'utilityProcess',
      enviar: (mensagem) => process.parentPort.postMessage(mensagem),
      aoReceber: (fn) => process.parentPort.on('message', (evento) => fn(evento.data))
    };
  }
  if (typeof process.send === 'function') {
    process.on('disconnect', () => process.exit(0));
    return {
      tipo: 'child_process',
      enviar: (mensagem) => process.send(mensagem),
      aoReceber: (fn) => process.on('message', fn)
    };
  }
  return null;
}

let hostIniciado = false;

function iniciarHost() {
  if (hostIniciado) return null;
  const canal = criarCanal();
  if (!canal) {
    throw new Error('TEF Native Host requer canal IPC (utilityProcess ou child_process.fork)');
  }
  hostIniciado = true;
  const runtime = new DestaxaNativeHostRuntime({
    enviar: canal.enviar,
    processType: canal.tipo,
    modoTeste: envAtiva(TEST_MODE_ENV),
    tripwire: envAtiva(TRIPWIRE_ENV)
  });
  canal.aoReceber((mensagem) => runtime.receber(mensagem));
  canal.enviar({
    protocol: PROTOCOLO,
    tipo: 'HOST_READY',
    pid: process.pid,
    processType: canal.tipo,
    modoTeste: runtime.modoTeste,
    tripwire: runtime.tripwire,
    versions: { node: process.versions.node, electron: process.versions.electron || null, modules: process.versions.modules }
  });
  return runtime;
}

if (require.main === module || envAtiva(ENTRY_ENV)) {
  iniciarHost();
}

module.exports = {
  DestaxaNativeHostRuntime,
  iniciarHost,
  TEST_MODE_ENV,
  TRIPWIRE_ENV,
  ENTRY_ENV
};
