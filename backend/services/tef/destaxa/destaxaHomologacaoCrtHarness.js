'use strict';

/**
 * MRT-20 — Harness isolado de homologação CRT Destaxa.
 *
 * Não substitui TefManager.autorizar nem o fluxo do PDV.
 * Conduz LOAD → INIT → TX_START(CRT) → TX_CONTINUE* → TX_FINALIZE
 * no mesmo Native Host / sessão injetada.
 *
 * MRT-27 — Separação explícita de caminhos:
 * - PRODUCAO: PDV/API → TefManager.autorizar → persistência → DestaxaRealAdapter → DLL.
 * - HARNESS_SIMULADO: este harness em modo simulado (mock; sem DLL financeira).
 * - HARNESS_HOMOLOGACAO: este harness em modo controlado (somente com env/gate pontual).
 * DestaxaRealAdapter.autorizarPagamento em produção exige persistenciaConfirmada;
 * chamada direta do Adapter (como MRT-24) é bloqueada sem TefManager.
 *
 * Modos:
 * - simulado: driver mock / sessão em memória (testes; sem DLL financeira).
 * - controlado: DestaxaHostBridge + host compartilhado (futuro); exige env e
 *   gate pontual — esta sprint não executa o caminho financeiro real.
 */

const crypto = require('crypto');
const DestaxaTransacaoOrquestrador = require('./destaxaTransacaoOrquestrador');
const DestaxaTransacaoMockDriver = require('./destaxaTransacaoMockDriver');
const { buildCrtInput } = require('./destaxaProtocolo');
const {
  PROVIDER,
  OPERACOES,
  OPERACOES_REAIS_PERMITIDAS,
  AMBIENTE_TRANSACAO_REAL,
  VALOR_HOMOLOGACAO_CENTAVOS,
  CODIGO_CLIENT_OK,
  REAL_TRANSACTION_ENV,
  FINALIZACAO_CONFIRMAR,
  FINALIZACAO_CANCELAR,
  CLASSIFICACAO_CODIGO,
  transacaoRealHabilitada
} = require('./destaxaConstantes');
const { ERROS_HOST } = require('./destaxaNativeHostProtocolo');

const HARNESS_ENV = 'DESTAXA_HOMOLOGACAO_CRT_HARNESS';
const HARNESS_SIM_ENV = 'DESTAXA_HOMOLOGACAO_CRT_SIMULADO';

const HARNESS_ERROS = Object.freeze({
  DESABILITADO: 'DESTAXA_HARNESS_DESABILITADO',
  PRODUCAO_PROIBIDA: 'DESTAXA_HARNESS_PRODUCAO_PROIBIDA',
  AMBIENTE_INVALIDO: 'DESTAXA_HARNESS_AMBIENTE_INVALIDO',
  OPERACAO_INVALIDA: 'DESTAXA_HARNESS_OPERACAO_INVALIDA',
  VALOR_INVALIDO: 'DESTAXA_HARNESS_VALOR_INVALIDO',
  VSPAGUE_INDISPONIVEL: 'DESTAXA_HARNESS_VSPAGUE_INDISPONIVEL',
  GATE_DEVE_ESTAR_OFF_NA_SPRINT: 'DESTAXA_HARNESS_GATE_DEVE_ESTAR_OFF',
  GATE_OFF_BLOQUEIA_TX_REAL: 'DESTAXA_HARNESS_GATE_OFF_BLOQUEIA_TX_REAL',
  INIT_FALHOU: 'DESTAXA_HARNESS_INIT_FALHOU',
  INIT_CONCORRENTE: 'DESTAXA_HARNESS_INIT_CONCORRENTE',
  HOST_ENCERRADO: 'DESTAXA_HARNESS_HOST_ENCERRADO',
  HOST_BUSY: 'DESTAXA_HARNESS_HOST_BUSY',
  TX_START_JA_EXECUTADO: 'DESTAXA_HARNESS_TX_START_JA_EXECUTADO',
  RECONCILIACAO_PENDENTE: 'DESTAXA_HARNESS_RECONCILIACAO_PENDENTE',
  CONTINUACAO_NAO_PERMITIDA: 'DESTAXA_HARNESS_CONTINUACAO_NAO_PERMITIDA',
  FINALIZACAO_NAO_PERMITIDA: 'DESTAXA_HARNESS_FINALIZACAO_NAO_PERMITIDA',
  SESSAO_AUSENTE: 'DESTAXA_HARNESS_SESSAO_AUSENTE',
  CAMINHO_PRODUCAO: 'DESTAXA_HARNESS_CAMINHO_PRODUCAO_PROIBIDO'
});

