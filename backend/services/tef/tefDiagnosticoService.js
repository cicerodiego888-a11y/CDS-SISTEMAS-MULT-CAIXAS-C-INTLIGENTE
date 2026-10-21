const sdkDetector = require('./sdkDetector');
const { obterAdapter } = require('./tefFactory');
const tefConfigService = require('./tefConfigService');
const pinpadCatalog = require('./pinpads/pinpadCatalog');
const { obterPinpad, reconhecerAutomaticamente } = require('./pinpads/PinpadFactory');
const {
  ESTADOS,
  ESTADOS_PREPARACAO
} = require('./destaxa/destaxaConstantes');
const db = require('../../database');

function promisifyGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

async function verificarBanco() {
  try {
    await promisifyGet('SELECT COUNT(*) AS total FROM tef_transacoes');
    return { acessivel: true, mensagem: 'Tabela tef_transacoes acessível' };
  } catch (error) {
    return { acessivel: false, mensagem: error.message };
  }
}

/**
 * Validação oficial via TefConfigService (fonte única).
 * Mantém export legado `validarConfiguracao(config, status)` para testes.
 */
function validarConfiguracao(config, status) {
  const resultado = tefConfigService.validarConfiguracao(config, {
    modoAdapter: tefConfigService.resolverModoAdapter(config?.tefAmbiente)
  });

  // Compat: se status indicar pinpad inválido e ainda não listado
  if (
    status?.pinpad?.habilitado &&
    !status.pinpad.configurado &&
    !resultado.pendencias.some((p) => /PinPad/i.test(p))
  ) {
    resultado.pendencias.push('PinPad habilitado sem parâmetros de conexão');
    resultado.valida = false;
  }

  return resultado;
}

function resolverStatusPinpad(
  provedor,
  middlewareInstalado,
  pinpadConfigurado,
  modoAdapter,
  opcoes = {}
) {
  if (opcoes.preConfigurado && opcoes.detectado !== true) {
    return 'AGUARDANDO_CONEXAO';
  }
  if (opcoes.detectado === true) {
    return ESTADOS_PREPARACAO.PINPAD_DETECTED;
  }
  if (!pinpadConfigurado) {
    return 'Não configurado';
  }
  if (modoAdapter === 'simulacao') {
    return 'Configurado (simulação)';
  }
  if (['sitef', 'paygo', 'destaxa'].includes(provedor)) {
    return middlewareInstalado ? 'Pronto para homologação' : 'Aguardando Middleware';
  }
  return 'Configurado (adapter provedor)';
}

