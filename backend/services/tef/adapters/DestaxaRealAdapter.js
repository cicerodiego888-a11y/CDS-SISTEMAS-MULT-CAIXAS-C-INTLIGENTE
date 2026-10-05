'use strict';

const BaseAdapter = require('./BaseAdapter');
const tefContrato = require('../tefContrato');
const DestaxaNativeBridge = require('../destaxa/DestaxaNativeBridge');
const DestaxaHostBridge = require('../destaxa/DestaxaHostBridge');
const { normalizarTipoTef } = require('../tefFluxoPagamento');
const {
  buildCrtInput,
  valorReaisParaCentavos,
  parseParametrosDestaxa
} = require('../destaxa/destaxaProtocolo');
const {
  PROVIDER,
  ESTADOS,
  ERROS,
  OPERACOES,
  OPERACOES_REAIS_PERMITIDAS,
  VALOR_HOMOLOGACAO_CENTAVOS,
  AMBIENTE_TRANSACAO_REAL,
  REAL_TRANSACTION_ENV,
  CLASSIFICACAO_CODIGO,
  CODIGO_CLIENT_OK,
  EXPORTS_OBRIGATORIOS,
  FINALIZACAO_CONFIRMAR,
  FINALIZACAO_CANCELAR,
  DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO,
  transacaoRealHabilitada
} = require('../destaxa/destaxaConstantes');

const READINESS_REAL = 'READY_FOR_REAL_TRANSACTION';

const TIPOS_CRT = new Set([
  '',
  'credito',
  'debito',
  'cartao',
  'cartao_credito',
  'cartao_debito',
  'tef'
]);

const STATUS_POR_CLASSIFICACAO = Object.freeze({
  [CLASSIFICACAO_CODIGO.SUCCESS]: tefContrato.STATUS.APROVADO,
  [CLASSIFICACAO_CODIGO.DENIED]: tefContrato.STATUS.NEGADO,
  [CLASSIFICACAO_CODIGO.ACTION_REQUIRED]: tefContrato.STATUS.PENDENTE,
  [CLASSIFICACAO_CODIGO.TIMEOUT]: tefContrato.STATUS.PENDENTE,
  [CLASSIFICACAO_CODIGO.UNKNOWN]: tefContrato.STATUS.PENDENTE,
  [CLASSIFICACAO_CODIGO.UNCONFIRMED]: tefContrato.STATUS.PENDENTE,
  [CLASSIFICACAO_CODIGO.BLOCKED]: tefContrato.STATUS.PENDENTE
});

/**
 * Adapter real Destaxa — adapta o contrato TEF do CDS ao DestaxaNativeBridge.
 * Não contém FFI/DLL. Operação real: somente CRT, somente homologação,
 * somente R$1,00 e somente com DESTAXA_REAL_TRANSACTION_ENABLED=1.
 */
class DestaxaRealAdapter extends BaseAdapter {
  constructor(config = {}, opcoes = {}) {
    super(config);
    this.nome = 'Destaxa';
    this.modo = 'real';
    if (opcoes.bridge) {
      this.bridge = opcoes.bridge;
    } else if (DestaxaRealAdapter.usaHostNativo(opcoes)) {
      this.bridge = new DestaxaHostBridge({ client: opcoes.hostClient, config });
    } else {
      this.bridge = new DestaxaNativeBridge({
        config,
        nativeLoader: opcoes.nativeLoader,
        resolver: opcoes.resolver,
        arch: opcoes.arch
      });
    }
    this.execucaoNativa = this.bridge instanceof DestaxaHostBridge ? 'native-host' : 'in-process';
    this.contratoTimeout = Object.freeze({
      resultadoTardio: true,
      cancelamentoFisico: false,
      autoridadeResultado: 'Client Destaxa (DLL)',
      timeoutGlobalDestaxa: DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO
    });
    // Carregados sob demanda: evitam abrir banco/PowerShell em testes de protocolo.
    this._configServiceInjetado = opcoes.configService || null;
    this._sdkDetectorInjetado = opcoes.sdkDetector || null;
  }

  /**
   * Execução nativa padrão no TEF Native Host (processo isolado). In-process
   * somente quando explicitado ou com loader/resolver injetados (testes/diagnóstico).
   */
  static usaHostNativo(opcoes = {}) {
    if (opcoes.executionMode === 'in-process') return false;
    if (opcoes.executionMode === 'native-host') return true;
    return !(opcoes.nativeLoader || opcoes.resolver);
  }