const ESTADOS_HARNESS = Object.freeze({
  CRIADO: 'CRIADO',
  AMBIENTE_OK: 'AMBIENTE_OK',
  HOST_PRONTO: 'HOST_PRONTO',
  LOADED: 'LOADED',
  CLIENT_INITIALIZED: 'CLIENT_INITIALIZED',
  PRONTO_PARA_TX: 'PRONTO_PARA_TX',
  TX_INICIADA: 'TX_INICIADA',
  AGUARDANDO_CONTINUACAO: 'AGUARDANDO_CONTINUACAO',
  AGUARDANDO_FINALIZACAO: 'AGUARDANDO_FINALIZACAO',
  CONCLUIDO: 'CONCLUIDO',
  INCONCLUSIVO: 'INCONCLUSIVO',
  BLOQUEADO: 'BLOQUEADO',
  HOST_ENCERRADO: 'HOST_ENCERRADO'
});

function envAtiva(nome) {
  return String(process.env[nome] || '').trim() === '1';
}

function novoId(prefixo) {
  return `${prefixo}_${crypto.randomBytes(6).toString('hex')}`;
}

function respostaErro(codigo, mensagem, extra = {}) {
  return {
    sucesso: false,
    codigo,
    mensagem,
    retryAllowed: false,
    ...extra
  };
}

/**
 * Sessão em memória que espelha restrições do Native Host (single-flight,
 * reconciliação, host encerrado) sem carregar DLL.
 */
class HomologacaoSessaoSimulada {
  constructor(opcoes = {}) {
    this.hostId = opcoes.hostId || novoId('host_sim');
    this._estadoHost = 'READY';
    this._emVoo = false;
    this._initEmAndamento = false;
    this._clientInitialized = false;
    this._clientCodigo = null;
    this._loaded = false;
    this._reconciliacaoPendente = null;
    this._enableReal = false;
    this._codigoInitForcado = opcoes.codigoInit != null ? String(opcoes.codigoInit) : CODIGO_CLIENT_OK;
    this._orq = new DestaxaTransacaoOrquestrador({
      driver: new DestaxaTransacaoMockDriver(opcoes.passosTransacao || []),
      permitirTransacaoReal: true
    });
    this.contadores = {
      load: 0,
      init: 0,
      enableReal: 0,
      txStart: 0,
      txContinue: 0,
      txFinalize: 0
    };
  }

  getEstado() {
    return {
      hostId: this.hostId,
      estado: this._estadoHost,
      emVoo: this._emVoo,
      clientInitialized: this._clientInitialized,
      clientCodigo: this._clientCodigo,
      loaded: this._loaded,
      reconciliacaoPendente: this._reconciliacaoPendente
        ? { ...this._reconciliacaoPendente }
        : null
    };
  }

  encerrar() {
    this._estadoHost = 'STOPPED';
    this._emVoo = false;
    this._clientInitialized = false;
  }

  definirPassosTransacao(passos) {
    this._orq.definirDriver(new DestaxaTransacaoMockDriver(passos));
    this._orq.definirPermissaoTransacaoReal(true);
  }

  forcarCodigoInit(codigo) {
    this._codigoInitForcado = String(codigo || 'FF').toUpperCase();
  }

  async _comVoo(fn) {
    if (this._estadoHost === 'STOPPED' || this._estadoHost === 'CRASHED') {
      return respostaErro(HARNESS_ERROS.HOST_ENCERRADO, 'Native Host simulado encerrado', {
        hostError: ERROS_HOST.HOST_OFFLINE
      });
    }
    if (this._emVoo) {
      return respostaErro(HARNESS_ERROS.HOST_BUSY, 'Requisição em voo — operação não enviada', {
        hostError: ERROS_HOST.HOST_BUSY
      });
    }
    this._emVoo = true;
    try {
      return await fn();
    } finally {
      this._emVoo = false;
    }
  }

  async load() {
    return this._comVoo(async () => {
      this.contadores.load += 1;
      this._loaded = true;
      // LOAD zera sessão de client (espelha DestaxaNativeBridge.load)
      this._clientInitialized = false;
      this._clientCodigo = null;
      return { sucesso: true, estado: 'EXPORTS_VALID', hostId: this.hostId };
    });
  }

