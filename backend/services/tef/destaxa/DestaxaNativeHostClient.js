'use strict';

/**
 * Cliente do TEF Native Host no processo principal.
 *
 * - no máximo UMA requisição em voo; outra chamada recebe HOST_BUSY sem ser enviada;
 * - operações transacionais não têm timeout de IPC padrão; timeout explícito →
 *   HOST_TIMEOUT (UNKNOWN) mas o lock permanece até o host responder ou morrer:
 *   nenhuma nova operação/cobrança enquanto a DLL pode estar ativa;
 * - host perdido → HOST_CRASHED/HOST_OFFLINE/HOST_UNAVAILABLE, nunca aprovado/negado;
 *   perda durante operação transacional registra reconciliação pendente;
 * - encerramento com chamada em voo é adiado — nunca mata a operação nativa.
 */

const path = require('path');
const EventEmitter = require('events');
const {
  PROTOCOLO,
  OPERACOES_HOST,
  OPERACOES_TRANSACIONAIS,
  ERROS_HOST,
  criarRequest,
  validarResponse,
  resultadoHostIndisponivel
} = require('./destaxaNativeHostProtocolo');

const ESTADOS_CLIENTE = Object.freeze({
  OFFLINE: 'OFFLINE',
  STARTING: 'STARTING',
  READY: 'READY',
  BUSY: 'BUSY',
  CRASHED: 'CRASHED',
  SHUTTING_DOWN: 'SHUTTING_DOWN',
  STOPPED: 'STOPPED'
});

/** MRT-26.1 — classificação de encerramento (nunca confunde crash com SHUTDOWN). */
const CLASSIFICACAO_ENCERRAMENTO = Object.freeze({
  CONCLUSAO_NORMAL: 'CONCLUSAO_NORMAL',
  ENCERRAMENTO_CONTROLADO: 'ENCERRAMENTO_CONTROLADO',
  ENCERRAMENTO_INESPERADO: 'ENCERRAMENTO_INESPERADO',
  PERDA_IPC: 'PERDA_IPC',
  CRASH_HOST: 'CRASH_HOST'
});

/**
 * @param {{ motivo?: string, code?: number|null, signal?: string|null, operacaoEmVoo?: string|null }} saida
 * @param {{ perdaIpc?: boolean, encerramentoLimpo?: boolean }} [ctx]
 */
function classificarEncerramentoHost(saida, ctx = {}) {
  if (!saida) return CLASSIFICACAO_ENCERRAMENTO.ENCERRAMENTO_INESPERADO;
  if (ctx.encerramentoLimpo === true || saida.motivo === 'SHUTDOWN') {
    return CLASSIFICACAO_ENCERRAMENTO.ENCERRAMENTO_CONTROLADO;
  }
  if (ctx.perdaIpc === true || saida.motivoIpc === 'IPC_DISCONNECT') {
    return CLASSIFICACAO_ENCERRAMENTO.PERDA_IPC;
  }
  if (saida.signal || (saida.code != null && Number(saida.code) !== 0)) {
    return CLASSIFICACAO_ENCERRAMENTO.CRASH_HOST;
  }
  if (saida.motivo === 'HOST_CRASHED') {
    // exit(0) após disconnect adiado ou queda sem sinal — inesperado, NÃO controlado
    return CLASSIFICACAO_ENCERRAMENTO.ENCERRAMENTO_INESPERADO;
  }
  return CLASSIFICACAO_ENCERRAMENTO.ENCERRAMENTO_INESPERADO;
}

const HOST_PATH = path.join(__dirname, 'DestaxaNativeHost.js');

