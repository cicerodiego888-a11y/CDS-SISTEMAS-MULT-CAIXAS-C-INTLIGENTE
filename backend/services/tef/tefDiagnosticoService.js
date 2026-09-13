const sdkDetector = require('./sdkDetector');
const { obterAdapter } = require('./tefFactory');
const tefConfigService = require('./tefConfigService');
const pinpadCatalog = require('./pinpads/pinpadCatalog');
const { obterPinpad, reconhecerAutomaticamente } = require('./pinpads/PinpadFactory');
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

function resolverStatusPinpad(provedor, middlewareInstalado, pinpadConfigurado, modoAdapter) {
  if (!pinpadConfigurado) {
    return 'Não configurado';
  }
  if (modoAdapter === 'simulacao') {
    return 'Configurado (simulação)';
  }
  if (['sitef', 'paygo'].includes(provedor)) {
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
      : null;

  const pinpadHabilitado = config.pinpadHabilitado === 'true' || config.pinpadHabilitado === true;
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
      mensagem: deteccaoFisica.detectado
        ? `PinPad detectado — ${deteccaoFisica.porta || portaConfigurada || 'porta desconhecida'}`
        : 'PinPad não detectado no Windows'
    }
    : null;

  return {
    configurado: Boolean(pinpadConfigurado),
    nomeConfigurado: meta?.nomeExibicao || meta?.nome || statusConfig?.pinpad?.nomeExibicao || null,
    // compat: alguns consumidores antigos usavam `configurado` como rótulo
    rotulo: meta?.nomeExibicao || meta?.nome || statusConfig?.pinpad?.nomeExibicao || null,
    codigo: meta?.codigo || codigo || null,
    fabricante: meta?.fabricante || config.fabricante || null,
    modelo: meta?.modelo || config.modelo || null,
    tipoConexao: config.tipoConexao || statusConfig?.pinpad?.tipoConexao || null,
    portaCom: portaConfigurada,
    middleware: middlewareNome,
    status: resolverStatusPinpad(provedor, middlewareInstalado, pinpadConfigurado, modoAdapter),
    habilitado: pinpadHabilitado,
    reconhecimentoAutomatico: reconhecimento,
    deteccaoFisica,
    hardware,
    observacao: 'PinPad é registrado no CDS; a comunicação física depende do adapter do provedor configurado (arquitetura agnóstica).'
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
      adapterDiag = await adapter.diagnosticar();
      adapterTeste = await adapter.testarConexao();
    }
  } catch (error) {
    erroAdapter = error.message;
  }

  const modoAdapterFinal = adapter?.modo || tefConfigService.resolverModoAdapter(ambiente);

  // Middleware real ≠ adapter Node ≠ provedor configurado
  const middlewareSitef = sdk.sitef;
  const middlewarePaygo = sdk.paygo;
  const middlewareInstalado = (
    (provedor === 'sitef' && Boolean(middlewareSitef?.sitefInstalado)) ||
    (provedor === 'paygo' && Boolean(middlewarePaygo?.paygoInstalado))
  );

  const sdkEncontrado = Boolean(
    (provedor === 'sitef' && middlewareSitef?.sitefInstalado) ||
    (provedor === 'paygo' && middlewarePaygo?.paygoInstalado) ||
    (config.sdkPath && String(config.sdkPath).trim())
  );

  const dllEncontrada = Boolean(
    sdk.dllEncontrada && ['sitef', 'paygo'].includes(provedor)
  );

  const adapterCarregado = Boolean(adapter) && !erroAdapter;
  const configuracaoValida = configVal.valida;
  const comunicacaoRealDisponivel = (
    modoAdapterFinal === 'real' &&
    middlewareInstalado &&
    !['stone', 'cielo', 'rede', 'getnet'].includes(provedor)
  );

  const pinpadDiagnostico = montarDiagnosticoPinpad(
    config,
    statusConfig,
    sdk,
    provedor,
    middlewareInstalado,
    modoAdapterFinal
  );

  let pinpadInstancia = null;
  if (pinpadDiagnostico.codigo) {
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
    comunicacaoRealDisponivel
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
      detalhe: erroAdapter || adapter?.nome || 'não carregado'
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
        ? 'Middleware real disponível'
        : 'Comunicação real indisponível (simulação ou middleware ausente)'
    },
    {
      chave: 'ini_configuracao',
      ok: sdk.configuracaoValida || !['sitef', 'paygo'].includes(provedor) || modoAdapterFinal === 'simulacao',
      detalhe: middlewareSitef?.ini?.caminho || middlewarePaygo?.ini?.caminho || 'sem INI'
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
      ok: adapterCarregado,
      detalhe: erroAdapter || adapter?.nome || 'não carregado'
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
    pinpad: pinpadDiagnostico,
    pinpadAbstracao: pinpadInstancia
      ? await pinpadInstancia.obterInformacoes().catch(() => null)
      : null,
    middleware: sdk,
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
      ...(!middlewareInstalado && ['sitef', 'paygo'].includes(provedor) && modoAdapterFinal !== 'simulacao'
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
  validarConfiguracao
};