  async initClient(_config = {}) {
    if (this._initEmAndamento) {
      return respostaErro(HARNESS_ERROS.INIT_CONCORRENTE, 'INIT já em andamento nesta sessão');
    }
    return this._comVoo(async () => {
      this._initEmAndamento = true;
      try {
        if (!this._loaded) {
          this._loaded = true;
          this.contadores.load += 1;
        }
        this.contadores.init += 1;
        const codigo = this._codigoInitForcado;
        const ok = codigo === CODIGO_CLIENT_OK;
        this._clientInitialized = ok;
        this._clientCodigo = codigo;
        return {
          sucesso: ok,
          codigoDestaxa: codigo,
          estado: ok ? 'CLIENT_INITIALIZED' : 'CLIENT_ERROR',
          hostId: this.hostId
        };
      } finally {
        this._initEmAndamento = false;
      }
    });
  }

  async enableReal() {
    return this._comVoo(async () => {
      this.contadores.enableReal += 1;
      // Em simulado o "enable" não consulta o gate financeiro real —
      // o harness controla se TX real seria chamada.
      this._enableReal = true;
      return { sucesso: true, simulado: true };
    });
  }

  async txStart(operacao, campos, transactionId) {
    if (this._reconciliacaoPendente) {
      return respostaErro(
        HARNESS_ERROS.RECONCILIACAO_PENDENTE,
        `Reconciliação pendente (${this._reconciliacaoPendente.transactionId}) — nova cobrança bloqueada`,
        { hostError: ERROS_HOST.HOST_RECONCILIATION_PENDING }
      );
    }
    return this._comVoo(async () => {
      this.contadores.txStart += 1;
      if (!this._clientInitialized || this._clientCodigo !== CODIGO_CLIENT_OK) {
        return respostaErro(HARNESS_ERROS.INIT_FALHOU, 'Client não inicializado — TX_START bloqueado');
      }
      if (!this._enableReal) {
        return respostaErro(
          HARNESS_ERROS.GATE_OFF_BLOQUEIA_TX_REAL,
          'ENABLE_REAL não preparado nesta sessão simulada'
        );
      }
      const r = this._orq.iniciarTransacao(operacao, campos, { transactionId });
      if (r.codigoDestaxa === '08' || r.financialState === 'UNKNOWN' || r.estado === 'TIMEOUT') {
        this._reconciliacaoPendente = {
          transactionId: r.contexto?.transactionId || transactionId,
          motivo: 'TIMEOUT_INCONCLUSIVO'
        };
      }
      return r;
    });
  }

  async txContinue(resposta, transactionId) {
    if (this._reconciliacaoPendente) {
      return respostaErro(
        HARNESS_ERROS.RECONCILIACAO_PENDENTE,
        'Reconciliação pendente — continuidade bloqueada'
      );
    }
    return this._comVoo(async () => {
      this.contadores.txContinue += 1;
      const ctx = this._orq.getContexto();
      if (transactionId && ctx?.transactionId && String(ctx.transactionId) !== String(transactionId)) {
        return respostaErro(ERROS_HOST.HOST_TRANSACTION_MISMATCH, 'transactionId diverge do contexto ativo');
      }
      const r = this._orq.continuarTransacao(resposta);
      if (r.codigoDestaxa === '08' || r.financialState === 'UNKNOWN') {
        this._reconciliacaoPendente = {
          transactionId: r.contexto?.transactionId || transactionId,
          motivo: 'TIMEOUT_INCONCLUSIVO'
        };
      }
      return r;
    });
  }

  async txFinalize(confirmacao, transactionId) {
    return this._comVoo(async () => {
      this.contadores.txFinalize += 1;
      const ctx = this._orq.getContexto();
      if (transactionId && ctx?.transactionId && String(ctx.transactionId) !== String(transactionId)) {
        return respostaErro(ERROS_HOST.HOST_TRANSACTION_MISMATCH, 'transactionId diverge do contexto ativo');
      }
      return this._orq.finalizarTransacao(confirmacao);
    });
  }

  marcarTimeoutInconclusivo(transactionId) {
    this._reconciliacaoPendente = {
      transactionId: transactionId || novoId('tx'),
      motivo: 'TIMEOUT_INCONCLUSIVO'
    };
  }

