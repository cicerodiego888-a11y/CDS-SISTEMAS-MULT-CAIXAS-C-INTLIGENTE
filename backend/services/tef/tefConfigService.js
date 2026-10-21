const repository = require('../../repositories/tefConfigRepository');
const pinpadCatalog = require('./pinpads/pinpadCatalog');

/**
 * Defaults apenas para instalação nova / GET sem linha persistida.
 * Nunca devem sobrescrever configuração já salva.
 * TEF começa desabilitado e sem provedor inventado (não fixar Rede/Destaxa).
 */
const DEFAULTS_CONFIG = Object.freeze({
  tefHabilitado: 'false',
  tefProvedor: '',
  tefAmbiente: 'simulacao',
  tefTimeout: 60,
  tefTentativas: 3,
  tipoIntegracao: '',
  sdkPath: '',
  exePath: '',
  ipTef: '',
  portaTef: ''
});

/** Escopo efetivo do CDS: uma configuração TEF por instalação (arquivo de banco). */
const ESCOPO_CONFIGURACAO_TEF = Object.freeze({
  nivel: 'instalacao',
  descricao: 'Singleton em tef_configuracao (ORDER BY id ASC LIMIT 1) no banco da instalação.',
  empresa: 'empresa_codigo é string do middleware, não FK multiempresa CDS',
  caixa: 'caixa_codigo/pdv_codigo/terminal_codigo são strings do provedor, não isolamento por caixa',
  terminalFisico: 'porta_com em tef_pinpads — conexão do PinPad desta instalação'
});

const CONFIG_PREPARACAO_DESTAXA = Object.freeze({
  tefHabilitado: true,
  tefProvedor: 'destaxa',
  tefAmbiente: 'homologacao',
  tipoIntegracao: 'dll',
  tefTimeout: 60,
  tefTentativas: 1,
  sdkPath: '',
  exePath: '',
  ipTef: '',
  portaTef: '',
  pinpadHabilitado: false,
  pinpadModelo: 'GERTEC_PPC930',
  pinpadCodigo: 'GERTEC_PPC930',
  fabricante: 'Gertec',
  modelo: 'PPC930',
  tipoConexao: '',
  portaCom: '',
  pinpadIp: '',
  pinpadPorta: '',
  serial: ''
});

function criarConfiguracaoPreparacaoDestaxa(configExistente = {}) {
  return {
    ...configExistente,
    ...CONFIG_PREPARACAO_DESTAXA
  };
}

const CAMPOS_SECRETOS = new Set([
  'clientSecret',
  'accessToken',
  'refreshToken',
  'chaveComunicacao',
  'client_secret',
  'access_token',
  'refresh_token',
  'chave_comunicacao'
]);

function resolverPinpadPayload(payload = {}) {
  const codigo = normalizarTexto(payload.pinpadModelo || payload.pinpadCodigo) || null;
  const meta = pinpadCatalog.resolver({
    codigo,
    fabricante: payload.fabricante,
    modelo: payload.modelo
  });

  return {
    habilitado: normalizarBoolean(payload.pinpadHabilitado),
    codigo: meta?.codigo || codigo || null,
    nome: meta?.nome || normalizarTexto(payload.pinpadNome) || null,
    fabricante: meta?.fabricante || normalizarTexto(payload.fabricante) || null,
    modelo: meta?.modelo || normalizarTexto(payload.modelo) || null,
    tipo_conexao: resolverTipoConexaoPinpad(payload),
    porta_com: normalizarTexto(payload.portaCom) || null,
    ip: normalizarTexto(payload.pinpadIp) || null,
    porta: normalizarNumero(payload.pinpadPorta),
    serial: normalizarTexto(payload.serial) || null,
    ativo: 1
  };
}

function normalizarTexto(valor) {
  if (valor === null || valor === undefined) {
    return '';
  }
  return String(valor);
}