function montarDiagnosticoPinpad(config, statusConfig, sdk, provedor, middlewareInstalado, modoAdapter) {
  const codigo = config.pinpadCodigo || config.pinpadModelo || statusConfig?.pinpad?.codigo || '';
  const meta = pinpadCatalog.resolver({
    codigo,
    fabricante: config.fabricante,
    modelo: config.modelo
  });
  const reconhecimento = reconhecerAutomaticamente({
    codigo,
    fabricante: config.fabricante,
    modelo: config.modelo
  });

  const middlewareNome = provedor === 'sitef'
    ? 'CliSiTef'
    : provedor === 'paygo'
      ? 'PayGo'
      : provedor === 'destaxa'
        ? 'Destaxa'
        : null;

  const pinpadHabilitado = config.pinpadHabilitado === 'true' || config.pinpadHabilitado === true;
  const preConfigurado = Boolean(meta || codigo);
  const pinpadConfigurado = pinpadHabilitado && Boolean(
    meta || codigo || config.portaCom || config.pinpadIp
  );

  const ehPpc930 = meta?.codigo === 'GERTEC_PPC930' || codigo === 'GERTEC_PPC930';
  const portaConfigurada = config.portaCom || statusConfig?.pinpad?.portaCom || null;

  let deteccaoFisica = null;
  if (ehPpc930) {
    deteccaoFisica = sdk.gertecPPC930 && sdk.gertecPPC930._comPortaConfig
      ? sdk.gertecPPC930
      : sdkDetector.detectarGertecPPC930({ portaConfigurada });
  }

  const comparacaoPorta = tefConfigService.compararPortaPinpad(
    portaConfigurada,
    deteccaoFisica?.porta || null
  );

  const hardware = deteccaoFisica
    ? {
      detectado: Boolean(deteccaoFisica.detectado),
      estado: deteccaoFisica.estado || null,
      porta: deteccaoFisica.porta || null,
      portaDetectada: Boolean(deteccaoFisica.portaDetectada),
      dispositivoConfirmado: Boolean(deteccaoFisica.dispositivoConfirmado),
      fonteDeteccao: deteccaoFisica.fonteDeteccao || null,
      driver: deteccaoFisica.driver,
      usb: deteccaoFisica.usb,
      driverStatus: deteccaoFisica.driverStatus || deteccaoFisica.statuses?.driver || 'nao_confirmado',
      usbStatus: deteccaoFisica.usbStatus || deteccaoFisica.statuses?.usb || 'nao_confirmado',
      dispositivo: deteccaoFisica.dispositivo || null,
      // Enumeração Windows ≠ PinPad operacional para TEF.
      operacionalConfirmado: false,
      mensagem: deteccaoFisica.detectado
        ? `Hardware enumerado — ${deteccaoFisica.porta || portaConfigurada || 'porta desconhecida'} (operacionalidade TEF depende do middleware/adapter)`
        : 'PinPad não detectado no Windows'
    }
    : null;

  return {
    configurado: Boolean(pinpadConfigurado),
    preConfigurado,
    nomeConfigurado: meta?.nomeExibicao || meta?.nome || statusConfig?.pinpad?.nomeExibicao || null,
    // compat: alguns consumidores antigos usavam `configurado` como rótulo
    rotulo: meta?.nomeExibicao || meta?.nome || statusConfig?.pinpad?.nomeExibicao || null,
    codigo: meta?.codigo || codigo || null,
    fabricante: meta?.fabricante || config.fabricante || null,
    modelo: meta?.modelo || config.modelo || null,
    tipoConexao: config.tipoConexao || statusConfig?.pinpad?.tipoConexao || null,
    interfaceEsperada: meta?.interfaceEsperada || null,
    descricaoConexao: meta?.descricaoConexao || null,
    portaCom: portaConfigurada,
    portaComparacao: comparacaoPorta,
    portaMudou: comparacaoPorta.mudou === true,
    middleware: middlewareNome,
    status: resolverStatusPinpad(
      provedor,
      middlewareInstalado,
      pinpadConfigurado,
      modoAdapter,
      {
        preConfigurado,
        detectado: hardware?.detectado === true
      }
    ),
    estado: hardware?.detectado
      ? ESTADOS_PREPARACAO.PINPAD_DETECTED
      : ESTADOS_PREPARACAO.PINPAD_NOT_DETECTED,
    habilitado: pinpadHabilitado,
    reconhecimentoAutomatico: reconhecimento,
    deteccaoFisica,
    hardware,
    observacao: ehPpc930
      ? 'PPC930 usa USB CDC: USB físico → driver Gertec → COM virtual → V$Pague. A porta COM nunca deve ser presumida; deve ser descoberta pelo Windows após a conexão.'
      : 'PinPad é registrado no CDS; a comunicação física depende do adapter do provedor configurado (arquitetura agnóstica).'
  };
}