  reconciliar(transactionId) {
    if (!this._reconciliacaoPendente) return { sucesso: true, jaLimpo: true };
    if (
      transactionId
      && String(this._reconciliacaoPendente.transactionId) !== String(transactionId)
    ) {
      return respostaErro(HARNESS_ERROS.RECONCILIACAO_PENDENTE, 'transactionId de reconciliação inválido');
    }
    this._reconciliacaoPendente = null;
    return { sucesso: true };
  }
}

class DestaxaHomologacaoCrtHarness {
  /**
   * @param {object} opcoes
   * @param {'simulado'|'controlado'} [opcoes.modo]
   * @param {HomologacaoSessaoSimulada|object} [opcoes.sessao]
   * @param {object} [opcoes.config] - { ambiente, provedor }
   * @param {object} [opcoes.vspague] - { detectado, executando, responding }
   * @param {boolean} [opcoes.exigirGateOffNestaSprint] - default true
   */
  constructor(opcoes = {}) {
    this.modo = opcoes.modo === 'controlado' ? 'controlado' : 'simulado';
    this.config = {
      provedor: String(opcoes.config?.provedor || 'destaxa').toLowerCase(),
      ambiente: String(opcoes.config?.ambiente || AMBIENTE_TRANSACAO_REAL).toLowerCase()
    };
    this.vspague = opcoes.vspague || { detectado: true, executando: true, responding: true };
    this.exigirGateOffNestaSprint = opcoes.exigirGateOffNestaSprint !== false;
    this.sessao = opcoes.sessao || new HomologacaoSessaoSimulada(opcoes.sessaoOpcoes || {});
    this.harnessRunId = novoId('homolog');
    this.transactionId = null;
    this.estado = ESTADOS_HARNESS.CRIADO;
    this.historico = [];
    this._txStartExecutado = false;
    this._resultadoFinal = null;
    this.caminhoProducao = false; // harness nunca é caminho de produção
  }

  _registrar(etapa, detalhe = {}) {
    const entrada = { etapa, em: new Date().toISOString(), ...detalhe };
    this.historico.push(entrada);
    return entrada;
  }

  _bloquearSeHostMorto() {
    const st = this.sessao.getEstado?.() || {};
    if (st.estado === 'STOPPED' || st.estado === 'CRASHED' || this.estado === ESTADOS_HARNESS.HOST_ENCERRADO) {
      this.estado = ESTADOS_HARNESS.HOST_ENCERRADO;
      return respostaErro(HARNESS_ERROS.HOST_ENCERRADO, 'Host encerrado — continuidade bloqueada');
    }
    return null;
  }

  /**
   * Etapas 1–3: ambiente, valor, V$Pague. Sem LOAD/INIT/TX.
   */
  validarAmbiente(opcoes = {}) {
    if (this.caminhoProducao === true) {
      return respostaErro(HARNESS_ERROS.CAMINHO_PRODUCAO, 'Harness não pode ser caminho de produção');
    }

    if (this.modo === 'controlado' && !envAtiva(HARNESS_ENV)) {
      return respostaErro(
        HARNESS_ERROS.DESABILITADO,
        `Modo controlado exige ${HARNESS_ENV}=1`
      );
    }
    if (this.modo === 'simulado' && !envAtiva(HARNESS_SIM_ENV) && opcoes.exigirEnvSimulado === true) {
      return respostaErro(
        HARNESS_ERROS.DESABILITADO,
        `Modo simulado exige ${HARNESS_SIM_ENV}=1`
      );
    }

    const ambiente = String(opcoes.ambiente || this.config.ambiente).toLowerCase();
    if (ambiente === 'producao' || ambiente === 'produção') {
      this.estado = ESTADOS_HARNESS.BLOQUEADO;
      return respostaErro(HARNESS_ERROS.PRODUCAO_PROIBIDA, 'Ambiente produção proibido no harness de homologação');
    }
    if (ambiente !== AMBIENTE_TRANSACAO_REAL) {
      this.estado = ESTADOS_HARNESS.BLOQUEADO;
      return respostaErro(
        HARNESS_ERROS.AMBIENTE_INVALIDO,
        `Ambiente deve ser ${AMBIENTE_TRANSACAO_REAL}; recebido ${ambiente}`
      );
    }

    const valorCentavos = opcoes.valorCentavos != null
      ? Number(opcoes.valorCentavos)
      : VALOR_HOMOLOGACAO_CENTAVOS;
    if (valorCentavos !== VALOR_HOMOLOGACAO_CENTAVOS) {
      this.estado = ESTADOS_HARNESS.BLOQUEADO;
      return respostaErro(
        HARNESS_ERROS.VALOR_INVALIDO,
        `Valor fixo de homologação: ${VALOR_HOMOLOGACAO_CENTAVOS} centavos (R$1,00)`
      );
    }

    const operacao = String(opcoes.operacao || OPERACOES.CRT).toUpperCase();
    if (operacao !== OPERACOES.CRT || !OPERACOES_REAIS_PERMITIDAS.includes(operacao)) {
      this.estado = ESTADOS_HARNESS.BLOQUEADO;
      return respostaErro(HARNESS_ERROS.OPERACAO_INVALIDA, `Somente CRT permitido; recebido ${operacao}`);
    }

    const vs = opcoes.vspague || this.vspague;
    if (!vs?.detectado || !vs?.executando || vs.responding === false) {
      this.estado = ESTADOS_HARNESS.BLOQUEADO;
      return respostaErro(HARNESS_ERROS.VSPAGUE_INDISPONIVEL, 'V$Pague Client indisponível');
    }

    if (this.exigirGateOffNestaSprint && transacaoRealHabilitada()) {
      this.estado = ESTADOS_HARNESS.BLOQUEADO;
      return respostaErro(
        HARNESS_ERROS.GATE_DEVE_ESTAR_OFF_NA_SPRINT,
        `${REAL_TRANSACTION_ENV} deve permanecer OFF nesta sprint de implementação`
      );
    }

    this.config.ambiente = ambiente;
    this.estado = ESTADOS_HARNESS.AMBIENTE_OK;
    this._registrar('validarAmbiente', { ambiente, valorCentavos, operacao, modo: this.modo });
    return {
      sucesso: true,
      ambiente,
      valorCentavos,
      operacao,
      modo: this.modo,
      hostId: this.sessao.hostId || this.sessao.getEstado?.().hostId
    };
  }

