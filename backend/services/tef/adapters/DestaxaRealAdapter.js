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
    const carregada = await this.bridge.isLoaded();
    if (!carregada) {
      await this.bridge.load();
    }
    const atual = await this.bridge.getDiagnostics();
    const dllOk = atual.dllLoaded === true && atual.exportsValid === true;

    return tefContrato.criarRespostaDiagnostico({
      sucesso: dllOk,
      mensagem: dllOk
        ? (atual.clientInitialized
          ? 'DLL validada e Client Destaxa inicializado; comunicação transacional não testada'
          : 'DLL Destaxa carregada e exports validados — Client ainda não inicializado')
        : (atual.ultimoErro?.mensagem || 'Diagnóstico Destaxa incompleto'),
      detalhes: {
        ...atual,
        transactionCommunicationValidated: false,
        authorizationAvailable: false
      }
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
        provedor: PROVIDER,
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
        provedor: PROVIDER,
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
   * CRT real (fluxo TefManager): validações → persistência obrigatória → gate → ciclo
   * completo no mesmo bridge/host: TX_START → (99 → TX_CONTINUE)* → TX_FINALIZE(0).
   * Não repete TX_START. Não trata 99 como aprovação. Timeout → inconclusivo (sem cancel).
   * MRT-27: chamada direta sem TefManager/persistência é bloqueada (exceto harness simulado gate OFF).
   * @param {object} dados - { tipo, valor | valorCentavos, respostasContinuidade?, venda_id? }
   * @param {object} [preparacao] - resultado de prepararAutorizacao (+ transactionId + persistenciaConfirmada)
   */
  async autorizarPagamento(dados = {}, preparacao = null) {
    const preparo = preparacao?.pronto === true ? preparacao : await this.prepararAutorizacao(dados);
    if (!preparo.pronto) {
      return preparo.resposta;
    }

    // MRT-27 — bloquear bypass de produção antes de qualquer chamada financeira à DLL
    const {
      validarPersistenciaAntesEnvioFinanceiro,
      ERROS_PERSISTENCIA
    } = require('../tefPersistenciaObrigatoria');
    const guardPersistencia = validarPersistenciaAntesEnvioFinanceiro(preparacao, dados, {
      gateOn: transacaoRealHabilitada()
    });
    if (!guardPersistencia.ok) {
      return this._respostaBloqueio(
        guardPersistencia.codigo || ERROS.TEF_PERSISTENCIA_OBRIGATORIA || ERROS_PERSISTENCIA.OBRIGATORIA,
        guardPersistencia.mensagem,
        preparo.contexto?.checks || {},
        { tipoErro: 'persistencia_obrigatoria' }
      );
    }

    // MRT-31 — evidência: Adapter aceitou identidade persistida (antes do gate/DLL)
    try {
      const { registrarEtapaFluxo, ETAPAS_FLUXO } = require('../destaxa/destaxaFluxoInstrumentacao');
      registrarEtapaFluxo(ETAPAS_FLUXO.ADAPTER_AUTORIZADO, {
        operation_id: preparacao?.operation_id || dados.operation_id || null,
        transactionId: guardPersistencia.transactionId,
        venda_id: dados.venda_id != null ? dados.venda_id : null,
        fingerprint: preparacao?.fingerprint || dados._fingerprint || null,
        provedor: 'destaxa'
      }, {
        persistenciaConfirmada: true,
        gateFinanceiro: transacaoRealHabilitada() === true,
        preparacaoPronta: true
      });
    } catch (_) { /* instrumentação best-effort */ }

    const habilitacao = await this.bridge.habilitarTransacaoReal();
    if (!habilitacao.sucesso) {
      return this._respostaBloqueio(habilitacao.codigo, habilitacao.mensagem, preparo.contexto.checks, {
        tipoErro: habilitacao.codigo === ERROS.DESTAXA_REAL_TRANSACTION_DISABLED ? 'gate_financeiro' : 'pre_condicao'
      });
    }

    const { executarCicloCrt } = require('../destaxa/destaxaCrtCicloOrquestracao');
    const transactionId = guardPersistencia.transactionId
      || preparacao?.transactionId
      || dados.transacao_id
      || null;
    const ciclo = await executarCicloCrt({
      bridge: this.bridge,
      operacao: preparo.contexto.operacao,
      camposEntrada: preparo.contexto.camposEntrada,
      transactionId,
      exigirPersistencia: true,
      respostasContinuidade: dados.respostasContinuidade || dados.continuidade || [],
      maxContinues: dados.maxContinuesCrt
    });

    const vinculo = {
      venda_id: dados.venda_id != null ? dados.venda_id : null,
      pdv_codigo: dados.pdv_codigo || dados.pdvCodigo || this.config.pdvCodigo || null,
      caixa_codigo: dados.caixa_codigo || dados.caixaCodigo || this.config.caixaCodigo || null,
      transactionId: ciclo.transactionId || transactionId
    };

    return this._mapearSaidaCiclo(ciclo, preparo.contexto, vinculo, transactionId);
  }

  _mapearSaidaCiclo(ciclo, contextoChecks, vinculo, transactionId) {
    const { CICLO_ERROS } = require('../destaxa/destaxaCrtCicloOrquestracao');
    const {
      normalizarAcaoContinuidade
    } = require('../destaxa/destaxaContinuidadeContrato');

    if (ciclo.inconclusivo === true || ciclo.reconciliacaoObrigatoria === true) {
      return {
        ...this._mapearResultadoCrt(ciclo.resultadoUltimo || {
          sucesso: false,
          codigoDestaxa: ciclo.codigoDestaxa,
          codigo: ciclo.codigo,
          mensagem: ciclo.mensagem,
          financialState: ciclo.financialState,
          estado: ciclo.estado,
          retryAllowed: false
        }, contextoChecks || {}),
        sucesso: false,
        status: tefContrato.STATUS.PENDENTE,
        codigo: ciclo.codigo || CICLO_ERROS.INCONCLUSIVO,
        mensagem: ciclo.mensagem,
        financialState: ciclo.financialState || 'UNKNOWN',
        retryAllowed: false,
        inconclusivo: true,
        reconciliacaoObrigatoria: true,
        transactionAttempted: true,
        cicloCrt: ciclo.ciclo,
        vinculoVendaPdv: vinculo
      };
    }

    if (ciclo.codigo === CICLO_ERROS.HOST_BUSY || ciclo.codigo === CICLO_ERROS.HOST_ENCERRADO) {
      return {
        ...this._respostaBloqueio(ciclo.codigo, ciclo.mensagem, contextoChecks?.checks || {}, {
          tipoErro: 'infraestrutura'
        }),
        transactionAttempted: ciclo.ciclo?.txStartExecutado === true,
        retryAllowed: false,
        cicloCrt: ciclo.ciclo,
        vinculoVendaPdv: vinculo
      };
    }

    if (ciclo.codigo === CICLO_ERROS.CONTINUIDADE_SEM_RESPOSTA || ciclo.requerContinuacao === true) {
      const acao = normalizarAcaoContinuidade(ciclo.acao || ciclo.resultadoUltimo?.acao);
      return {
        ...this._mapearResultadoCrt(ciclo.resultadoUltimo || {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          acao: ciclo.acao,
          mensagem: ciclo.mensagem,
          retryAllowed: false
        }, contextoChecks || {}),
        sucesso: false,
        status: tefContrato.STATUS.PENDENTE,
        codigo: ciclo.codigo || CICLO_ERROS.CONTINUIDADE_SEM_RESPOSTA,
        mensagem: ciclo.mensagem,
        retryAllowed: false,
        requerContinuacao: true,
        acao,
        transactionAttempted: true,
        cicloCrt: ciclo.ciclo,
        vinculoVendaPdv: vinculo
      };
    }

    if (ciclo.negado === true) {
      const mapeado = this._mapearResultadoCrt(ciclo.resultadoUltimo, contextoChecks || {});
      return {
        ...mapeado,
        sucesso: false,
        status: tefContrato.STATUS.NEGADO,
        retryAllowed: false,
        cicloCrt: ciclo.ciclo,
        vinculoVendaPdv: vinculo
      };
    }

    if (ciclo.sucesso === true && ciclo.conclusivo === true) {
      const mapeado = this._mapearResultadoCrt({
        ...(ciclo.resultadoUltimo || {}),
        sucesso: true,
        codigoDestaxa: ciclo.codigoDestaxa || '00',
        classificacao: CLASSIFICACAO_CODIGO.SUCCESS,
        financialState: ciclo.financialState || 'CONFIRMED_SUCCESS',
        contexto: {
          ...(ciclo.resultadoUltimo?.contexto || {}),
          transactionId: ciclo.transactionId || transactionId
        },
        retryAllowed: false
      }, contextoChecks || {});
      return {
        ...mapeado,
        sucesso: true,
        status: tefContrato.STATUS.APROVADO,
        retryAllowed: false,
        cicloCrt: ciclo.ciclo,
        vinculoVendaPdv: vinculo,
        requerFinalizacao: false,
        requerContinuacao: false
      };
    }

    return {
      ...this._mapearResultadoCrt(ciclo.resultadoUltimo || {
        sucesso: false,
        codigo: ciclo.codigo,
        mensagem: ciclo.mensagem,
        retryAllowed: false
      }, contextoChecks || {}),
      retryAllowed: false,
      cicloCrt: ciclo.ciclo,
      vinculoVendaPdv: vinculo
    };
  }

  /**
   * MRT-22 — Continuidade CRT (COLETA/OPCAO) no mesmo Native Host.
   * Não chama TX_START. Não gera nova cobrança.
   */
  async continuarPagamento(dados = {}) {
    const {
      continuarCicloCrt
    } = require('../destaxa/destaxaCrtCicloOrquestracao');
    const {
      validarRespostaOperador,
      normalizarAcaoContinuidade
    } = require('../destaxa/destaxaContinuidadeContrato');

    const transactionId = dados.transacao_id || dados.transacaoId || dados.transactionId || null;
    const acao = normalizarAcaoContinuidade(dados.acao);
    const validacao = validarRespostaOperador(acao, dados.resposta_continuidade ?? dados.resposta ?? dados.respostaOperador);
    if (!validacao.ok) {
      return {
        sucesso: false,
        status: tefContrato.STATUS.PENDENTE,
        codigo: validacao.codigo,
        mensagem: validacao.mensagem,
        retryAllowed: false,
        requerContinuacao: true,
        acao,
        transactionAttempted: true,
        vinculoVendaPdv: {
          venda_id: dados.venda_id != null ? dados.venda_id : null,
          transactionId
        }
      };
    }

    const ciclo = await continuarCicloCrt({
      bridge: this.bridge,
      transactionId,
      respostaOperador: validacao.resposta,
      respostasContinuidade: dados.respostasContinuidade || [],
      acaoAtual: acao,
      maxContinues: dados.maxContinuesCrt
    });

    const vinculo = {
      venda_id: dados.venda_id != null ? dados.venda_id : null,
      pdv_codigo: dados.pdv_codigo || dados.pdvCodigo || this.config.pdvCodigo || null,
      caixa_codigo: dados.caixa_codigo || dados.caixaCodigo || this.config.caixaCodigo || null,
      transactionId: ciclo.transactionId || transactionId
    };

    return this._mapearSaidaCiclo(ciclo, {}, vinculo, transactionId);
  }

  /**
   * TEF-17 — cancelamento/estorno comercial Destaxa.
   * Não executa EST nem INIT: campos de entrada EST não documentados.
   * finalizaTransacaoDestaxa(9) aborta tx corrente (docs/08) e NÃO é estorno.
   * Testes podem injetar resultadoProvedorSimulado sem chamar a DLL.
   */
  async cancelarPagamento(dados = {}, opcoes = {}) {
    const info = this._normalizarDadosCancelamento(dados);
    const {
      responderCancelamentoSeguro
    } = require('../destaxa/destaxaCancelamentoPolitica');

    return responderCancelamentoSeguro(
      {
        ...info,
        ...dados,
        transacao_id: info.transacao_id,
        nsu: info.nsu,
        autorizacao: info.autorizacao
      },
      {
        modo: this.modo,
        permitirSimulacaoProvedor: opcoes.permitirSimulacaoProvedor === true
          || opcoes.resultadoProvedorSimulado != null,
        resultadoProvedorSimulado: opcoes.resultadoProvedorSimulado
      }
    );
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