function montarEstadoPreparacaoDestaxa({
  adapterDiag,
  adapterTeste,
  middlewareDestaxa,
  vspague,
  pinpad
} = {}) {
  const detalhesClient = adapterTeste?.detalhes || {};
  const detalhesDll = adapterDiag?.detalhes || detalhesClient || {};
  const dllEncontrada = detalhesDll.dllExists === true
    || middlewareDestaxa?.dllEncontrada === true;
  const dllCarregada = detalhesDll.dllLoaded === true;
  const clientInicializado = detalhesClient.clientInitialized === true
    || detalhesClient.estado === ESTADOS.CLIENT_INITIALIZED;
  const pinpadDetectado = pinpad?.hardware?.detectado === true;

  return {
    mensagem: pinpadDetectado
      ? 'PinPad detectado; transação continua bloqueada nesta fase.'
      : 'Ambiente preparado até o ponto de conexão do PinPad.',
    estado: pinpadDetectado
      ? ESTADOS_PREPARACAO.PINPAD_DETECTED
      : ESTADOS_PREPARACAO.AMBIENTE_PREPARADO_AGUARDANDO_PINPAD,
    dll: {
      estado: dllCarregada ? ESTADOS.DLL_LOADED : (dllEncontrada ? ESTADOS.DLL_FOUND : ESTADOS.DLL_NOT_FOUND),
      encontrado: dllEncontrada,
      carregado: dllCarregada,
      caminho: detalhesDll.dllPath || middlewareDestaxa?.caminho || null,
      arquitetura: detalhesDll.dllArch || middlewareDestaxa?.dllArch || null
    },
    client: {
      estado: clientInicializado ? ESTADOS.CLIENT_INITIALIZED : ESTADOS.CLIENT_NOT_INITIALIZED,
      inicializado: clientInicializado,
      codigo: detalhesClient.clientResultCode
        || detalhesClient.codigoDestaxa
        || adapterTeste?.detalhes?.codigoDestaxa
        || null
    },
    vspague: {
      detectado: vspague?.detectado === true,
      executando: vspague?.executando === true,
      pid: vspague?.pid || null,
      caminho: vspague?.caminho || null,
      responding: vspague?.responding ?? null
    },
    pinpad: {
      estado: pinpadDetectado
        ? ESTADOS_PREPARACAO.PINPAD_DETECTED
        : ESTADOS_PREPARACAO.PINPAD_NOT_DETECTED,
      modeloConfigurado: pinpad?.codigo || null,
      habilitado: pinpad?.habilitado === true,
      hardwareDetectado: pinpadDetectado,
      portaCom: pinpad?.hardware?.porta || pinpad?.portaCom || null,
      driver: pinpad?.hardware?.driver ?? null,
      usb: pinpad?.hardware?.usb ?? null,
      interfaceEsperada: pinpad?.interfaceEsperada || null
    },
    transacao: {
      estado: ESTADOS_PREPARACAO.TRANSACTION_BLOCKED,
      bloqueada: true,
      codigo: 'DESTAXA_TRANSACAO_NAO_IMPLEMENTADA',
      motivo: 'Preparação de ambiente; autorização financeira real não liberada.'
    },
    readyForTransaction: false,
    pendenciasObrigatoriasAntesPrimeiroPagamento: [
      'Revisar retry automático em timeout/network no TefManager.',
      'Timeout TEF não autoriza nova tentativa automática.',
      'Manter A0, A1 e 08 sem retry automático.',
      ...(pinpadDetectado ? [] : ['Conectar e detectar fisicamente o PinPad PPC930.'])
    ]
  };
}