function criarSpawnerPadrao() {
  return function spawnHost(hostPath, env) {
    const electron = process.versions.electron && process.type === 'browser' ? require('electron') : null;
    if (electron && electron.utilityProcess) {
      const child = electron.utilityProcess.fork(hostPath, [], {
        env,
        serviceName: 'CDS TEF Native Host',
        stdio: 'inherit'
      });
    return {
      tipo: 'utilityProcess',
      get pid() { return child.pid || null; },
      enviar: (mensagem) => child.postMessage(mensagem),
      aoReceber: (fn) => child.on('message', fn),
      aoSair: (fn) => child.on('exit', (code) => fn(code, null)),
      matar: () => child.kill(),
      // MRT-26 — utilityProcess: sem unref automático do canal
      ref: () => {},
      unref: () => {},
      desconectarIpc: () => {
        try { if (typeof child.kill === 'function') child.kill(); } catch (_) { /* */ }
      },
      get connected() { return true; }
    };
  }

  const { fork } = require('child_process');
  const child = fork(hostPath, [], {
    env: process.versions.electron ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    windowsHide: true
  });
  return {
    tipo: 'child_process',
    get pid() { return child.pid || null; },
    get connected() { return child.connected === true; },
    enviar: (mensagem) => { if (child.connected) child.send(mensagem); },
    aoReceber: (fn) => child.on('message', fn),
    aoSair: (fn) => child.on('exit', (code, signal) => fn(code, signal)),
    aoErro: (fn) => child.on('error', fn),
    matar: () => child.kill(),
    // MRT-26 — ref/unref explícitos; NÃO unref automático no start
    ref: () => {
      if (typeof child.ref === 'function') child.ref();
      if (child.channel && typeof child.channel.ref === 'function') child.channel.ref();
    },
    unref: () => {
      child.unref();
      if (child.channel && typeof child.channel.unref === 'function') child.channel.unref();
    },
    desconectarIpc: () => {
      try {
        if (child.connected) child.disconnect();
      } catch (_) { /* já desconectado */ }
    }
  };
  };
}

class DestaxaNativeHostClient extends EventEmitter {
  constructor(opcoes = {}) {
    super();
    this._hostPath = opcoes.hostPath || HOST_PATH;
    this._envExtra = opcoes.env || {};
    this._spawner = opcoes.spawner || criarSpawnerPadrao();
    this._timeoutPadraoMs = opcoes.timeoutMs || 120000;
    this._timeoutInicioMs = opcoes.timeoutInicioMs || 20000;
    this._estado = ESTADOS_CLIENTE.OFFLINE;
    this._processo = null;
    this._nativeSeq = 0;
    this._geracao = 0;
    this._iniciando = null;
    this._info = null;
    this._emVoo = null;
    this._reconciliacaoPendente = null;
    this._ultimaSaida = null;
    this._encerramentoPendente = false;
    this._aguardandoSaida = null;
    this._shutdownRequestId = null;
    this._respostasTardias = [];
    /** MRT-26 — referência ativa do pai ao host (evita unref durante nativa). */
    this._hostRefAtiva = false;
    this._eventosCicloCliente = [];
    /** MRT-26.1 — IPC disconnect detectado neste cliente (não é SHUTDOWN). */
    this._perdaIpcDetectada = false;
  }

  _registrarEventoCliente(tipo, detalhe = {}) {
    const entrada = {
      tipo,
      em: new Date().toISOString(),
      pidPai: process.pid,
      pidHost: this._info?.pid || this._processo?.pid || null,
      estado: this._estado,
      ...detalhe
    };
    this._eventosCicloCliente.push(entrada);
    if (this._eventosCicloCliente.length > 40) this._eventosCicloCliente.shift();
    this.emit('ciclo-vida', entrada);
    return entrada;
  }

  /**
   * Mantém o event loop do pai referenciando o Host (MRT-26).
   * Obrigatório durante operações nativas/transacionais.
   */
  _segurarReferenciaHost(motivo) {
    if (!this._processo) return;
    if (typeof this._processo.ref === 'function') this._processo.ref();
    this._hostRefAtiva = true;
    this._registrarEventoCliente('host.ref', { motivo });
  }

  /**
   * Libera unref somente quando ocioso e explicitamente permitido.
   * Nunca durante emVoo.
   */
  liberarReferenciaHostSeOcioso({ forcar = false } = {}) {
    if (this._emVoo && !forcar) {
      return { liberado: false, motivo: 'em_voo' };
    }
    if (!this._processo || typeof this._processo.unref !== 'function') {
      return { liberado: false, motivo: 'sem_processo' };
    }
    this._processo.unref();
    this._hostRefAtiva = false;
    this._registrarEventoCliente('host.unref', { forcar: forcar === true });
    return { liberado: true };
  }

  get estado() {
    return this._estado;
  }