  /**
   * Etapas 4–7: obter host (já injetado), LOAD se necessário, INIT único se necessário.
   */
  async prepararSessao(configInit = {}) {
    const morto = this._bloquearSeHostMorto();
    if (morto) return morto;
    if (this.estado === ESTADOS_HARNESS.BLOQUEADO) {
      return respostaErro(HARNESS_ERROS.AMBIENTE_INVALIDO, 'Ambiente não validado ou bloqueado');
    }
    if (this.estado === ESTADOS_HARNESS.CRIADO) {
      const v = this.validarAmbiente();
      if (!v.sucesso) return v;
    }

    const st = this.sessao.getEstado();
    this.estado = ESTADOS_HARNESS.HOST_PRONTO;
    this._registrar('obterHost', { hostId: st.hostId });

    if (!st.loaded) {
      const load = await this.sessao.load();
      this._registrar('load', { sucesso: load.sucesso !== false, hostId: st.hostId });
      if (load.sucesso === false) {
        this.estado = ESTADOS_HARNESS.BLOQUEADO;
        return load;
      }
      this.estado = ESTADOS_HARNESS.LOADED;
    } else {
      this.estado = ESTADOS_HARNESS.LOADED;
      this._registrar('load', { pulado: true, jaCarregada: true });
    }

    const st2 = this.sessao.getEstado();
    if (st2.clientInitialized && st2.clientCodigo === CODIGO_CLIENT_OK) {
      this.estado = ESTADOS_HARNESS.CLIENT_INITIALIZED;
      this._registrar('init', { pulado: true, codigoDestaxa: st2.clientCodigo });
      return {
        sucesso: true,
        codigoDestaxa: st2.clientCodigo,
        hostId: st2.hostId,
        initExecutado: false
      };
    }

    const init = await this.sessao.initClient({
      ...this.config,
      ...configInit
    });
    this._registrar('init', {
      sucesso: init.sucesso === true,
      codigoDestaxa: init.codigoDestaxa || null,
      hostId: this.sessao.getEstado().hostId
    });

    if (!init.sucesso || init.codigoDestaxa !== CODIGO_CLIENT_OK) {
      this.estado = ESTADOS_HARNESS.BLOQUEADO;
      return respostaErro(
        HARNESS_ERROS.INIT_FALHOU,
        `INIT falhou (${init.codigoDestaxa || init.codigo}) — TX_START bloqueado`,
        { init }
      );
    }

    this.estado = ESTADOS_HARNESS.CLIENT_INITIALIZED;
    return {
      sucesso: true,
      codigoDestaxa: init.codigoDestaxa,
      hostId: this.sessao.getEstado().hostId,
      initExecutado: true
    };
  }