  /**
   * Disponibilidade do adapter real sem carregar a DLL: DLL resolvível para a
   * arquitetura do processo e módulo FFI (koffi) instalado.
   */
  static verificarDisponibilidade(config = {}, opcoes = {}) {
    const resolver = opcoes.resolver || require('../destaxa/destaxaDllResolver');
    const resolucao = resolver.resolverDll(config, { arch: opcoes.arch });
    if (!resolucao.sucesso) {
      return {
        disponivel: false,
        codigo: resolucao.codigo || ERROS.DESTAXA_REAL_ADAPTER_INDISPONIVEL,
        mensagem: resolucao.mensagem || 'DLL Destaxa indisponível',
        dllPath: resolucao.dllPath || null
      };
    }
    try {
      (opcoes.resolverModulo || require.resolve)('koffi');
    } catch (error) {
      return {
        disponivel: false,
        codigo: ERROS.DESTAXA_REAL_ADAPTER_INDISPONIVEL,
        mensagem: `Módulo koffi indisponível: ${error.message}`,
        dllPath: resolucao.dllPath
      };
    }
    return { disponivel: true, codigo: null, mensagem: null, dllPath: resolucao.dllPath };
  }

  _configService() {
    return this._configServiceInjetado || require('../tefConfigService');
  }

  _sdkDetector() {
    return this._sdkDetectorInjetado || require('../sdkDetector');
  }

  async diagnosticar() {
    await this.bridge.load();
    const atual = await this.bridge.getDiagnostics();
    const dllOk = atual.dllLoaded === true && atual.exportsValid === true;

    return tefContrato.criarRespostaDiagnostico({
      sucesso: dllOk,
      mensagem: dllOk
        ? (atual.clientInitialized
          ? 'Client Destaxa inicializado'
          : 'DLL Destaxa carregada e exports validados — Client ainda não inicializado; TEF não disponível para pagamento')
        : (atual.ultimoErro?.mensagem || 'Diagnóstico Destaxa incompleto'),
      detalhes: atual
    });
  }

  async testarConexao() {
    const client = await this.bridge.iniciarClient(this.config);
    return tefContrato.criarRespostaDiagnostico({
      sucesso: client.sucesso === true,
      mensagem: client.mensagem,
      detalhes: {
        ...client.diagnostico,
        codigoDestaxa: client.codigoDestaxa || null,
        estado: client.estado,
        entrada: client.entrada || null,
        tamanhoEntrada: client.tamanhoEntrada || null
      }
    });
  }

  _normalizarRespostaProtocolo(resultado) {
    if (!resultado) {
      return { sucesso: false, mensagem: 'Resposta Destaxa vazia' };
    }
    return {
      sucesso: resultado.sucesso === true,
      codigoDestaxa: resultado.codigoDestaxa || resultado.codigo || null,
      classificacao: resultado.classificacao || null,
      financialState: resultado.financialState || null,
      estado: resultado.estado || null,
      acao: resultado.acao || null,
      requerContinuacao: resultado.requerContinuacao === true,
      saida: resultado.saida || '',
      contexto: resultado.contexto || null,
      mensagem: resultado.descricao || resultado.mensagem || '',
      retryAllowed: resultado.retryAllowed === true,
      retryReason: resultado.retryReason || null,
      confirmacao: resultado.confirmacao,
      confirmacaoDescricao: resultado.confirmacaoDescricao
    };
  }

  configurarMockTransacao(passos) {
    return this.bridge.configurarDriverTransacaoMock(passos);
  }

  async iniciarTransacao(dados = {}) {
    const operacao = dados.operacao || dados.funcao || OPERACOES.CRT;
    const campos = dados.campos && typeof dados.campos === 'object' ? dados.campos : dados;
    const resultado = await this.bridge.iniciarTransacaoDestaxa(operacao, campos);
    return this._normalizarRespostaProtocolo(resultado);
  }

  async continuarTransacao(contexto = {}) {
    const resposta = contexto.resposta != null ? contexto : contexto.entrada || contexto;
    const resultado = await this.bridge.continuarTransacaoDestaxa(resposta);
    return this._normalizarRespostaProtocolo(resultado);
  }

  async finalizarTransacao(contexto = {}) {
    let confirmacao = contexto.confirmacao;
    if (confirmacao == null && contexto.confirmar === true) confirmacao = FINALIZACAO_CONFIRMAR;
    if (confirmacao == null && contexto.confirmar === false) confirmacao = FINALIZACAO_CANCELAR;
    const resultado = await this.bridge.finalizarTransacaoDestaxa(confirmacao);
    return this._normalizarRespostaProtocolo(resultado);
  }