function montarEstadosIntegracao({
  adapter,
  erroAdapter,
  adapterDiag,
  adapterTeste,
  sdk,
  pinpad,
  config
} = {}) {
  const diagnostico = adapterDiag?.detalhes || {};
  const teste = adapterTeste?.detalhes || {};
  const diagnosticoTemEstadoClient = typeof diagnostico.clientInitialized === 'boolean'
    || typeof diagnostico.estado === 'string';
  const clientInitialized = typeof diagnostico.clientInitialized === 'boolean'
    ? diagnostico.clientInitialized
    : diagnostico.estado === ESTADOS.CLIENT_INITIALIZED;
  const clientResultCode = diagnostico.clientResultCode || diagnostico.codigoDestaxa || null;
  const testeTemEstadoClient = typeof teste.clientInitialized === 'boolean'
    || typeof teste.estado === 'string';
  const testeClientInitialized = typeof teste.clientInitialized === 'boolean'
    ? teste.clientInitialized
    : teste.estado === ESTADOS.CLIENT_INITIALIZED;
  const testeClientCode = teste.clientResultCode || teste.codigoDestaxa || null;
  const clientSnapshotConsistent = diagnosticoTemEstadoClient
    && testeTemEstadoClient
    && clientInitialized === testeClientInitialized
    && (!clientResultCode || !testeClientCode || clientResultCode === testeClientCode);
  const pinpadDetectado = pinpad?.hardware?.detectado === true;
  const portaConfigurada = String(config?.portaCom || '').trim().toUpperCase();
  const portaDetectada = String(pinpad?.hardware?.porta || '').trim().toUpperCase();
  const portaConsistente = pinpad?.codigo === 'GERTEC_PPC930'
    ? Boolean(portaConfigurada && portaDetectada && portaConfigurada === portaDetectada)
    : null;

  return {
    adapter: {
      instantiated: Boolean(adapter),
      diagnosisSucceeded: adapterDiag?.sucesso === true,
      mode: adapter?.modo || null,
      error: erroAdapter || null
    },
    dll: {
      loaded: diagnostico.dllLoaded === true,
      exportsValidated: diagnostico.exportsValid === true
    },
    client: {
      initialized: clientInitialized,
      code: clientResultCode,
      snapshotsConsistent: clientSnapshotConsistent
    },
    vspague: {
      detected: sdk?.vspague?.detectado === true,
      running: sdk?.vspague?.executando === true,
      responding: sdk?.vspague?.responding ?? null
    },
    pinpad: {
      ppc930Enumerated: pinpadDetectado,
      configuredPort: portaConfigurada || null,
      detectedPort: portaDetectada || null,
      comConsistent: portaConsistente
    },
    transactionCommunication: {
      validated: false,
      state: 'not_tested',
      explanation: 'Diagnóstico não executa transação financeira; comunicação transacional permanece não validada.'
    },
    authorization: {
      available: false,
      financialGateEnabled: String(process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '').trim() === '1',
      explanation: 'Disponibilidade para autorizar não é comprovada sem o fluxo transacional; este diagnóstico não autoriza pagamentos.'
    }
  };
}

function resolverValidacaoMiddleware(provedor, sdk = {}) {
  const provider = String(provedor || '').trim().toLowerCase();
  if (provider === 'sitef') {
    return {
      aplicavel: true,
      valida: sdk.sitef?.configuracaoValida === true,
      fonte: 'sdk.sitef.configuracaoValida',
      explicacao: 'Validação do arquivo INI CliSiTef.'
    };
  }
  if (provider === 'paygo') {
    return {
      aplicavel: true,
      valida: sdk.paygo?.configuracaoValida === true,
      fonte: 'sdk.paygo.configuracaoValida',
      explicacao: 'Validação do arquivo INI PayGo.'
    };
  }
  if (provider === 'destaxa') {
    return {
      aplicavel: false,
      valida: null,
      fonte: null,
      explicacao: 'Não aplicável à Destaxa: sdk.configuracaoValida agrega somente as validações INI de SiTef e PayGo.'
    };
  }
  return {
    aplicavel: false,
    valida: null,
    fonte: null,
    explicacao: 'Validação de middleware INI não aplicável a este provedor.'
  };
}