  getEstado() {
    return {
      estado: this._estado,
      pid: this._info?.pid || null,
      pidPai: process.pid,
      processType: this._info?.processType || null,
      versions: this._info?.versions || null,
      hostRefAtiva: this._hostRefAtiva === true,
      connected: this._processo?.connected !== false,
      emVoo: this._emVoo && this._emVoo.req
        ? {
          requestId: this._emVoo.req.requestId,
          operation: this._emVoo.req.operation,
          transactionId: this._emVoo.req.transactionId,
          desdeMs: Date.now() - this._emVoo.inicio,
          expirado: this._emVoo.expirado === true
        }
        : null,
      encerramentoPendente: this._encerramentoPendente,
      reconciliacaoPendente: this._reconciliacaoPendente ? { ...this._reconciliacaoPendente } : null,
      ultimaSaida: this._ultimaSaida ? { ...this._ultimaSaida } : null,
      respostasTardias: this._respostasTardias.length,
      eventosCiclo: this._eventosCicloCliente.slice(-12)
    };
  }

  iniciar() {
    if (this._estado === ESTADOS_CLIENTE.READY || this._estado === ESTADOS_CLIENTE.BUSY) return Promise.resolve(true);
    if (this._iniciando) return this._iniciando;
    if (this._estado === ESTADOS_CLIENTE.CRASHED || this._estado === ESTADOS_CLIENTE.SHUTTING_DOWN) {
      return Promise.resolve(false);
    }

    this._estado = ESTADOS_CLIENTE.STARTING;
    const geracao = ++this._geracao;
    const env = { ...process.env, ...this._envExtra, DESTAXA_NATIVE_HOST_ENTRY: '1' };

    this._iniciando = new Promise((resolve) => {
      let processo = null;
      let concluido = false;
      const concluir = (ok) => {
        if (concluido) return;
        concluido = true;
        clearTimeout(timer);
        this._iniciando = null;
        resolve(ok);
      };
      const timer = setTimeout(() => {
        this._estado = ESTADOS_CLIENTE.OFFLINE;
        this._ultimaSaida = { motivo: 'HOST_READY não recebido', em: new Date().toISOString() };
        try { processo?.matar(); } catch (_) { /* já encerrado */ }
        concluir(false);
      }, this._timeoutInicioMs);

      try {
        processo = this._spawner(this._hostPath, env);
      } catch (error) {
        this._estado = ESTADOS_CLIENTE.OFFLINE;
        this._ultimaSaida = { motivo: `spawn falhou: ${error.message}`, em: new Date().toISOString() };
        concluir(false);
        return;
      }
      this._processo = processo;
      this._nativeSeq = 0;

      processo.aoReceber((mensagem) => {
        if (geracao !== this._geracao) return;
        if (mensagem && mensagem.tipo === 'HOST_READY' && mensagem.protocol === PROTOCOLO) {
          this._info = {
            pid: mensagem.pid,
            processType: mensagem.processType,
            versions: mensagem.versions,
            modoTeste: mensagem.modoTeste,
            tripwire: mensagem.tripwire
          };
          this._estado = ESTADOS_CLIENTE.READY;
          this.emit('ready', { ...this._info });
          concluir(true);
          return;
        }
        this._aoMensagem(mensagem);
      });
      processo.aoSair((code, signal) => {
        if (geracao !== this._geracao) return;
        this._aoSair(code, signal);
        concluir(false);
      });
      if (processo.aoErro) {
        processo.aoErro((error) => {
          if (geracao !== this._geracao) return;
          this._ultimaSaida = { motivo: `erro no processo host: ${error.message}`, em: new Date().toISOString() };
        });
      }
      // MRT-26 — NÃO unref automático no start: o pai mantém referência ao Host.
      // unref explícito só via liberarReferenciaHostSeOcioso() quando ocioso.
      this._segurarReferenciaHost('start');
      this._registrarEventoCliente('host.spawn', {
        processType: processo.tipo,
        pidHost: processo.pid
      });
    });
    return this._iniciando;
  }

  _respostaLocal(codigo, req, mensagem, { executadaTalvez = false } = {}) {
    const transacional = OPERACOES_TRANSACIONAIS.has(req.operation);
    return {
      protocol: PROTOCOLO,
      requestId: req.requestId || null,
      transactionId: req.transactionId || null,
      resultCode: null,
      output: transacional && executadaTalvez ? resultadoHostIndisponivel(codigo, req.transactionId, mensagem) : null,
      error: { code: codigo, message: mensagem },
      local: true
    };
  }