function normalizarNumero(valor) {
  if (valor === '' || valor === null || valor === undefined) {
    return null;
  }
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function normalizarBoolean(valor) {
  return valor === true || valor === 'true' || valor === '1' || valor === 1;
}

function campoDefinido(payload, chave) {
  return Object.prototype.hasOwnProperty.call(payload, chave)
    && payload[chave] !== undefined;
}

function resolverTipoConexaoPinpad(dados) {
  const informado = normalizarTexto(dados.tipoConexao || dados.tipo_conexao).toLowerCase();
  if (informado === 'serial' || informado === 'ip' || informado === 'usb') {
    return informado;
  }
  if (dados.portaCom || dados.porta_com) {
    return 'serial';
  }
  if (dados.pinpadIp || dados.ip) {
    return 'ip';
  }
  return '';
}

function resolverAmbiente(valor) {
  const ambiente = normalizarTexto(valor).toLowerCase().trim();
  if (!ambiente) {
    return null;
  }
  if (ambiente === 'produção') {
    return 'producao';
  }
  return ambiente;
}

const AMBIENTES_VALIDOS = Object.freeze(['simulacao', 'homologacao', 'producao']);

function garantirAmbientePersistivel(dados) {
  const ambiente = dados?.principal?.ambiente;
  if (ambiente != null && !AMBIENTES_VALIDOS.includes(ambiente)) {
    const erro = new Error(`Ambiente TEF inválido: "${ambiente}". Use ${AMBIENTES_VALIDOS.join(', ')}.`);
    erro.statusCode = 400;
    erro.codigo = 'TEF_AMBIENTE_INVALIDO';
    throw erro;
  }
  return dados;
}

function resolverModoAdapter(ambiente) {
  const a = String(ambiente || 'simulacao').toLowerCase();
  if (a === 'homologacao' || a === 'producao' || a === 'produção') {
    return 'real';
  }
  return 'simulacao';
}

function textoOuExistente(payload, chave, legado) {
  if (campoDefinido(payload, chave)) {
    return normalizarTexto(payload[chave]) || null;
  }
  return legado != null && legado !== '' ? String(legado) : null;
}

function numeroOuExistente(payload, chave, legado) {
  if (campoDefinido(payload, chave)) {
    return normalizarNumero(payload[chave]);
  }
  if (legado === '' || legado === null || legado === undefined) {
    return null;
  }
  const numero = Number(legado);
  return Number.isFinite(numero) ? numero : null;
}

function boolOuExistente(payload, chave, legado) {
  if (campoDefinido(payload, chave)) {
    return normalizarBoolean(payload[chave]);
  }
  return repository.intToBool(legado);
}

function mapearPayloadEntrada(payload = {}, existente = null) {
  const p = existente?.principal || null;
  const s = existente?.servidor || null;
  const opsExistentes = existente?.operacoes || null;
  const pinExistente = existente?.pinpad || null;

  const pinpadPayload = campoDefinido(payload, 'pinpadHabilitado')
    || campoDefinido(payload, 'pinpadModelo')
    || campoDefinido(payload, 'pinpadCodigo')
    || campoDefinido(payload, 'portaCom')
    || campoDefinido(payload, 'tipoConexao')
    || campoDefinido(payload, 'fabricante')
    || campoDefinido(payload, 'modelo')
    || campoDefinido(payload, 'pinpadIp')
    || campoDefinido(payload, 'pinpadPorta')
    || campoDefinido(payload, 'serial')
    ? resolverPinpadPayload(payload)
    : {
      habilitado: repository.intToBool(pinExistente?.habilitado),
      codigo: pinExistente?.codigo || null,
      nome: pinExistente?.nome || null,
      fabricante: pinExistente?.fabricante || null,
      modelo: pinExistente?.modelo || null,
      tipo_conexao: pinExistente?.tipo_conexao || null,
      porta_com: pinExistente?.porta_com || null,
      ip: pinExistente?.ip || null,
      porta: pinExistente?.porta ?? null,
      serial: pinExistente?.serial || null,
      ativo: pinExistente?.ativo != null ? pinExistente.ativo : 1
    };

  return {
    principal: {
      habilitado: boolOuExistente(payload, 'tefHabilitado', p?.habilitado),
      provedor: textoOuExistente(payload, 'tefProvedor', p?.provedor),
      ambiente: campoDefinido(payload, 'tefAmbiente')
        ? resolverAmbiente(payload.tefAmbiente)
        : resolverAmbiente(p?.ambiente),
      timeout: numeroOuExistente(payload, 'tefTimeout', p?.timeout),
      tentativas: numeroOuExistente(payload, 'tefTentativas', p?.tentativas),
      empresa_codigo: textoOuExistente(payload, 'empresaCodigo', p?.empresa_codigo),
      loja_codigo: textoOuExistente(payload, 'lojaCodigo', p?.loja_codigo),
      pdv_codigo: textoOuExistente(payload, 'pdvCodigo', p?.pdv_codigo),
      terminal_codigo: textoOuExistente(payload, 'terminalCodigo', p?.terminal_codigo),
      caixa_codigo: textoOuExistente(payload, 'caixaCodigo', p?.caixa_codigo),
      tipo_integracao: textoOuExistente(payload, 'tipoIntegracao', p?.tipo_integracao),
      sdk_path: textoOuExistente(payload, 'sdkPath', p?.sdk_path),
      exe_path: textoOuExistente(payload, 'exePath', p?.exe_path),
      ip_tef: textoOuExistente(payload, 'ipTef', p?.ip_tef),
      porta_tef: numeroOuExistente(payload, 'portaTef', p?.porta_tef)
    },
    servidor: {
      base_url: textoOuExistente(payload, 'baseUrl', s?.base_url),
      ip: textoOuExistente(payload, 'ipServidor', s?.ip),
      porta: numeroOuExistente(payload, 'portaServidor', s?.porta),
      client_id: textoOuExistente(payload, 'clientId', s?.client_id),
      client_secret: textoOuExistente(payload, 'clientSecret', s?.client_secret),
      access_token: textoOuExistente(payload, 'accessToken', s?.access_token),
      refresh_token: textoOuExistente(payload, 'refreshToken', s?.refresh_token),
      chave_comunicacao: textoOuExistente(payload, 'chaveComunicacao', s?.chave_comunicacao),
      operador: textoOuExistente(payload, 'operador', s?.operador)
    },
    pinpad: pinpadPayload,
    operacoes: {
      debito: boolOuExistente(payload, 'debito', opsExistentes?.debito),
      credito_avista: boolOuExistente(payload, 'creditoAvista', opsExistentes?.credito_avista),
      credito_parcelado: boolOuExistente(payload, 'creditoParcelado', opsExistentes?.credito_parcelado),
      voucher: boolOuExistente(payload, 'voucher', opsExistentes?.voucher),
      pix: boolOuExistente(payload, 'pix', opsExistentes?.pix),
      cancelamento: boolOuExistente(payload, 'cancelamento', opsExistentes?.cancelamento),
      reimpressao: boolOuExistente(payload, 'reimpressao', opsExistentes?.reimpressao),
      pre_autorizacao: boolOuExistente(payload, 'preAutorizacao', opsExistentes?.pre_autorizacao),
      confirmacao_manual: boolOuExistente(payload, 'confirmacaoManual', opsExistentes?.confirmacao_manual)
    }
  };
}

function mapearPayloadLegado(payload = {}) {
  return mapearPayloadEntrada({
    tefHabilitado: payload.tefHabilitado,
    tefProvedor: payload.tefProvedor,
    tefAmbiente: payload.tefAmbiente,
    tefTimeout: payload.tefTimeout,
    tefTentativas: payload.tefTentativas,
    tipoIntegracao: payload.tipoIntegracao,
    sdkPath: payload.sdkPath,
    exePath: payload.exePath,
    ipTef: payload.ipTef,
    portaTef: payload.portaTef,
    empresaCodigo: payload.empresaCodigo,
    lojaCodigo: payload.lojaCodigo,
    pdvCodigo: payload.pdvCodigo,
    terminalCodigo: payload.terminalCodigo,
    caixaCodigo: payload.caixaCodigo,
    baseUrl: payload.baseUrl,
    ipServidor: payload.ipServidor,
    portaServidor: payload.portaServidor,
    clientId: payload.clientId,
    clientSecret: payload.clientSecret,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    chaveComunicacao: payload.chaveComunicacao,
    operador: payload.operador,
    pinpadHabilitado: payload.pinpadHabilitado,
    pinpadModelo: payload.pinpadModelo,
    pinpadCodigo: payload.pinpadCodigo,
    pinpadNome: payload.pinpadNome,
    fabricante: payload.fabricante,
    modelo: payload.modelo,
    tipoConexao: payload.tipoConexao,
    portaCom: payload.portaCom,
    pinpadIp: payload.pinpadIp,
    pinpadPorta: payload.pinpadPorta,
    serial: payload.serial,
    debito: payload.debito,
    creditoAvista: payload.creditoAvista,
    creditoParcelado: payload.creditoParcelado,
    voucher: payload.voucher,
    pix: payload.pix,
    cancelamento: payload.cancelamento,
    reimpressao: payload.reimpressao,
    preAutorizacao: payload.preAutorizacao,
    confirmacaoManual: payload.confirmacaoManual
  });
}

function boolParaResposta(valor) {
  return repository.intToBool(valor) ? 'true' : 'false';
}

function mapearConfiguracaoSaida(registro) {
  if (!registro?.principal) {
    return {};
  }

  const { principal, servidor, pinpad, operacoes } = registro;

  return {
    id: principal.id,
    tefHabilitado: boolParaResposta(principal.habilitado),
    tefProvedor: principal.provedor || '',
    tefAmbiente: principal.ambiente || 'simulacao',
    tefTimeout: principal.timeout ?? '',
    tefTentativas: principal.tentativas ?? '',
    tipoIntegracao: principal.tipo_integracao || '',
    sdkPath: principal.sdk_path || '',
    exePath: principal.exe_path || '',
    ipTef: principal.ip_tef || '',
    portaTef: principal.porta_tef ?? '',
    empresaCodigo: principal.empresa_codigo || '',
    lojaCodigo: principal.loja_codigo || '',
    pdvCodigo: principal.pdv_codigo || '',
    terminalCodigo: principal.terminal_codigo || '',
    caixaCodigo: principal.caixa_codigo || '',
    baseUrl: servidor?.base_url || '',
    ipServidor: servidor?.ip || '',
    portaServidor: servidor?.porta ?? '',
    clientId: servidor?.client_id || '',
    clientSecret: servidor?.client_secret || '',
    accessToken: servidor?.access_token || '',
    refreshToken: servidor?.refresh_token || '',
    chaveComunicacao: servidor?.chave_comunicacao || '',
    operador: servidor?.operador || '',
    pinpadHabilitado: boolParaResposta(pinpad?.habilitado),
    pinpadModelo: pinpad?.codigo || '',
    pinpadCodigo: pinpad?.codigo || '',
    pinpadNome: pinpad?.nome || '',
    pinpadNomeExibicao: pinpadCatalog.resolverPorCodigo(pinpad?.codigo)?.nomeExibicao || pinpad?.nome || '',
    fabricante: pinpad?.fabricante || '',
    modelo: pinpad?.modelo || '',
    tipoConexao: pinpad?.tipo_conexao || '',
    portaCom: pinpad?.porta_com || '',
    pinpadIp: pinpad?.ip || '',
    pinpadPorta: pinpad?.porta ?? '',
    serial: pinpad?.serial || '',
    pinpadStatus: pinpad?.status || 'desconhecido',
    pinpadUltimaConexao: pinpad?.ultima_conexao || '',
    debito: boolParaResposta(operacoes?.debito),
    creditoAvista: boolParaResposta(operacoes?.credito_avista),
    creditoParcelado: boolParaResposta(operacoes?.credito_parcelado),
    voucher: boolParaResposta(operacoes?.voucher),
    pix: boolParaResposta(operacoes?.pix),
    cancelamento: boolParaResposta(operacoes?.cancelamento),
    reimpressao: boolParaResposta(operacoes?.reimpressao),
    preAutorizacao: boolParaResposta(operacoes?.pre_autorizacao),
    confirmacaoManual: boolParaResposta(operacoes?.confirmacao_manual)
  };
}

function montarResumoLogSeguro(config = {}) {
  const resumo = {};
  Object.keys(config).forEach((chave) => {
    if (CAMPOS_SECRETOS.has(chave)) {
      resumo[`${chave}Presente`] = Boolean(config[chave]);
      return;
    }
    resumo[chave] = config[chave];
  });
  return resumo;
}

function logConfig(acao, config = {}) {
  try {
    console.log(`[TEF-CONFIG] ${acao}`, montarResumoLogSeguro(config));
  } catch (error) {
    console.log(`[TEF-CONFIG] ${acao} (log indisponível: ${error.message})`);
  }
}

async function migrarConfiguracaoLegadaSeNecessario() {
  const total = await repository.contarConfiguracoes();
  if (total > 0) {
    return false;
  }

  const legado = await repository.listarConfiguracaoLegada();
  if (!Object.keys(legado).length) {
    return false;
  }

  const dados = mapearPayloadLegado(legado);
  await repository.salvarConfiguracaoCompleta(dados, { atualizar: false });
  logConfig('migracao_legada', mapearConfiguracaoSaida(await repository.buscarConfiguracaoCompleta()));
  return true;
}

function aplicarDefaultsSeVazio(config) {
  if (config && Object.keys(config).length > 0) {
    return config;
  }

  return {
    ...DEFAULTS_CONFIG,
    empresaCodigo: '',
    lojaCodigo: '',
    pdvCodigo: '',
    terminalCodigo: '',
    caixaCodigo: '',
    baseUrl: '',
    ipServidor: '',
    portaServidor: '',
    clientId: '',
    clientSecret: '',
    accessToken: '',
    refreshToken: '',
    chaveComunicacao: '',
    operador: '',
    pinpadHabilitado: 'false',
    pinpadModelo: '',
    pinpadCodigo: '',
    pinpadNome: '',
    pinpadNomeExibicao: '',
    fabricante: '',
    modelo: '',
    tipoConexao: '',
    portaCom: '',
    pinpadIp: '',
    pinpadPorta: '',
    serial: '',
    debito: 'false',
    creditoAvista: 'false',
    creditoParcelado: 'false',
    voucher: 'false',
    pix: 'false',
    cancelamento: 'false',
    reimpressao: 'false',
    preAutorizacao: 'false',
    confirmacaoManual: 'false',
    _defaultsAplicados: true
  };
}

async function obterConfiguracao() {
  await migrarConfiguracaoLegadaSeNecessario();
  const registro = await repository.buscarConfiguracaoCompleta();
  const config = mapearConfiguracaoSaida(registro);
  const resultado = aplicarDefaultsSeVazio(config);
  logConfig('carregada', resultado);
  return resultado;
}

async function criarConfiguracao(payload) {
  const existente = await repository.buscarConfiguracaoPrincipal();
  if (existente) {
    const erro = new Error('Configuração TEF já existe. Utilize PUT para atualizar.');
    erro.statusCode = 409;
    throw erro;
  }

  const payloadComDefaults = {
    ...DEFAULTS_CONFIG,
    ...payload,
    tefHabilitado: campoDefinido(payload, 'tefHabilitado') ? payload.tefHabilitado : DEFAULTS_CONFIG.tefHabilitado,
    tefProvedor: normalizarTexto(payload.tefProvedor) || DEFAULTS_CONFIG.tefProvedor,
    tefAmbiente: resolverAmbiente(payload.tefAmbiente) || DEFAULTS_CONFIG.tefAmbiente,
    tefTimeout: campoDefinido(payload, 'tefTimeout') && payload.tefTimeout !== ''
      ? payload.tefTimeout
      : DEFAULTS_CONFIG.tefTimeout,
    tefTentativas: campoDefinido(payload, 'tefTentativas') && payload.tefTentativas !== ''
      ? payload.tefTentativas
      : DEFAULTS_CONFIG.tefTentativas
  };

  const dados = garantirAmbientePersistivel(mapearPayloadEntrada(payloadComDefaults));
  const registro = await repository.salvarConfiguracaoCompleta(dados, { atualizar: false });
  const config = mapearConfiguracaoSaida(registro);
  logConfig('salva', config);
  return config;
}

async function atualizarConfiguracao(payload) {
  const existente = await repository.buscarConfiguracaoCompleta();
  const dados = garantirAmbientePersistivel(mapearPayloadEntrada(payload, existente));
  const registro = await repository.salvarConfiguracaoCompleta(dados, { atualizar: true });
  const config = mapearConfiguracaoSaida(registro);
  logConfig('atualizada', config);
  return config;
}

async function salvarConfiguracao(payload) {
  const existente = await repository.buscarConfiguracaoCompleta();
  const ehNovo = !existente?.principal;

  const payloadFinal = ehNovo
    ? {
      ...DEFAULTS_CONFIG,
      ...payload,
      tefHabilitado: campoDefinido(payload, 'tefHabilitado') ? payload.tefHabilitado : DEFAULTS_CONFIG.tefHabilitado,
      tefProvedor: normalizarTexto(payload.tefProvedor) || DEFAULTS_CONFIG.tefProvedor,
      tefAmbiente: resolverAmbiente(payload.tefAmbiente) || DEFAULTS_CONFIG.tefAmbiente,
      tefTimeout: campoDefinido(payload, 'tefTimeout') && payload.tefTimeout !== ''
        ? payload.tefTimeout
        : DEFAULTS_CONFIG.tefTimeout,
      tefTentativas: campoDefinido(payload, 'tefTentativas') && payload.tefTentativas !== ''
        ? payload.tefTentativas
        : DEFAULTS_CONFIG.tefTentativas
    }
    : payload;

  const dados = garantirAmbientePersistivel(mapearPayloadEntrada(payloadFinal, existente));
  const registro = await repository.salvarConfiguracaoCompleta(dados, {
    atualizar: Boolean(existente?.principal)
  });
  const config = mapearConfiguracaoSaida(registro);
  logConfig('salva', config);
  return config;
}

function validarServidorConfigurado(servidor) {
  return Boolean(
    servidor?.base_url ||
    servidor?.ip ||
    servidor?.client_id ||
    servidor?.access_token
  );
}

function resolverEstadoServidorMonitor(provedor, ambiente, servidor) {
  const provider = String(provedor || '').trim().toLowerCase();
  const env = String(ambiente || 'simulacao').trim().toLowerCase();
  const configurado = validarServidorConfigurado(servidor);
  const detalhes = {
    configurado,
    conectado: null,
    baseUrl: servidor?.base_url || '',
    ip: servidor?.ip || '',
    porta: servidor?.porta ?? null
  };

  if (provider === 'destaxa') {
    return {
      ...detalhes,
      aplicavel: false,
      estado: 'nao_aplicavel',
      mensagem: 'Não aplicável: Destaxa usa DLL/Client Destaxa; processo V$Pague detectado não comprova conexão transacional.'
    };
  }

  if (env === 'simulacao') {
    return {
      ...detalhes,
      aplicavel: false,
      estado: 'opcional_simulacao',
      mensagem: 'Servidor HTTP legado opcional em simulação.'
    };
  }

  if (['sitef', 'paygo'].includes(provider)) {
    return {
      ...detalhes,
      aplicavel: false,
      estado: 'nao_aplicavel',
      mensagem: `Não aplicável: ${provider === 'sitef' ? 'SiTef' : 'PayGo'} é validado pelo seu SDK; servidor HTTP legado não comprova conexão.`
    };
  }

  return {
    ...detalhes,
    aplicavel: true,
    estado: configurado ? 'configurado_nao_testado' : 'nao_configurado',
    mensagem: configurado
      ? 'Parâmetros HTTP configurados; conexão não testada.'
      : 'Servidor HTTP não configurado.'
  };
}

function validarPinpadConfigurado(pinpad) {
  if (!repository.intToBool(pinpad?.habilitado)) {
    return false;
  }

  // serial físico é opcional — não exige pinpad.serial
  return Boolean(
    pinpad?.codigo ||
    pinpad?.porta_com ||
    pinpad?.ip
  );
}

/**
 * Validação contextual da configuração oficial.
 * Ambiente (simulacao|homologacao|producao) ≠ modo do adapter (simulacao|real).
 */
function validarConfiguracao(config = {}, opcoes = {}) {
  const pendencias = [];
  const ambiente = String(config.tefAmbiente || '').toLowerCase() || 'simulacao';
  const modoAdapter = opcoes.modoAdapter || resolverModoAdapter(ambiente);
  const tefHabilitado = normalizarBoolean(config.tefHabilitado);
  const provedor = String(config.tefProvedor || '').toLowerCase();

  if (!tefHabilitado) {
    pendencias.push('TEF desabilitado na configuração');
  }

  if (!config.tefProvedor) {
    pendencias.push('Provedor TEF não informado');
  }

  if (!config.tefAmbiente) {
    pendencias.push('Ambiente TEF não informado');
  } else if (!AMBIENTES_VALIDOS.includes(ambiente)) {
    pendencias.push(`Ambiente TEF inválido: ${config.tefAmbiente}`);
  }

  if (modoAdapter === 'real' && ambiente === 'simulacao') {
    pendencias.push('Ambiente simulacao não permite adapter real');
  }

  // Validações por contrato do provedor — não aplicar Rede/SiTef/PayGo à Destaxa.
  const exigeCodigosEstabelecimento = ['sitef', 'paygo', 'rede', 'stone', 'cielo', 'getnet'].includes(provedor);
  if (exigeCodigosEstabelecimento) {
    if (!normalizarTexto(config.empresaCodigo).trim()) {
      pendencias.push('Código da empresa não configurado');
    }
    if (!normalizarTexto(config.lojaCodigo).trim()) {
      pendencias.push('Código da loja não configurado');
    }
    if (!normalizarTexto(config.terminalCodigo).trim()) {
      pendencias.push('Código do terminal não configurado');
    }
  }

  const pinpadHabilitado = normalizarBoolean(config.pinpadHabilitado);
  if (pinpadHabilitado) {
    const temModelo = Boolean(config.pinpadModelo || config.pinpadCodigo);
    const tipoConexao = String(config.tipoConexao || '').toLowerCase();

    if (!temModelo) {
      pendencias.push('Modelo do PinPad não configurado');
    }

    if (tipoConexao === 'serial' || tipoConexao === 'usb' || config.portaCom) {
      if (!normalizarTexto(config.portaCom).trim()) {
        pendencias.push('Porta COM do PinPad não configurada');
      }
    } else if (tipoConexao === 'ip') {
      if (!normalizarTexto(config.pinpadIp).trim()) {
        pendencias.push('IP do PinPad não configurado');
      }
      if (config.pinpadPorta === '' || config.pinpadPorta == null) {
        pendencias.push('Porta IP do PinPad não configurada');
      }
    } else if (temModelo && !config.portaCom && !config.pinpadIp) {
      pendencias.push('PinPad habilitado sem parâmetros de conexão');
    }
  }

  // Modo simulação: não exige SDK/DLL/credenciais reais
  // Destaxa real: DLL/V$Pague — não exige servidor HTTP legado nem SDK path SiTef.
  if (modoAdapter !== 'simulacao' && ambiente !== 'simulacao') {
    if (['sitef', 'paygo'].includes(provedor)) {
      if (!normalizarTexto(config.sdkPath).trim() && !normalizarTexto(config.exePath).trim()) {
        pendencias.push('Caminho do SDK/EXE não configurado para modo real');
      }
    }
  }

  const resultado = {
    valida: pendencias.length === 0,
    pendencias,
    ambiente,
    modoAdapter
  };

  logConfig('validada', {
    valida: resultado.valida,
    ambiente,
    modoAdapter,
    pendenciasCount: pendencias.length
  });

  return resultado;
}

async function getPinPadConfig() {
  const config = await obterConfiguracao();
  return {
    pinpadHabilitado: config.pinpadHabilitado,
    pinpadModelo: config.pinpadModelo,
    pinpadCodigo: config.pinpadCodigo,
    pinpadNome: config.pinpadNome,
    pinpadNomeExibicao: config.pinpadNomeExibicao,
    fabricante: config.fabricante,
    modelo: config.modelo,
    tipoConexao: config.tipoConexao,
    portaCom: config.portaCom,
    pinpadIp: config.pinpadIp,
    pinpadPorta: config.pinpadPorta,
    serial: config.serial,
    pinpadStatus: config.pinpadStatus,
    pinpadUltimaConexao: config.pinpadUltimaConexao
  };
}

async function getServerConfig() {
  const config = await obterConfiguracao();
  return {
    baseUrl: config.baseUrl,
    ipServidor: config.ipServidor,
    portaServidor: config.portaServidor,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    chaveComunicacao: config.chaveComunicacao,
    operador: config.operador,
    ipTef: config.ipTef,
    portaTef: config.portaTef,
    tipoIntegracao: config.tipoIntegracao,
    sdkPath: config.sdkPath,
    exePath: config.exePath
  };
}

async function obterStatus() {
  await migrarConfiguracaoLegadaSeNecessario();
  const registro = await repository.buscarConfiguracaoCompleta();

  if (!registro?.principal) {
    return {
      configurado: false,
      tefHabilitado: false,
      mensagem: 'Configuração TEF não encontrada.'
    };
  }

  const { principal, servidor, pinpad, operacoes } = registro;
  const tefHabilitado = repository.intToBool(principal.habilitado);
  const servidorConfigurado = validarServidorConfigurado(servidor);
  const pinpadConfigurado = validarPinpadConfigurado(pinpad);
  const ambiente = principal.ambiente || '';
  const modoAdapter = resolverModoAdapter(ambiente);
  const estadoServidor = resolverEstadoServidorMonitor(principal.provedor, ambiente, servidor);

  return {
    configurado: true,
    tefHabilitado,
    provedor: principal.provedor || '',
    ambiente,
    modoAdapter,
    servidor: estadoServidor,
    pinpad: {
      habilitado: repository.intToBool(pinpad?.habilitado),
      configurado: pinpadConfigurado,
      codigo: pinpad?.codigo || '',
      nome: pinpad?.nome || '',
      nomeExibicao: pinpadCatalog.resolverPorCodigo(pinpad?.codigo)?.nomeExibicao || pinpad?.nome || '',
      status: pinpad?.status || 'desconhecido',
      fabricante: pinpad?.fabricante || '',
      modelo: pinpad?.modelo || '',
      tipoConexao: pinpad?.tipo_conexao || '',
      portaCom: pinpad?.porta_com || '',
      ultimaConexao: pinpad?.ultima_conexao || null
    },
    operacoes: {
      debito: repository.intToBool(operacoes?.debito),
      creditoAvista: repository.intToBool(operacoes?.credito_avista),
      creditoParcelado: repository.intToBool(operacoes?.credito_parcelado),
      voucher: repository.intToBool(operacoes?.voucher),
      pix: repository.intToBool(operacoes?.pix),
      cancelamento: repository.intToBool(operacoes?.cancelamento),
      reimpressao: repository.intToBool(operacoes?.reimpressao),
      preAutorizacao: repository.intToBool(operacoes?.pre_autorizacao),
      confirmacaoManual: repository.intToBool(operacoes?.confirmacao_manual)
    }
  };
}

async function testarConexao() {
  await migrarConfiguracaoLegadaSeNecessario();
  const registro = await repository.buscarConfiguracaoCompleta();

  if (!registro?.principal) {
    const erro = new Error('Configuração TEF não encontrada.');
    erro.statusCode = 404;
    throw erro;
  }

  const { principal, servidor, pinpad } = registro;
  const testes = [];
  let sucessoGeral = true;
  const ambiente = principal.ambiente || 'simulacao';
  const modoAdapter = resolverModoAdapter(ambiente);

  if (!repository.intToBool(principal.habilitado)) {
    return {
      sucesso: false,
      mensagem: 'TEF está desabilitado na configuração.',
      testes: [{
        tipo: 'geral',
        sucesso: false,
        mensagem: 'Habilite o TEF antes de testar.'
      }]
    };
  }

  const servidorConfigurado = validarServidorConfigurado(servidor);
  const provedor = String(principal.provedor || '').toLowerCase();
  const servidorOpcional = modoAdapter === 'simulacao' || ['destaxa', 'sitef', 'paygo'].includes(provedor);
  if (servidorOpcional) {
    testes.push({
      tipo: 'servidor',
      sucesso: true,
      mensagem: provedor === 'destaxa'
        ? (servidorConfigurado
          ? 'Parâmetros de servidor presentes (opcionais na Destaxa — integração via DLL/V$Pague).'
          : 'Servidor HTTP não exigido para Destaxa (DLL/V$Pague).')
        : ['sitef', 'paygo'].includes(provedor)
          ? `Servidor HTTP legado não exigido para ${provedor === 'sitef' ? 'SiTef' : 'PayGo'} (validação via SDK).`
        : (servidorConfigurado
          ? 'Parâmetros de servidor encontrados (opcionais em simulação).'
          : 'Servidor não configurado — OK em modo simulação.')
    });
  } else {
    testes.push({
      tipo: 'servidor',
      sucesso: servidorConfigurado,
      mensagem: servidorConfigurado
        ? 'Parâmetros de servidor encontrados.'
        : 'Servidor TEF não configurado.'
    });
    if (!servidorConfigurado) {
      sucessoGeral = false;
    }
  }

  const pinpadHabilitado = repository.intToBool(pinpad?.habilitado);
  if (pinpadHabilitado) {
    const pinpadConfigurado = validarPinpadConfigurado(pinpad);
    testes.push({
      tipo: 'pinpad',
      sucesso: pinpadConfigurado,
      mensagem: pinpadConfigurado
        ? 'PinPad configurado e pronto para teste.'
        : 'PinPad habilitado, mas sem parâmetros de conexão.'
    });

    if (pinpadConfigurado) {
      await repository.atualizarStatusPinpad(principal.id, 'testado');
    } else {
      sucessoGeral = false;
    }
  } else {
    testes.push({
      tipo: 'pinpad',
      sucesso: true,
      mensagem: 'PinPad desabilitado. Teste ignorado.'
    });
  }

  testes.push({
    tipo: 'provedor',
    sucesso: Boolean(principal.provedor),
    mensagem: principal.provedor
      ? `Provedor ${principal.provedor} configurado.`
      : 'Provedor TEF não informado.'
  });

  if (!principal.provedor) {
    sucessoGeral = false;
  }

  return {
    sucesso: sucessoGeral,
    mensagem: sucessoGeral
      ? 'Teste de configuração TEF concluído com sucesso.'
      : 'Teste de configuração TEF concluído com pendências.',
    ambiente,
    modoAdapter,
    provedor: principal.provedor || '',
    servidor: {
      ...resolverEstadoServidorMonitor(provedor, ambiente, servidor),
      baseUrl: servidor?.base_url || '',
      ip: servidor?.ip || '',
      porta: servidor?.porta ?? null
    },
    testes
  };
}

function normalizarPortaCom(porta) {
  const texto = String(porta || '').trim().toUpperCase();
  if (!texto) return '';
  const match = texto.match(/COM\s*(\d+)/i);
  return match ? `COM${match[1]}` : texto.replace(/\s+/g, '');
}

/**
 * Compara porta COM persistida com a detectada no Windows.
 * Não presume COM3/COM4; não afirma PinPad operacional só por enumeração.
 */
function compararPortaPinpad(portaConfigurada, portaDetectada) {
  const salva = normalizarPortaCom(portaConfigurada);
  const detectada = normalizarPortaCom(portaDetectada);
  if (!salva && !detectada) {
    return {
      salva: '',
      detectada: '',
      coincidem: true,
      mudou: false,
      status: 'sem_porta'
    };
  }
  if (!salva) {
    return {
      salva: '',
      detectada,
      coincidem: false,
      mudou: Boolean(detectada),
      status: 'somente_detectada'
    };
  }
  if (!detectada) {
    return {
      salva,
      detectada: '',
      coincidem: false,
      mudou: false,
      status: 'somente_configurada'
    };
  }
  const coincidem = salva === detectada;
  return {
    salva,
    detectada,
    coincidem,
    mudou: !coincidem,
    status: coincidem ? 'coincidem' : 'divergente'
  };
}

function configParaRegistroAdapter(config = {}) {
  return {
    id: config.id || null,
    habilitado: normalizarBoolean(config.tefHabilitado) ? 1 : 0,
    provedor: config.tefProvedor || null,
    ambiente: config.tefAmbiente || null,
    timeout: config.tefTimeout ?? null,
    tentativas: config.tefTentativas ?? null,
    empresa_codigo: config.empresaCodigo || null,
    loja_codigo: config.lojaCodigo || null,
    pdv_codigo: config.pdvCodigo || null,
    terminal_codigo: config.terminalCodigo || null,
    caixa_codigo: config.caixaCodigo || null,
    tipo_integracao: config.tipoIntegracao || null,
    sdk_path: config.sdkPath || null,
    exe_path: config.exePath || null,
    ip_tef: config.ipTef || null,
    porta_tef: config.portaTef ?? null,
    pinpadHabilitado: config.pinpadHabilitado,
    pinpadModelo: config.pinpadModelo,
    pinpadCodigo: config.pinpadCodigo,
    portaCom: config.portaCom,
    tipoConexao: config.tipoConexao
  };
}

module.exports = {
  obterConfiguracao,
  criarConfiguracao,
  atualizarConfiguracao,
  salvarConfiguracao,
  obterStatus,
  testarConexao,
  mapearConfiguracaoSaida,
  mapearPayloadEntrada,
  validarConfiguracao,
  garantirAmbientePersistivel,
  AMBIENTES_VALIDOS,
  getConfig: obterConfiguracao,
  saveConfig: salvarConfiguracao,
  updateConfig: atualizarConfiguracao,
  validateConfig: validarConfiguracao,
  getPinPadConfig,
  getServerConfig,
  resolverModoAdapter,
  resolverEstadoServidorMonitor,
  normalizarPortaCom,
  compararPortaPinpad,
  configParaRegistroAdapter,
  ESCOPO_CONFIGURACAO_TEF,
  DEFAULTS_CONFIG,
  CONFIG_PREPARACAO_DESTAXA,
  criarConfiguracaoPreparacaoDestaxa
};