async function executarDiagnosticoCompleto() {
  let config = {};
  let statusConfig = null;
  let adapter = null;
  let adapterDiag = null;
  let adapterTeste = null;
  let erroAdapter = null;

  try {
    config = await tefConfigService.obterConfiguracao();
    statusConfig = await tefConfigService.obterStatus();
  } catch (error) {
    config = {};
    statusConfig = { configurado: false, mensagem: error.message };
  }

  const portaConfigurada = config.portaCom || null;
  const sdk = sdkDetector.diagnosticarCompleto();
  // Reavalia PPC930 com a porta configurada (não altera a config)
  sdk.gertecPPC930 = sdkDetector.detectarGertecPPC930({ portaConfigurada });
  sdk.gertecPPC930._comPortaConfig = true;

  const banco = await verificarBanco();
  const configVal = validarConfiguracao(config, statusConfig);

  const provedor = String(config.tefProvedor || '').toLowerCase();
  const ambiente = String(config.tefAmbiente || 'simulacao').toLowerCase();

  try {
    if (statusConfig?.configurado !== false) {
      adapter = await obterAdapter();
      adapterTeste = await adapter.testarConexao();
      adapterDiag = await adapter.diagnosticar();
    }
  } catch (error) {
    erroAdapter = error.message;
  }

  const modoAdapterFinal = adapter?.modo || tefConfigService.resolverModoAdapter(ambiente);

  // Middleware real ≠ adapter Node ≠ provedor configurado
  const middlewareSitef = sdk.sitef;
  const middlewarePaygo = sdk.paygo;
  const middlewareDestaxa = sdk.destaxa;
  const middlewareInstalado = (
    (provedor === 'sitef' && Boolean(middlewareSitef?.sitefInstalado)) ||
    (provedor === 'paygo' && Boolean(middlewarePaygo?.paygoInstalado)) ||
    (provedor === 'destaxa' && Boolean(middlewareDestaxa?.destaxaInstalado))
  );

  const sdkEncontrado = Boolean(
    (provedor === 'sitef' && middlewareSitef?.sitefInstalado) ||
    (provedor === 'paygo' && middlewarePaygo?.paygoInstalado) ||
    (provedor === 'destaxa' && middlewareDestaxa?.destaxaInstalado) ||
    (config.sdkPath && String(config.sdkPath).trim())
  );

  const dllEncontrada = Boolean(
    (sdk.dllEncontrada && ['sitef', 'paygo'].includes(provedor)) ||
    (provedor === 'destaxa' && middlewareDestaxa?.dllEncontrada)
  );

  const adapterCarregado = Boolean(adapter);
  const validacaoMiddlewareProvedor = resolverValidacaoMiddleware(provedor, sdk);
  const configuracaoValida = configVal.valida;

  const pinpadDiagnostico = montarDiagnosticoPinpad(
    config,
    statusConfig,
    sdk,
    provedor,
    middlewareInstalado,
    modoAdapterFinal
  );
  const estadosIntegracao = montarEstadosIntegracao({
    adapter,
    erroAdapter,
    adapterDiag,
    adapterTeste,
    sdk,
    pinpad: pinpadDiagnostico,
    config
  });
  const comunicacaoRealDisponivel = estadosIntegracao.transactionCommunication.validated;

  const preparacaoDestaxa = provedor === 'destaxa'
    ? montarEstadoPreparacaoDestaxa({
      adapterDiag,
      adapterTeste,
      middlewareDestaxa,
      vspague: sdk.vspague,
      pinpad: pinpadDiagnostico
    })
    : null;

  let pinpadInstancia = null;
  if (pinpadDiagnostico.codigo && pinpadDiagnostico.habilitado) {
    try {
      pinpadInstancia = await obterPinpad({
        codigo: pinpadDiagnostico.codigo,
        fabricante: pinpadDiagnostico.fabricante,
        modelo: pinpadDiagnostico.modelo,
        porta_com: config.portaCom,
        ip: config.pinpadIp,
        serial: config.serial
      });
    } catch {
      pinpadInstancia = null;
    }
  }

  const conceitos = {
    adapterCarregado,
    modoAdapter: modoAdapterFinal,
    middlewareInstalado,
    sdkEncontrado,
    dllEncontrada,
    configuracaoValida,
    comunicacaoRealDisponivel,
    clientInicializado: estadosIntegracao.client.initialized,
    vspagueExecutando: estadosIntegracao.vspague.running,
    ppc930Enumerado: estadosIntegracao.pinpad.ppc930Enumerated,
    portaComConsistente: estadosIntegracao.pinpad.comConsistent,
    disponibilidadeAutorizacao: estadosIntegracao.authorization.available
  };

  const itens = [
    {
      chave: 'adapter_selecionado',
      ok: Boolean(provedor),
      detalhe: provedor || 'não configurado'
    },
    {
      chave: 'adapter_carregado',
      ok: adapterCarregado,
      detalhe: adapter?.nome || erroAdapter || 'não instanciado'
    },
    {
      chave: 'modo_adapter',
      ok: Boolean(modoAdapterFinal),
      detalhe: modoAdapterFinal || 'indefinido'
    },
    {
      chave: 'middleware_instalado',
      ok: middlewareInstalado,
      detalhe: provedor === 'sitef'
        ? (middlewareSitef.sitefInstalado ? middlewareSitef.caminho : 'CliSiTef não detectado')
        : provedor === 'paygo'
          ? (middlewarePaygo.paygoInstalado ? middlewarePaygo.caminho : 'PayGo não detectado')
          : provedor === 'destaxa'
            ? (middlewareDestaxa?.destaxaInstalado ? middlewareDestaxa.caminho : 'DLL Destaxa não detectada')
            : 'Não aplicável ao provedor (adapter ≠ middleware)'
    },
    {
      chave: 'sdk_encontrado',
      ok: modoAdapterFinal === 'simulacao' ? true : sdkEncontrado,
      detalhe: modoAdapterFinal === 'simulacao'
        ? 'Não exigido em simulação'
        : (sdkEncontrado ? (sdk.caminho || config.sdkPath || 'OK') : 'SDK não encontrado')
    },
    {
      chave: 'dll_encontrada',
      ok: modoAdapterFinal === 'simulacao' ? true : dllEncontrada,
      detalhe: modoAdapterFinal === 'simulacao'
        ? 'Não exigido em simulação'
        : (dllEncontrada ? (sdk.caminho || 'DLL OK') : 'DLL não exigida/encontrada para este provedor')
    },
    {
      chave: 'comunicacao_real_disponivel',
      ok: comunicacaoRealDisponivel,
      detalhe: comunicacaoRealDisponivel
        ? 'Comunicação transacional validada'
        : estadosIntegracao.transactionCommunication.explanation
    },
    {
      chave: 'client_destaxa_inicializado',
      ok: estadosIntegracao.client.initialized,
      detalhe: {
        codigo: estadosIntegracao.client.code,
        snapshotsConsistent: estadosIntegracao.client.snapshotsConsistent
      }
    },
    {
      chave: 'client_destaxa_snapshots_consistentes',
      ok: provedor !== 'destaxa' || estadosIntegracao.client.snapshotsConsistent,
      detalhe: provedor === 'destaxa'
        ? estadosIntegracao.client.snapshotsConsistent
          ? 'Snapshots de teste e diagnóstico coerentes.'
          : 'Snapshots de Client divergentes ou ausentes.'
        : 'Não aplicável a este provedor.'
    },
    {
      chave: 'vspague_detectado',
      ok: estadosIntegracao.vspague.detected && estadosIntegracao.vspague.running,
      detalhe: estadosIntegracao.vspague
    },
    {
      chave: 'pinpad_windows_enumerado',
      ok: estadosIntegracao.pinpad.ppc930Enumerated,
      detalhe: estadosIntegracao.pinpad
    },
    {
      chave: 'porta_com_consistente',
      ok: estadosIntegracao.pinpad.comConsistent === true,
      detalhe: estadosIntegracao.pinpad
    },
    {
      chave: 'autorizacao_disponivel',
      ok: estadosIntegracao.authorization.available,
      detalhe: estadosIntegracao.authorization.explanation
    },
    {
      chave: 'ini_configuracao',
      ok: !validacaoMiddlewareProvedor.aplicavel || validacaoMiddlewareProvedor.valida,
      detalhe: {
        ...validacaoMiddlewareProvedor,
        caminho: provedor === 'sitef'
          ? middlewareSitef?.ini?.caminho || null
          : provedor === 'paygo'
            ? middlewarePaygo?.ini?.caminho || null
            : null
      }
    },
    {
      chave: 'pinpad_configurado',
      ok: !statusConfig?.pinpad?.habilitado || (statusConfig?.pinpad?.configurado && Boolean(pinpadDiagnostico.codigo)),
      detalhe: [
        pinpadDiagnostico.rotulo || pinpadDiagnostico.codigo || 'não configurado',
        pinpadDiagnostico.tipoConexao,
        pinpadDiagnostico.portaCom
      ].filter(Boolean).join(' / ')
    },
    {
      chave: 'pinpad_gertec_ppc930',
      ok: pinpadDiagnostico.codigo !== 'GERTEC_PPC930' || Boolean(pinpadDiagnostico.hardware?.detectado || pinpadDiagnostico.habilitado),
      detalhe: pinpadDiagnostico.codigo === 'GERTEC_PPC930'
        ? {
          configurado: pinpadDiagnostico.configurado,
          detectado: pinpadDiagnostico.hardware?.detectado || false,
          porta: pinpadDiagnostico.hardware?.porta || pinpadDiagnostico.portaCom,
          driverStatus: pinpadDiagnostico.hardware?.driverStatus,
          usbStatus: pinpadDiagnostico.hardware?.usbStatus,
          fonteDeteccao: pinpadDiagnostico.hardware?.fonteDeteccao,
          dispositivo: pinpadDiagnostico.hardware?.dispositivo,
          mensagem: pinpadDiagnostico.hardware?.mensagem
        }
        : 'não selecionado'
    },
    {
      chave: 'banco_acessivel',
      ok: banco.acessivel,
      detalhe: banco.mensagem
    },
    {
      chave: 'configuracao_valida',
      ok: configuracaoValida,
      detalhe: configVal.pendencias
    },
    {
      chave: 'ambiente_homologacao',
      ok: ambiente === 'homologacao',
      detalhe: ambiente
    },
    {
      chave: 'ambiente_producao',
      ok: ambiente === 'producao' || ambiente === 'produção',
      detalhe: ambiente
    },
    {
      chave: 'adapter_operacional',
      ok: estadosIntegracao.transactionCommunication.validated,
      detalhe: erroAdapter || estadosIntegracao.transactionCommunication.explanation
    }
  ];

  const totalOk = itens.filter((i) => i.ok).length;
  const percentual = Math.round((totalOk / itens.length) * 100);

  return {
    sucesso: percentual >= 70,
    percentualProntidao: percentual,
    timestamp: new Date().toISOString(),
    resumo: {
      provedor,
      ambiente,
      modoAdapter: modoAdapterFinal,
      tefHabilitado: config.tefHabilitado === 'true' || config.tefHabilitado === true,
      pinpad: pinpadDiagnostico.rotulo || pinpadDiagnostico.codigo || null,
      ...conceitos
    },
    conceitos,
    estadosIntegracao,
    pinpad: pinpadDiagnostico,
    preparacaoDestaxa,
    pinpadAbstracao: pinpadInstancia
      ? await pinpadInstancia.obterInformacoes().catch(() => null)
      : null,
    middleware: {
      ...sdk,
      configuracaoValidaProvedor: validacaoMiddlewareProvedor
    },
    configuracao: config,
    statusConfiguracao: statusConfig,
    adapter: {
      nome: adapter?.nome || null,
      modo: adapter?.modo || null,
      carregado: adapterCarregado,
      diagnostico: adapterDiag,
      testeConexao: adapterTeste,
      erro: erroAdapter
    },
    validacao: configVal,
    banco,
    itens,
    pendencias: [
      ...configVal.pendencias,
      ...(erroAdapter ? [erroAdapter] : []),
      ...(!middlewareInstalado && ['sitef', 'paygo', 'destaxa'].includes(provedor) && modoAdapterFinal !== 'simulacao'
        ? ['Middleware do cliente não instalado nesta máquina']
        : []),
      ...(adapter?.modo === 'real_pendente_sdk'
        ? ['Estrutura real pronta — falta conectar SDK no adapter']
        : [])
    ]
  };
}

module.exports = {
  executarDiagnosticoCompleto,
  verificarBanco,
  validarConfiguracao,
  montarDiagnosticoPinpad,
  montarEstadoPreparacaoDestaxa,
  montarEstadosIntegracao,
  resolverValidacaoMiddleware,
  resolverStatusPinpad
};