  _resolverOperacao(dados = {}) {
    const explicita = dados.operacao || dados.funcao;
    if (explicita) return String(explicita).trim().toUpperCase();
    const tipo = normalizarTipoTef(dados.tipo);
    if (tipo === 'pix_tef') return OPERACOES.PIX;
    return TIPOS_CRT.has(tipo) ? OPERACOES.CRT : String(tipo).toUpperCase();
  }

  _resolverValorCentavos(dados = {}) {
    const porReais = dados.valor != null ? valorReaisParaCentavos(dados.valor) : null;
    if (dados.valor != null && porReais == null) return null;
    if (dados.valorCentavos == null) return porReais;
    const informado = Number(dados.valorCentavos);
    if (!Number.isSafeInteger(informado)) return null;
    if (porReais != null && porReais !== informado) return null;
    return informado;
  }

  _respostaBloqueio(codigo, mensagem, checks, extra = {}) {
    return {
      ...tefContrato.criarRespostaAutorizacao({
        sucesso: false,
        status: tefContrato.STATUS.ERRO,
        adquirente: PROVIDER,
        codigo,
        mensagem,
        modo: this.modo,
        retryAllowed: false,
        retryReason: codigo
      }),
      transacaoId: null,
      transactionAttempted: false,
      tipo_erro: extra.tipoErro || 'pre_condicao',
      readiness: extra.readiness || null,
      preparacao: checks
    };
  }