  /**
   * Etapa 8: preparar ENABLE_REAL (simulado ou futuro controlado).
   * Em modo simulado com exigirGateOffNestaSprint, não exige gate ON.
   * Em modo controlado futuro, ENABLE_REAL real exigirá gate ON no momento da TX.
   */
  async prepararEnableReal() {
    const morto = this._bloquearSeHostMorto();
    if (morto) return morto;
    if (this.estado !== ESTADOS_HARNESS.CLIENT_INITIALIZED
      && this.estado !== ESTADOS_HARNESS.PRONTO_PARA_TX) {
      return respostaErro(HARNESS_ERROS.INIT_FALHOU, 'ENABLE_REAL exige CLIENT_INITIALIZED');
    }

    if (this.modo === 'controlado' && !transacaoRealHabilitada()) {
      return respostaErro(
        HARNESS_ERROS.GATE_OFF_BLOQUEIA_TX_REAL,
        `${REAL_TRANSACTION_ENV}!=1 — ENABLE_REAL real bloqueado (esperado até a sprint de execução)`
      );
    }

    const r = await this.sessao.enableReal();
    this._registrar('enableReal', { sucesso: r.sucesso === true, modo: this.modo });
    if (!r.sucesso) {
      this.estado = ESTADOS_HARNESS.BLOQUEADO;
      return r;
    }
    this.estado = ESTADOS_HARNESS.PRONTO_PARA_TX;
    return { sucesso: true, modo: this.modo };
  }

  /**
   * Etapas 9–10: TX_START CRT uma única vez — sem retry automático.
   */
  async iniciarCrt(opcoes = {}) {
    const morto = this._bloquearSeHostMorto();
    if (morto) return morto;

    if (this._txStartExecutado) {
      return respostaErro(
        HARNESS_ERROS.TX_START_JA_EXECUTADO,
        'TX_START já executado neste harness — sem repetição automática'
      );
    }

    const st = this.sessao.getEstado();
    if (st.reconciliacaoPendente) {
      this.estado = ESTADOS_HARNESS.INCONCLUSIVO;
      return respostaErro(
        HARNESS_ERROS.RECONCILIACAO_PENDENTE,
        'Resultado inconclusivo anterior — nova cobrança bloqueada até reconciliação'
      );
    }

    if (this.estado !== ESTADOS_HARNESS.PRONTO_PARA_TX) {
      return respostaErro(HARNESS_ERROS.INIT_FALHOU, 'Sessão não está PRONTO_PARA_TX');
    }

    // Modo controlado: gate deve estar ON no momento da TX real.
    // Modo simulado nesta sprint: TX mock sem DLL; gate permanece OFF.
    if (this.modo === 'controlado') {
      if (!transacaoRealHabilitada()) {
        return respostaErro(
          HARNESS_ERROS.GATE_OFF_BLOQUEIA_TX_REAL,
          'Gate OFF bloqueia TX_START real'
        );
      }
      // Caminho real não executado nesta sprint — defesa em profundidade
      return respostaErro(
        HARNESS_ERROS.GATE_DEVE_ESTAR_OFF_NA_SPRINT,
        'MRT-20: execução financeira real do harness controlado não liberada nesta sprint'
      );
    }

    this.transactionId = opcoes.transactionId || novoId('tx_homolog');
    const entrada = buildCrtInput({ valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS });
    this._txStartExecutado = true;

    const r = await this.sessao.txStart(OPERACOES.CRT, entrada.campos, this.transactionId);
    this._registrar('txStart', {
      sucesso: r.sucesso === true,
      codigoDestaxa: r.codigoDestaxa || r.codigo || null,
      requerContinuacao: r.requerContinuacao === true,
      transactionId: this.transactionId,
      hostId: this.sessao.getEstado().hostId
    });

    if (r.codigo === HARNESS_ERROS.HOST_BUSY || r.hostError === ERROS_HOST.HOST_BUSY) {
      // Não chegou ao provedor — libera a flag para nova tentativa explícita (não automática).
      this._txStartExecutado = false;
      return r;
    }

    if (r.codigo === HARNESS_ERROS.HOST_ENCERRADO || r.hostError === ERROS_HOST.HOST_OFFLINE) {
      this.estado = ESTADOS_HARNESS.HOST_ENCERRADO;
      return r;
    }

    if (r.codigo === HARNESS_ERROS.RECONCILIACAO_PENDENTE
      || r.hostError === ERROS_HOST.HOST_RECONCILIATION_PENDING) {
      this.estado = ESTADOS_HARNESS.INCONCLUSIVO;
      return r;
    }

    if (r.codigo === HARNESS_ERROS.INIT_FALHOU) {
      this.estado = ESTADOS_HARNESS.BLOQUEADO;
      return r;
    }

    const codigo = r.codigoDestaxa || r.codigo;
    if (codigo === '08' || r.financialState === 'UNKNOWN' || this.sessao.getEstado().reconciliacaoPendente) {
      this.estado = ESTADOS_HARNESS.INCONCLUSIVO;
      this._resultadoFinal = { ...r, inconclusivo: true, retryAllowed: false };
      return {
        ...r,
        sucesso: false,
        retryAllowed: false,
        inconclusivo: true,
        mensagem: r.mensagem || 'Timeout/inconclusivo — nova tentativa bloqueada até reconciliação'
      };
    }

    if (r.requerContinuacao === true || codigo === '99') {
      this.estado = ESTADOS_HARNESS.AGUARDANDO_CONTINUACAO;
      return { ...r, retryAllowed: false, transactionId: this.transactionId };
    }

    if (r.sucesso === true || r.classificacao === CLASSIFICACAO_CODIGO.SUCCESS || codigo === '00') {
      this.estado = ESTADOS_HARNESS.AGUARDANDO_FINALIZACAO;
      return { ...r, retryAllowed: false, transactionId: this.transactionId, requerFinalizacao: true };
    }

    this.estado = ESTADOS_HARNESS.CONCLUIDO;
    this._resultadoFinal = { ...r, retryAllowed: false };
    return { ...r, retryAllowed: false, transactionId: this.transactionId };
  }