  /**
   * @param {string} operation - OPERACOES_HOST
   * @param {object} payload
   * @param {{transactionId?: string, timeoutMs?: number}} opcoes
   */
  async enviar(operation, payload = {}, opcoes = {}) {
    const req = criarRequest(operation, payload, opcoes.transactionId ?? null, this._nativeSeq);

    if (this._encerramentoPendente || this._estado === ESTADOS_CLIENTE.SHUTTING_DOWN) {
      return this._respostaLocal(ERROS_HOST.HOST_SHUTTING_DOWN, req, 'TEF Native Host em encerramento — operação não enviada');
    }
    if (this._estado === ESTADOS_CLIENTE.STOPPED) {
      return this._respostaLocal(ERROS_HOST.HOST_OFFLINE, req, 'TEF Native Host encerrado — operação não enviada');
    }
    if (this._estado === ESTADOS_CLIENTE.CRASHED) {
      return this._respostaLocal(ERROS_HOST.HOST_CRASHED, req, 'TEF Native Host caiu — reinício explícito necessário');
    }
    if (this._emVoo) {
      return this._respostaLocal(ERROS_HOST.HOST_BUSY, req, 'Chamada nativa Destaxa em andamento — operação não enviada');
    }
    if (this._reconciliacaoPendente && operation === OPERACOES_HOST.TX_START) {
      return this._respostaLocal(
        ERROS_HOST.HOST_RECONCILIATION_PENDING,
        req,
        `Transação ${this._reconciliacaoPendente.transactionId} sem desfecho conhecido — nova transação bloqueada`
      );
    }

    this._emVoo = { req, reservando: true, inicio: Date.now(), expirado: false, resolve: null, timer: null };
    if (this._estado !== ESTADOS_CLIENTE.READY) {
      const ok = await this.iniciar();
      if (!ok || this._estado !== ESTADOS_CLIENTE.READY) {
        this._emVoo = null;
        const codigo = this._estado === ESTADOS_CLIENTE.CRASHED ? ERROS_HOST.HOST_CRASHED : ERROS_HOST.HOST_UNAVAILABLE;
        return this._respostaLocal(codigo, req, `TEF Native Host indisponível: ${this._ultimaSaida?.motivo || 'sem detalhe'}`);
      }
    }

    // Destaxa 1.83 não documenta timeout global para as APIs transacionais
    // (DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO): sem timeout de transporte padrão;
    // o fim da chamada é a resposta do host ou a queda do processo.
    const timeoutMs = opcoes.timeoutMs
      || (OPERACOES_TRANSACIONAIS.has(operation) ? null : this._timeoutPadraoMs);
    return new Promise((resolve) => {
      const emVoo = this._emVoo;
      emVoo.reservando = false;
      emVoo.inicio = Date.now();
      emVoo.resolve = resolve;
      emVoo.timer = timeoutMs == null ? null : setTimeout(() => {
        emVoo.expirado = true;
        emVoo.resolve = null;
        this.emit('timeout', { requestId: req.requestId, operation: req.operation, transactionId: req.transactionId });
        resolve(this._respostaLocal(
          ERROS_HOST.HOST_TIMEOUT,
          req,
          `Sem resposta do TEF Native Host em ${timeoutMs}ms — chamada nativa pode seguir ativa; lock mantido`,
          { executadaTalvez: true }
        ));
      }, timeoutMs);
      this._estado = ESTADOS_CLIENTE.BUSY;
      // MRT-26 — durante qualquer IPC nativo/transacional, reforça ref do Host
      this._segurarReferenciaHost(`enviar:${operation}`);
      this._registrarEventoCliente('nativa.envio', {
        operation,
        requestId: req.requestId,
        transactionId: req.transactionId || null,
        transacional: OPERACOES_TRANSACIONAIS.has(operation)
      });
      try {
        this._processo.enviar(req);
      } catch (error) {
        clearTimeout(emVoo.timer);
        this._emVoo = null;
        this._estado = ESTADOS_CLIENTE.READY;
        resolve(this._respostaLocal(ERROS_HOST.HOST_UNAVAILABLE, req, `IPC falhou: ${error.message}`));
      }
    });
  }

  /** Expõe desconexão IPC para testes de ciclo de vida (MRT-26). Não usa em produção. */
  desconectarIpcParaTeste() {
    this._perdaIpcDetectada = true;
    this._registrarEventoCliente('ipc.disconnect.teste', {});
    if (this._processo && typeof this._processo.desconectarIpc === 'function') {
      this._processo.desconectarIpc();
      return true;
    }
    return false;
  }