  /**
   * Validações do caminho CRT real + gate financeiro. Nunca chama funções
   * transacionais da DLL e nunca cria transactionId.
   * Pode carregar a DLL e chamar iniciaClientDestaxa (mesmo contrato da 06A).
   * @returns {Promise<{pronto: boolean, contexto?: object, resposta?: object}>}
   */
  async prepararAutorizacao(dados = {}) {
    const checks = {};
    const bloquear = (codigo, mensagem) => ({
      pronto: false,
      resposta: this._respostaBloqueio(codigo, mensagem, checks)
    });

    const provedor = String(this.config.provedor || '').trim().toLowerCase();
    checks.provider = provedor || null;
    if (provedor !== 'destaxa') {
      return bloquear(ERROS.DESTAXA_PROVIDER_INVALIDO, `Provider TEF ${provedor || '(vazio)'} não é Destaxa`);
    }

    const ambiente = String(this.config.ambiente || '').trim().toLowerCase();
    checks.environment = ambiente || null;
    if (ambiente !== AMBIENTE_TRANSACAO_REAL) {
      return bloquear(
        ERROS.DESTAXA_AMBIENTE_NAO_PERMITIDO,
        `Transação Destaxa real permitida somente em ${AMBIENTE_TRANSACAO_REAL}; recebido ${ambiente || '(vazio)'}`
      );
    }

    checks.adapterMode = this.modo;
    if (this.modo !== 'real') {
      return bloquear(ERROS.DESTAXA_INVALID_CONFIGURATION, 'Adapter Destaxa não está em modo real');
    }

    const operacao = this._resolverOperacao(dados);
    checks.operation = operacao;
    if (!OPERACOES_REAIS_PERMITIDAS.includes(operacao)) {
      return bloquear(
        ERROS.DESTAXA_OPERACAO_NAO_PERMITIDA,
        `Operação ${operacao} não permitida; somente ${OPERACOES_REAIS_PERMITIDAS.join(', ')}`
      );
    }

    const valorCentavos = this._resolverValorCentavos(dados);
    checks.valueCents = valorCentavos;
    if (valorCentavos !== VALOR_HOMOLOGACAO_CENTAVOS) {
      return bloquear(
        ERROS.DESTAXA_VALOR_NAO_PERMITIDO,
        `Homologação Destaxa real aceita somente ${VALOR_HOMOLOGACAO_CENTAVOS} centavos (R$1,00)`
      );
    }

    const configService = this._configService();
    const configTef = await configService.obterConfiguracao();
    const validacao = configService.validarConfiguracao(configTef, { modoAdapter: 'real' });
    const portaConfigurada = String(configTef?.portaCom || '').trim() || null;
    checks.configuration = {
      valid: validacao.valida === true,
      pendencias: validacao.pendencias || [],
      provider: String(configTef?.tefProvedor || '').toLowerCase() || null,
      pinpadEnabled: String(configTef?.pinpadHabilitado) === 'true' || configTef?.pinpadHabilitado === true,
      configuredPort: portaConfigurada
    };
    if (!checks.configuration.valid) {
      return bloquear(ERROS.DESTAXA_INVALID_CONFIGURATION, `Configuração TEF inválida: ${checks.configuration.pendencias.join('; ')}`);
    }
    if (checks.configuration.provider !== 'destaxa') {
      return bloquear(ERROS.DESTAXA_PROVIDER_INVALIDO, 'Configuração TEF persistida não usa provider Destaxa');
    }
    if (!checks.configuration.pinpadEnabled || !portaConfigurada) {
      return bloquear(ERROS.DESTAXA_INVALID_CONFIGURATION, 'PinPad não habilitado ou sem porta COM configurada');
    }

    if (!(await this.bridge.isLoaded())) {
      const carga = await this.bridge.load();
      if (!carga.sucesso) {
        checks.dll = { loaded: false, exports: 0 };
        return bloquear(carga.codigo || ERROS.DESTAXA_DLL_LOAD_FAILED, carga.mensagem || 'Falha ao carregar DLL Destaxa');
      }
    }
    let diag = await this.bridge.getDiagnostics();
    checks.nativeExecution = this.execucaoNativa;
    if (this.bridge instanceof DestaxaHostBridge) {
      const host = this.bridge.client.getEstado();
      checks.nativeHost = { state: host.estado, pid: host.pid, processType: host.processType };
    }
    checks.dll = {
      loaded: diag.dllLoaded === true,
      exportsValid: diag.exportsValid === true,
      exports: EXPORTS_OBRIGATORIOS.filter((nome) => diag.exports?.[nome] === true).length,
      path: diag.dllPath || null
    };
    if (!checks.dll.loaded || !checks.dll.exportsValid) {
      return bloquear(ERROS.DESTAXA_EXPORT_MISSING, 'DLL Destaxa sem os quatro exports obrigatórios');
    }

    if (!diag.clientInitialized) {
      await this.bridge.iniciarClient(this.config);
      diag = await this.bridge.getDiagnostics();
    }
    checks.client = {
      initialized: diag.clientInitialized === true && diag.estado === ESTADOS.CLIENT_INITIALIZED,
      clientInitializationCode: diag.clientResultCode || null,
      state: diag.estado
    };
    if (!checks.client.initialized || checks.client.clientInitializationCode !== CODIGO_CLIENT_OK) {
      return bloquear(
        ERROS.DESTAXA_CLIENT_INIT_FAILED,
        `iniciaClientDestaxa não retornou 00/CLIENT_INITIALIZED: ${checks.client.clientInitializationCode}`
      );
    }

    const detector = this._sdkDetector();
    const vspague = detector.detectarVsPagueClient();
    checks.vspague = {
      found: vspague.detectado === true,
      running: vspague.executando === true,
      responding: vspague.responding !== false && vspague.responding != null,
      pid: vspague.pid != null ? String(vspague.pid) : null
    };
    if (!checks.vspague.found || !checks.vspague.running || !checks.vspague.responding) {
      return bloquear(ERROS.DESTAXA_VSPAGUE_INDISPONIVEL, 'VSPagueClient não está ativo e respondendo');
    }

    const pinpad = detector.detectarGertecPPC930({ portaConfigurada });
    checks.pinpad = {
      model: pinpad.modelo || null,
      port: pinpad.porta || null,
      configuredPort: portaConfigurada,
      detected: pinpad.detectado === true,
      state: pinpad.estado || null,
      usb: pinpad.usb === true
    };
    if (!checks.pinpad.detected) {
      return bloquear(ERROS.DESTAXA_PINPAD_NAO_DETECTADO, 'PinPad PPC930 não detectado');
    }
    if (String(checks.pinpad.port || '').toUpperCase() !== portaConfigurada.toUpperCase()) {
      return bloquear(
        ERROS.DESTAXA_PINPAD_NAO_DETECTADO,
        `PinPad detectado em ${checks.pinpad.port || '(sem porta)'}, configurado em ${portaConfigurada}`
      );
    }

    const entradaCrt = buildCrtInput({ valorCentavos });
    const gateAberto = transacaoRealHabilitada();
    checks.crt = { operation: OPERACOES.CRT, valueCents: valorCentavos, input: entradaCrt.texto };
    checks.realTransactionGate = { env: REAL_TRANSACTION_ENV, enabled: gateAberto };

    const contexto = {
      operacao: OPERACOES.CRT,
      valorCentavos,
      camposEntrada: entradaCrt.campos,
      clientInitializationCode: checks.client.clientInitializationCode,
      checks
    };

    if (!gateAberto) {
      return {
        pronto: false,
        readiness: READINESS_REAL,
        contexto,
        resposta: this._respostaBloqueio(
          ERROS.DESTAXA_REAL_TRANSACTION_DISABLED,
          `Caminho CRT real pronto; transação bloqueada pelo gate financeiro (${REAL_TRANSACTION_ENV} != 1)`,
          checks,
          { tipoErro: 'gate_financeiro', readiness: READINESS_REAL }
        )
      };
    }

    return { pronto: true, readiness: READINESS_REAL, contexto };
  }