  /**
   * Etapas 11–12: continuação explícita após 99 — sem auto-loop.
   */
  async continuar(resposta = {}) {
    const morto = this._bloquearSeHostMorto();
    if (morto) return morto;

    if (this.estado === ESTADOS_HARNESS.INCONCLUSIVO) {
      return respostaErro(
        HARNESS_ERROS.RECONCILIACAO_PENDENTE,
        'Estado inconclusivo — continuidade bloqueada'
      );
    }
    if (this.estado !== ESTADOS_HARNESS.AGUARDANDO_CONTINUACAO) {
      return respostaErro(
        HARNESS_ERROS.CONTINUACAO_NAO_PERMITIDA,
        `continuar() só após retorno 99; estado=${this.estado}`
      );
    }

    const r = await this.sessao.txContinue(resposta, this.transactionId);
    this._registrar('txContinue', {
      codigoDestaxa: r.codigoDestaxa || r.codigo || null,
      requerContinuacao: r.requerContinuacao === true
    });

    if (r.codigo === HARNESS_ERROS.HOST_ENCERRADO || r.hostError === ERROS_HOST.HOST_OFFLINE) {
      this.estado = ESTADOS_HARNESS.HOST_ENCERRADO;
      return r;
    }
    if (r.codigo === HARNESS_ERROS.HOST_BUSY) return r;

    const codigo = r.codigoDestaxa || r.codigo;
    if (codigo === '08' || r.financialState === 'UNKNOWN' || this.sessao.getEstado().reconciliacaoPendente) {
      this.estado = ESTADOS_HARNESS.INCONCLUSIVO;
      this._resultadoFinal = { ...r, inconclusivo: true, retryAllowed: false };
      return { ...r, retryAllowed: false, inconclusivo: true };
    }
    if (r.requerContinuacao === true || codigo === '99') {
      this.estado = ESTADOS_HARNESS.AGUARDANDO_CONTINUACAO;
      return { ...r, retryAllowed: false, transactionId: this.transactionId };
    }
    if (r.sucesso === true || codigo === '00') {
      this.estado = ESTADOS_HARNESS.AGUARDANDO_FINALIZACAO;
      return { ...r, retryAllowed: false, requerFinalizacao: true, transactionId: this.transactionId };
    }

    this.estado = ESTADOS_HARNESS.CONCLUIDO;
    this._resultadoFinal = { ...r, retryAllowed: false };
    return { ...r, retryAllowed: false };
  }