  _aoMensagem(mensagem) {
    const invalido = validarResponse(mensagem);
    if (invalido) {
      this.emit('mensagem-invalida', { motivo: invalido });
      return;
    }
    if (Number.isInteger(mensagem.nativeSeq) && mensagem.nativeSeq > this._nativeSeq) {
      this._nativeSeq = mensagem.nativeSeq;
    }

    if (mensagem.requestId === this._shutdownRequestId) {
      if (mensagem.output?.transacaoPendente) {
        this._registrarReconciliacao(mensagem.output.transacaoPendente.transactionId, 'SHUTDOWN', mensagem.requestId);
      }
      return;
    }

    const emVoo = this._emVoo;
    if (!emVoo || emVoo.req.requestId !== mensagem.requestId) {
      this._registrarTardia(mensagem, null);
      return;
    }

    clearTimeout(emVoo.timer);
    this._emVoo = null;
    this._estado = ESTADOS_CLIENTE.READY;
    if (emVoo.expirado) {
      this._registrarTardia(mensagem, Date.now() - emVoo.inicio);
    } else {
      emVoo.resolve(mensagem);
    }

    if (this._encerramentoPendente) {
      this._enviarShutdown();
    }
  }

  _registrarTardia(mensagem, aposMs) {
    const registro = {
      requestId: mensagem.requestId,
      transactionId: mensagem.transactionId || null,
      resultCode: mensagem.resultCode || null,
      errorCode: mensagem.error?.code || null,
      recebidaAposMs: aposMs,
      em: new Date().toISOString()
    };
    this._respostasTardias.push(registro);
    this.emit('resposta-tardia', { ...registro, output: mensagem.output });
  }

  _registrarReconciliacao(transactionId, operacao, requestId) {
    this._reconciliacaoPendente = {
      transactionId: transactionId || null,
      operation: operacao,
      requestId: requestId || null,
      em: new Date().toISOString()
    };
    this.emit('reconciliacao-pendente', { ...this._reconciliacaoPendente });
  }

  _aoSair(code, signal) {
    const emVoo = this._emVoo && !this._emVoo.reservando ? this._emVoo : null;
    if (emVoo) this._emVoo = null;
    this._processo = null;
    const encerramentoLimpo = this._estado === ESTADOS_CLIENTE.SHUTTING_DOWN;
    const antesDePronto = this._estado === ESTADOS_CLIENTE.STARTING || this._estado === ESTADOS_CLIENTE.OFFLINE;

    const motivo = encerramentoLimpo
      ? 'SHUTDOWN'
      : (antesDePronto ? 'saiu antes de HOST_READY' : 'HOST_CRASHED');
    this._ultimaSaida = {
      code: code ?? null,
      signal: signal || null,
      motivo,
      motivoIpc: this._perdaIpcDetectada ? 'IPC_DISCONNECT' : null,
      operacaoEmVoo: emVoo?.req?.operation || null,
      transactionIdEmVoo: emVoo?.req?.transactionId || null,
      duracaoOperacaoMs: emVoo?.inicio != null ? Date.now() - emVoo.inicio : null,
      pidPai: process.pid,
      em: new Date().toISOString()
    };
    this._ultimaSaida.classificacaoEncerramento = classificarEncerramentoHost(this._ultimaSaida, {
      perdaIpc: this._perdaIpcDetectada === true,
      encerramentoLimpo: encerramentoLimpo === true
    });
    // Crash/perda IPC nunca viram ENCERRAMENTO_CONTROLADO
    if (this._ultimaSaida.classificacaoEncerramento === CLASSIFICACAO_ENCERRAMENTO.ENCERRAMENTO_CONTROLADO
      && !encerramentoLimpo) {
      this._ultimaSaida.classificacaoEncerramento = CLASSIFICACAO_ENCERRAMENTO.ENCERRAMENTO_INESPERADO;
    }
    this._hostRefAtiva = false;
    this._registrarEventoCliente('host.exit', {
      code: code ?? null,
      signal: signal || null,
      motivo: this._ultimaSaida.motivo,
      classificacaoEncerramento: this._ultimaSaida.classificacaoEncerramento,
      operacaoEmVoo: this._ultimaSaida.operacaoEmVoo
    });
    this._perdaIpcDetectada = false;

    if (encerramentoLimpo) {
      this._estado = ESTADOS_CLIENTE.STOPPED;
    } else if (antesDePronto) {
      this._estado = ESTADOS_CLIENTE.OFFLINE;
    } else {
      this._estado = ESTADOS_CLIENTE.CRASHED;
      this.emit('crash', { ...this._ultimaSaida });
    }

    if (emVoo && emVoo.req) {
      clearTimeout(emVoo.timer);
      // Nunca aprovar/negar: UNKNOWN / reconciliação
      if (OPERACOES_TRANSACIONAIS.has(emVoo.req.operation)
        || OPERACOES_HOST.SIMULATE_BLOCKING === emVoo.req.operation) {
        if (OPERACOES_TRANSACIONAIS.has(emVoo.req.operation)) {
          this._registrarReconciliacao(emVoo.req.transactionId, emVoo.req.operation, emVoo.req.requestId);
        }
      }
      if (emVoo.resolve) {
        emVoo.resolve(this._respostaLocal(
          ERROS_HOST.HOST_CRASHED,
          emVoo.req,
          `TEF Native Host encerrou durante ${emVoo.req.operation} (code=${code ?? '-'}, signal=${signal || '-'})`,
          { executadaTalvez: OPERACOES_TRANSACIONAIS.has(emVoo.req.operation) }
        ));
      }
    }

    if (this._aguardandoSaida) {
      this._aguardandoSaida();
      this._aguardandoSaida = null;
    }
  }