  _mapearResultadoCrt(resultado, contexto) {
    const classificacao = resultado.classificacao || null;
    const status = STATUS_POR_CLASSIFICACAO[classificacao] || tefContrato.STATUS.ERRO;
    const parametros = parseParametrosDestaxa(resultado.saida);
    const acao = resultado.acao
      ? {
        tipo: resultado.acao.tipo || null,
        mensagem: resultado.acao.mensagem || '',
        opcoes: resultado.acao.opcoes || null,
        tipoDado: resultado.acao.tipoDado || null,
        mascara: resultado.acao.mascara || null
      }
      : null;

    return {
      ...tefContrato.criarRespostaAutorizacao({
        sucesso: resultado.sucesso === true,
        status,
        nsu: parametros.transacao_nsu || null,
        adquirente: PROVIDER,
        transacaoId: resultado.contexto?.transactionId || null,
        codigo: resultado.codigoDestaxa || resultado.codigo || null,
        mensagem: resultado.descricao || resultado.mensagem || '',
        payloadRetorno: {
          operacao: OPERACOES.CRT,
          codigoDestaxa: resultado.codigoDestaxa || null,
          estado: resultado.estado || null,
          acao,
          parametros
        },
        modo: this.modo,
        financialState: resultado.financialState || null,
        protocolState: resultado.estado || null,
        retryAllowed: false,
        retryReason: resultado.retryReason || null
      }),
      transactionAttempted: true,
      requerContinuacao: resultado.requerContinuacao === true,
      requerFinalizacao: classificacao === CLASSIFICACAO_CODIGO.SUCCESS,
      acao,
      clientInitializationCode: contexto.clientInitializationCode,
      transactionCode: resultado.codigoDestaxa || null
    };
  }

  /**
   * CRT real: validações → gate → DestaxaTransacaoOrquestrador → iniciaTransacaoDestaxa.
   * Não finaliza automaticamente: após 00 o chamador decide finalizarTransacao(0|9).
   * @param {object} dados - { tipo, valor (reais) | valorCentavos }
   * @param {object} [preparacao] - resultado de prepararAutorizacao (+ transactionId)
   */
  async autorizarPagamento(dados = {}, preparacao = null) {
    const preparo = preparacao?.pronto === true ? preparacao : await this.prepararAutorizacao(dados);
    if (!preparo.pronto) {
      return preparo.resposta;
    }

    const habilitacao = await this.bridge.habilitarTransacaoReal();
    if (!habilitacao.sucesso) {
      return this._respostaBloqueio(habilitacao.codigo, habilitacao.mensagem, preparo.contexto.checks, {
        tipoErro: habilitacao.codigo === ERROS.DESTAXA_REAL_TRANSACTION_DISABLED ? 'gate_financeiro' : 'pre_condicao'
      });
    }

    const resultado = await this.bridge.iniciarTransacaoDestaxa(
      preparo.contexto.operacao,
      preparo.contexto.camposEntrada,
      { transactionId: preparacao?.transactionId || dados.transacao_id || null }
    );
    return this._mapearResultadoCrt(resultado, preparo.contexto);
  }

  async cancelarPagamento(dados) {
    const info = this._normalizarDadosCancelamento(dados);
    return tefContrato.criarRespostaCancelamento({
      sucesso: false,
      status: tefContrato.STATUS.ERRO,
      nsu: info.nsu,
      autorizacao: info.autorizacao,
      transacaoId: info.transacao_id,
      codigo: 'DESTAXA_TRANSACAO_NAO_IMPLEMENTADA',
      mensagem: 'TEF-DESTAXA-02: cancelamento Destaxa não implementado nesta sprint',
      modo: this.modo
    });
  }

  async status() {
    const diag = await this.diagnosticar();
    return {
      ativo: diag.detalhes?.clientInitialized === true,
      provedor: this.nome,
      modo: this.modo,
      estado: diag.detalhes?.estado || ESTADOS.DLL_NOT_FOUND,
      ...diag.detalhes
    };
  }
}

module.exports = DestaxaRealAdapter;