  /**
   * Etapa 13–14: TX_FINALIZE somente quando o fluxo exigir.
   */
  async finalizar(confirmacao = FINALIZACAO_CONFIRMAR) {
    const morto = this._bloquearSeHostMorto();
    if (morto) return morto;

    if (this.estado !== ESTADOS_HARNESS.AGUARDANDO_FINALIZACAO) {
      return respostaErro(
        HARNESS_ERROS.FINALIZACAO_NAO_PERMITIDA,
        `finalizar() somente em AGUARDANDO_FINALIZACAO; estado=${this.estado}`
      );
    }

    const conf = Number(confirmacao);
    if (conf !== FINALIZACAO_CONFIRMAR && conf !== FINALIZACAO_CANCELAR) {
      return respostaErro(HARNESS_ERROS.OPERACAO_INVALIDA, 'confirmacao deve ser 0 ou 9');
    }

    const r = await this.sessao.txFinalize(conf, this.transactionId);
    this._registrar('txFinalize', {
      confirmacao: conf,
      codigoDestaxa: r.codigoDestaxa || r.codigo || null,
      sucesso: r.sucesso === true
    });

    this.estado = ESTADOS_HARNESS.CONCLUIDO;
    this._resultadoFinal = {
      ...r,
      retryAllowed: false,
      confirmacao: conf,
      transactionId: this.transactionId,
      hostId: this.sessao.getEstado().hostId,
      harnessRunId: this.harnessRunId
    };
    return this._resultadoFinal;
  }

  /**
   * Simula timeout inconclusivo sem repetir TX_START.
   */
  registrarTimeoutInconclusivo() {
    const txId = this.transactionId || novoId('tx_timeout');
    this.transactionId = txId;
    if (typeof this.sessao.marcarTimeoutInconclusivo === 'function') {
      this.sessao.marcarTimeoutInconclusivo(txId);
    }
    this.estado = ESTADOS_HARNESS.INCONCLUSIVO;
    this._resultadoFinal = {
      sucesso: false,
      codigo: '08',
      inconclusivo: true,
      retryAllowed: false,
      transactionId: txId,
      mensagem: 'Timeout inconclusivo — nova cobrança bloqueada até reconciliação'
    };
    this._registrar('timeoutInconclusivo', { transactionId: txId });
    return this._resultadoFinal;
  }

  async tentarNovaCobrancaAposInconclusivo() {
    if (this.estado !== ESTADOS_HARNESS.INCONCLUSIVO
      && !this.sessao.getEstado().reconciliacaoPendente) {
      return respostaErro(HARNESS_ERROS.OPERACAO_INVALIDA, 'Sem inconclusivo pendente');
    }
    // Força bloqueio mesmo se flags internas permitissem
    this._txStartExecutado = false;
    this.estado = ESTADOS_HARNESS.PRONTO_PARA_TX;
    const r = await this.iniciarCrt({ transactionId: novoId('tx_retry_proibido') });
    if (r.codigo !== HARNESS_ERROS.RECONCILIACAO_PENDENTE
      && !this.sessao.getEstado().reconciliacaoPendente) {
      // iniciarCrt pode ter passado se reconciliacao não estiver na sessão —
      // garantir bloqueio explícito
      return respostaErro(
        HARNESS_ERROS.RECONCILIACAO_PENDENTE,
        'Nova cobrança bloqueada por resultado inconclusivo'
      );
    }
    return r.codigo === HARNESS_ERROS.RECONCILIACAO_PENDENTE
      ? r
      : respostaErro(
        HARNESS_ERROS.RECONCILIACAO_PENDENTE,
        'Nova cobrança bloqueada por resultado inconclusivo',
        { tentativa: r }
      );
  }

  getSnapshot() {
    return {
      provider: PROVIDER,
      modo: this.modo,
      estado: this.estado,
      harnessRunId: this.harnessRunId,
      transactionId: this.transactionId,
      host: this.sessao.getEstado?.() || null,
      historico: [...this.historico],
      resultadoFinal: this._resultadoFinal,
      contadores: this.sessao.contadores || null,
      gateAberto: transacaoRealHabilitada(),
      caminhoProducao: false
    };
  }
}

module.exports = {
  DestaxaHomologacaoCrtHarness,
  HomologacaoSessaoSimulada,
  HARNESS_ENV,
  HARNESS_SIM_ENV,
  HARNESS_ERROS,
  ESTADOS_HARNESS,
  FINALIZACAO_CONFIRMAR,
  FINALIZACAO_CANCELAR
};