  _enviarShutdown() {
    this._encerramentoPendente = false;
    if (!this._processo) return;
    this._estado = ESTADOS_CLIENTE.SHUTTING_DOWN;
    const req = criarRequest(OPERACOES_HOST.SHUTDOWN, {}, null, this._nativeSeq);
    this._shutdownRequestId = req.requestId;
    try {
      this._processo.enviar(req);
    } catch (_) {
      try { this._processo.matar(); } catch (__) { /* já encerrado */ }
    }
  }

  /**
   * Encerramento seguro. Com chamada nativa em voo o encerramento é adiado
   * (a operação nunca é tratada como cancelada); o host recebe SHUTDOWN
   * assim que a chamada retornar.
   */
  async encerrar({ aguardarMs = 5000 } = {}) {
    if (!this._processo || [ESTADOS_CLIENTE.OFFLINE, ESTADOS_CLIENTE.STOPPED, ESTADOS_CLIENTE.CRASHED].includes(this._estado)) {
      return { encerrado: true, estado: this._estado };
    }
    if (this._emVoo) {
      this._encerramentoPendente = true;
      const emVoo = this.getEstado().emVoo;
      this.emit('encerramento-adiado', emVoo);
      return { encerrado: false, adiado: true, motivo: ERROS_HOST.HOST_BUSY, operacaoEmVoo: emVoo };
    }

    const saiu = new Promise((resolve) => { this._aguardandoSaida = resolve; });
    this._enviarShutdown();
    const venceu = await Promise.race([
      saiu.then(() => 'saiu'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), aguardarMs))
    ]);
    if (venceu === 'timeout' && this._processo && !this._emVoo) {
      try { this._processo.matar(); } catch (_) { /* já encerrado */ }
      await Promise.race([saiu, new Promise((resolve) => setTimeout(resolve, 1000))]);
      return { encerrado: true, forcado: true, estado: this._estado };
    }
    return { encerrado: true, estado: this._estado };
  }

  /** Reinício explícito após queda. Recusa enquanto houver transação sem desfecho conhecido. */
  async reiniciar({ reconciliado = false } = {}) {
    if (this._reconciliacaoPendente && !reconciliado) {
      return { sucesso: false, codigo: ERROS_HOST.HOST_RECONCILIATION_PENDING, reconciliacao: { ...this._reconciliacaoPendente } };
    }
    if (this._emVoo) {
      return { sucesso: false, codigo: ERROS_HOST.HOST_BUSY };
    }
    if (this._processo) {
      await this.encerrar();
    }
    this._reconciliacaoPendente = null;
    this._estado = ESTADOS_CLIENTE.OFFLINE;
    const ok = await this.iniciar();
    return { sucesso: ok, estado: this._estado };
  }
}

let compartilhado = null;

/** Cliente único do processo principal — um host TEF por aplicação. */
function obterClienteCompartilhado() {
  if (!compartilhado) compartilhado = new DestaxaNativeHostClient();
  return compartilhado;
}

function clienteCompartilhadoExistente() {
  return compartilhado;
}

module.exports = {
  DestaxaNativeHostClient,
  ESTADOS_CLIENTE,
  CLASSIFICACAO_ENCERRAMENTO,
  classificarEncerramentoHost,
  HOST_PATH,
  criarSpawnerPadrao,
  obterClienteCompartilhado,
  clienteCompartilhadoExistente
};
