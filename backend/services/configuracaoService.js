const fs = require('fs');
const path = require('path');

const LEGACY_CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'configuracoes.json');
const LEGACY_ELECTRON_PATHS = [
  path.join(__dirname, '..', '..', 'storage', 'config-servidor.json'),
  path.join(__dirname, '..', 'storage', 'config-servidor.json')
];

const MENSAGEM_RENOVACAO_PADRAO =
  'Sua assinatura do CDS Sistemas expira em {dias} dias.';

const DEFAULT = {
  tipoImplantacao: 'ERP_SEM_FISCAL',
  modoOperacao: 'LOCAL',
  ipServidor: '',
  porta: 3001,
  modo_confirmacao_fiscal: 'TEF',
  // Sprint 1 — módulo opcional (default OFF; zero impacto no PDV)
  habilitar_vendas_entrega: false,
  // Comercial — Expedição (Pedido → Venda via Núcleo). Independente de fiscal/NF-e/NFC-e.
  // habilitar_faturamento: chave legada (mesmo valor); NÃO significa módulo fiscal.
  habilitar_expedicao: false,
  habilitar_faturamento: false,
  // Sprint 3.9 — Módulos Licenciados (null = herda do tipo de implantação)
  modulo_pdv: true,
  modulo_pedidos: null,
  modulo_nfe: null,
  modulo_nfce: null,
  modulo_historico_vendas: null,
  modulo_compra_facil: false,
  modulo_marketplace: false,
  modulo_crm: false,
  // Sprint 3.1 — impressão inteligente
  imprimir_comprovante_entrega: true,
  imprimir_comprovante_prestacao: true,
  imprimir_danfe_nfce_entrega: true,
  imprimir_cupom_nao_fiscal_entrega: false,
  // Sprint 3.1 — alertas (horas)
  entrega_alerta_horas_aguardando: 2,
  entrega_alerta_horas_reserva: 4,
  entrega_alerta_horas_parado: 3,
  // Sprint 3.8A/B/C — MIDP V1 (política única PRESERVAR DINHEIRO quando ativar_midp=true)
  ativar_midp: false,
  // RC8.2 — MPFC (política fiscal comercial; default FIXA = comportamento atual)
  mpfc_modo: 'FIXA',
  mpfc_percentual_dinheiro_fiscal: 0,
  mpfc_margem_minima_sobre_custo: 20,
  mpfc_nunca_vender_abaixo_margem: false,
  // Sprint 3.9 — Licenciamento CDS (aviso no login; sem bloqueio novo)
  licenca_dias_aviso: 3,
  licenca_chave_pix: '',
  licenca_whatsapp_url: '',
  licenca_mensagem_renovacao: MENSAGEM_RENOVACAO_PADRAO,
  // Hotfix RC1.3 — plano exibido na Barra de Status (opcional; senão deriva do tipo)
  licenca_plano: ''
};

const TIPOS = ['ERP_SEM_FISCAL', 'ERP_FISCAL', 'ERP_MULTICAIXA'];
const MODOS = ['LOCAL', 'CLIENTE_SERVIDOR'];
const MODOS_CONFIRMACAO_FISCAL = ['TEF', 'MANUAL'];

function getDbDir() {
  return process.env.DB_DIR || path.join(
    process.env.PROGRAMDATA || 'C:\\ProgramData',
    'MercantilFiscal',
    'dados'
  );
}

function getPersistentConfigDir() {
  const dir = path.join(getDbDir(), 'config');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getConfigPath() {
  return path.join(getPersistentConfigDir(), 'configuracoes.json');
}

function getElectronConfigPath() {
  return path.join(getPersistentConfigDir(), 'config-servidor.json');
}

function getRecoveryFlagPath() {
  return path.join(getPersistentConfigDir(), 'forcar-modo-local.flag');
}

function criarFlagForcarModoLocal() {
  ensureConfigFile();
  const flagPath = getRecoveryFlagPath();
  fs.writeFileSync(flagPath, new Date().toISOString(), 'utf8');
  return flagPath;
}

function consumirFlagForcarModoLocal() {
  const flagPath = getRecoveryFlagPath();
  if (!fs.existsSync(flagPath)) return false;
  try {
    fs.unlinkSync(flagPath);
  } catch (e) {
    console.warn('Não foi possível remover flag de recuperação:', e.message);
  }
  voltarModoLocalEstacao();
  console.log('Recuperação: modo local aplicado via flag de emergência.');
  return true;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
  } catch (e) {
    console.warn(`Não foi possível ler ${filePath}:`, e.message);
    return null;
  }
}

function readLegacyElectronConfig() {
  for (const legacyPath of LEGACY_ELECTRON_PATHS) {
    const data = readJsonFile(legacyPath);
    if (data?.modo === 'cliente' && data.ipServidor) {
      return data;
    }
  }
  return null;
}

function buildConfigFromLegacyElectron(legacyElectron, baseConfig = {}) {
  const base = normalizeConfig(baseConfig);
  return normalizeConfig({
    tipoImplantacao: base.tipoImplantacao === 'ERP_SEM_FISCAL' ? 'ERP_MULTICAIXA' : base.tipoImplantacao,
    modoOperacao: 'CLIENTE_SERVIDOR',
    ipServidor: legacyElectron.ipServidor,
    porta: legacyElectron.porta || base.porta || DEFAULT.porta
  });
}

function migrateLegacyConfig() {
  const configPath = getConfigPath();

  if (fs.existsSync(configPath)) {
    return;
  }

  const legacyConfig = readJsonFile(LEGACY_CONFIG_PATH);
  if (legacyConfig) {
    const normalized = normalizeConfig(legacyConfig);
    fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2), 'utf8');
    syncElectronConfig(normalized);
    console.log('Configuração migrada de', LEGACY_CONFIG_PATH, 'para', configPath);
    return;
  }

  const legacyElectron = readLegacyElectronConfig();
  if (legacyElectron) {
    const migrated = buildConfigFromLegacyElectron(legacyElectron);
    fs.writeFileSync(configPath, JSON.stringify(migrated, null, 2), 'utf8');
    syncElectronConfig(migrated);
    console.log('Configuração de rede migrada do arquivo legado para:', configPath);
    return;
  }

  fs.writeFileSync(configPath, JSON.stringify(DEFAULT, null, 2), 'utf8');
  syncElectronConfig(DEFAULT);
}

function ensureConfigFile() {
  migrateLegacyConfig();
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT, null, 2), 'utf8');
    syncElectronConfig(DEFAULT);
  }
}

function normalizePadraoFiscal(obj) {
  const origem = obj?.origem_padrao;
  return {
    cfop_padrao: obj?.cfop_padrao !== undefined && obj?.cfop_padrao !== null
      ? String(obj.cfop_padrao).trim()
      : '',
    csosn_padrao: obj?.csosn_padrao !== undefined && obj?.csosn_padrao !== null
      ? String(obj.csosn_padrao).trim()
      : '',
    origem_padrao: origem !== undefined && origem !== null
      ? String(origem).trim()
      : '',
    cest_padrao: obj?.cest_padrao !== undefined && obj?.cest_padrao !== null
      ? String(obj.cest_padrao).trim()
      : '',
    entrada_bonificacao_cfop_padrao: obj?.entrada_bonificacao_cfop_padrao !== undefined
      ? String(obj.entrada_bonificacao_cfop_padrao || '5910').trim()
      : '5910',
    entrada_bonificacao_csosn_padrao: obj?.entrada_bonificacao_csosn_padrao !== undefined
      ? String(obj.entrada_bonificacao_csosn_padrao || '').trim()
      : '',
    entrada_bonificacao_natureza: obj?.entrada_bonificacao_natureza !== undefined
      ? String(obj.entrada_bonificacao_natureza || 'Bonificação recebida').trim()
      : 'Bonificação recebida',
    entrada_bonificacao_atualizar_custo: normalizeBoolFlag(
      obj?.entrada_bonificacao_atualizar_custo,
      false
    ),
    entrada_bonificacao_gerar_estoque: normalizeBoolFlag(
      obj?.entrada_bonificacao_gerar_estoque,
      true
    )
  };
}

function normalizeModoConfirmacaoFiscal(valor) {
  const modo = String(valor || DEFAULT.modo_confirmacao_fiscal).toUpperCase().trim();
  return modo === 'MANUAL' ? 'MANUAL' : 'TEF';
}

function normalizeBoolFlag(valor, padrao = false) {
  if (valor === true || valor === 1 || valor === '1') return true;
  if (valor === false || valor === 0 || valor === '0') return false;
  const s = String(valor ?? '').trim().toLowerCase();
  if (s === 'true' || s === 'sim' || s === 'yes' || s === 'on') return true;
  if (s === 'false' || s === 'nao' || s === 'não' || s === 'no' || s === 'off') return false;
  return padrao === true;
}

/** Tri-state: null = herdar; true/false = explícito (Sprint 3.9). */
function normalizeTriStateFlag(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  return normalizeBoolFlag(valor, false);
}

function resolveModuloFlag(valor, herdado) {
  const tri = normalizeTriStateFlag(valor);
  if (tri === null) return herdado === true;
  return tri === true;
}

/**
 * RC8.0.3 — Expedição é módulo COMERCIAL.
 * Fonte: habilitar_expedicao (canônico) ou habilitar_faturamento (legado).
 * Nunca depende de tipoImplantacao, fiscal, nfe ou nfce.
 */
function resolverExpedicaoComercial(obj, padrao = DEFAULT.habilitar_expedicao) {
  if (obj && Object.prototype.hasOwnProperty.call(obj, 'habilitar_expedicao')) {
    return normalizeBoolFlag(obj.habilitar_expedicao, padrao);
  }
  if (obj && Object.prototype.hasOwnProperty.call(obj, 'habilitar_faturamento')) {
    return normalizeBoolFlag(obj.habilitar_faturamento, padrao);
  }
  return padrao === true;
}

function normalizeLicencaMensagem(valor) {
  const texto = String(valor ?? '').trim();
  return texto || MENSAGEM_RENOVACAO_PADRAO;
}

function normalizeConfig(obj) {
  const expedicaoComercial = resolverExpedicaoComercial(obj, DEFAULT.habilitar_expedicao);
  return {
    tipoImplantacao: String(obj?.tipoImplantacao || DEFAULT.tipoImplantacao).toUpperCase(),
    modoOperacao: String(obj?.modoOperacao || DEFAULT.modoOperacao).toUpperCase(),
    ipServidor: String(obj?.ipServidor || '').trim(),
    porta: Number(obj?.porta || DEFAULT.porta),
    modo_confirmacao_fiscal: normalizeModoConfirmacaoFiscal(obj?.modo_confirmacao_fiscal),
    habilitar_vendas_entrega: normalizeBoolFlag(
      obj?.habilitar_vendas_entrega,
      DEFAULT.habilitar_vendas_entrega
    ),
    habilitar_expedicao: expedicaoComercial,
    // Legado: mesma flag comercial (API / checkbox antigos). Não é “faturamento fiscal”.
    habilitar_faturamento: expedicaoComercial,
    modulo_pdv: resolveModuloFlag(obj?.modulo_pdv, DEFAULT.modulo_pdv === true),
    modulo_pedidos: normalizeTriStateFlag(obj?.modulo_pedidos),
    modulo_nfe: normalizeTriStateFlag(obj?.modulo_nfe),
    modulo_nfce: normalizeTriStateFlag(obj?.modulo_nfce),
    modulo_historico_vendas: normalizeTriStateFlag(obj?.modulo_historico_vendas),
    modulo_compra_facil: normalizeBoolFlag(obj?.modulo_compra_facil, DEFAULT.modulo_compra_facil),
    modulo_marketplace: normalizeBoolFlag(obj?.modulo_marketplace, DEFAULT.modulo_marketplace),
    modulo_crm: normalizeBoolFlag(obj?.modulo_crm, DEFAULT.modulo_crm),
    imprimir_comprovante_entrega: normalizeBoolFlag(
      obj?.imprimir_comprovante_entrega,
      DEFAULT.imprimir_comprovante_entrega
    ),
    imprimir_comprovante_prestacao: normalizeBoolFlag(
      obj?.imprimir_comprovante_prestacao,
      DEFAULT.imprimir_comprovante_prestacao
    ),
    imprimir_danfe_nfce_entrega: normalizeBoolFlag(
      obj?.imprimir_danfe_nfce_entrega,
      DEFAULT.imprimir_danfe_nfce_entrega
    ),
    imprimir_cupom_nao_fiscal_entrega: normalizeBoolFlag(
      obj?.imprimir_cupom_nao_fiscal_entrega,
      DEFAULT.imprimir_cupom_nao_fiscal_entrega
    ),
    entrega_alerta_horas_aguardando: Math.max(
      1,
      Number(obj?.entrega_alerta_horas_aguardando ?? DEFAULT.entrega_alerta_horas_aguardando) || 2
    ),
    entrega_alerta_horas_reserva: Math.max(
      1,
      Number(obj?.entrega_alerta_horas_reserva ?? DEFAULT.entrega_alerta_horas_reserva) || 4
    ),
    entrega_alerta_horas_parado: Math.max(
      1,
      Number(obj?.entrega_alerta_horas_parado ?? DEFAULT.entrega_alerta_horas_parado) || 3
    ),
    ativar_midp: normalizeBoolFlag(obj?.ativar_midp, DEFAULT.ativar_midp),
    mpfc_modo: String(obj?.mpfc_modo || DEFAULT.mpfc_modo).toUpperCase() === 'FLEXIVEL'
      ? 'FLEXIVEL'
      : 'FIXA',
    mpfc_percentual_dinheiro_fiscal: Math.min(
      100,
      Math.max(0, Number(obj?.mpfc_percentual_dinheiro_fiscal ?? DEFAULT.mpfc_percentual_dinheiro_fiscal) || 0)
    ),
    mpfc_margem_minima_sobre_custo: Math.max(
      0,
      Number(obj?.mpfc_margem_minima_sobre_custo ?? DEFAULT.mpfc_margem_minima_sobre_custo) || 0
    ),
    mpfc_nunca_vender_abaixo_margem: normalizeBoolFlag(
      obj?.mpfc_nunca_vender_abaixo_margem,
      DEFAULT.mpfc_nunca_vender_abaixo_margem
    ),
    licenca_dias_aviso: Math.min(30, Math.max(1, Number(obj?.licenca_dias_aviso ?? DEFAULT.licenca_dias_aviso) || 3)),
    licenca_chave_pix: String(obj?.licenca_chave_pix || '').trim(),
    licenca_whatsapp_url: String(obj?.licenca_whatsapp_url || '').trim(),
    licenca_mensagem_renovacao: normalizeLicencaMensagem(obj?.licenca_mensagem_renovacao),
    licenca_plano: String(obj?.licenca_plano || '').trim(),
    ...normalizePadraoFiscal(obj)
  };
}

function getModoConfirmacaoFiscal(cfg) {
  return normalizeModoConfirmacaoFiscal((cfg || readConfig()).modo_confirmacao_fiscal);
}

/** Sprint 3.8C — MIDP V1: quando true, Motor aplica Valor Fiscal Efetivo (política PRESERVAR DINHEIRO). */
function isMidpAtivado(cfg) {
  return normalizeBoolFlag((cfg || readConfig()).ativar_midp, DEFAULT.ativar_midp);
}

function getPadraoFiscal(cfg) {
  return normalizePadraoFiscal(cfg || readConfig());
}

function readConfig() {
  try {
    ensureConfigFile();
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return Object.assign({}, DEFAULT, normalizeConfig(parsed));
  } catch (e) {
    console.error('Erro ao ler configuracoes.json:', e.message);
    return Object.assign({}, DEFAULT);
  }
}

function getRecursos(cfg) {
  const config = normalizeConfig(cfg || readConfig());
  const tipo = config.tipoImplantacao;
  const modo = config.modoOperacao;
  const fiscalBase = tipo === 'ERP_FISCAL' || tipo === 'ERP_MULTICAIXA';

  // Documento fiscal — depende SOMENTE do tipo de implantação + módulos nfe/nfce
  const nfe = fiscalBase && resolveModuloFlag(config.modulo_nfe, true);
  const nfce = fiscalBase && resolveModuloFlag(config.modulo_nfce, true);

  // Fluxo comercial: Pedido → Expedição → (opcional) Documento Fiscal
  // expedicao NÃO herda de fiscal/nfe/nfce/tipoImplantacao.
  const expedicao = resolverExpedicaoComercial(config) === true;
  const pedidos = resolveModuloFlag(config.modulo_pedidos, expedicao);
  const pdv = resolveModuloFlag(config.modulo_pdv, true);
  // Histórico de Vendas: se não definido, acompanha o PDV (invisibilidade operacional).
  const historicoVendas = resolveModuloFlag(config.modulo_historico_vendas, pdv);

  const recursos = {
    // Sprint 3.9 — existência dos módulos (princípio da invisibilidade)
    pdv,
    pedidos,
    // RC8.0.3 — recurso canônico comercial
    expedicao,
    // Alias de API legado: /api/faturamento e exigirRecurso('faturamento') = Expedição comercial
    // (não confundir com “Faturamento” fiscal da nomenclatura RC8.0.1)
    faturamento: expedicao,
    vendasEntrega: config.habilitar_vendas_entrega === true,
    nfe,
    nfce,
    historicoVendas,
    compraFacil: config.modulo_compra_facil === true,
    marketplace: config.modulo_marketplace === true,
    crm: config.modulo_crm === true,
    fiscal: fiscalBase && (nfe || nfce),
    nfse: fiscalBase,
    multiCaixa: false,
    clienteServidor: false,
    terminaisPdv: false
  };

  if (tipo === 'ERP_MULTICAIXA') {
    recursos.multiCaixa = true;
    recursos.clienteServidor = true;
    recursos.terminaisPdv = true;
  }

  if (tipo === 'ERP_FISCAL' && modo === 'CLIENTE_SERVIDOR') {
    recursos.clienteServidor = false;
  }

  return {
    tipoImplantacao: tipo,
    modoOperacao: modo,
    ipServidor: config.ipServidor,
    porta: config.porta,
    habilitar_vendas_entrega: config.habilitar_vendas_entrega === true,
    habilitar_expedicao: expedicao,
    habilitar_faturamento: expedicao,
    modulo_pdv: recursos.pdv,
    modulo_pedidos: pedidos,
    modulo_nfe: nfe,
    modulo_nfce: nfce,
    modulo_historico_vendas: historicoVendas,
    modulo_compra_facil: recursos.compraFacil,
    modulo_marketplace: recursos.marketplace,
    modulo_crm: recursos.crm,
    licenca_dias_aviso: config.licenca_dias_aviso,
    licenca_chave_pix: config.licenca_chave_pix,
    licenca_whatsapp_url: config.licenca_whatsapp_url,
    licenca_mensagem_renovacao: config.licenca_mensagem_renovacao,
    recursos
  };
}

function getLicenciamentoCds(cfg) {
  const config = normalizeConfig(cfg || readConfig());
  return {
    dias_aviso: config.licenca_dias_aviso,
    // Hotfix RC1.1 — PIX Renovação (chave ou copia e cola)
    chave_pix: config.licenca_chave_pix,
    pix_renovacao: config.licenca_chave_pix,
    plano: config.licenca_plano,
    whatsapp_url: config.licenca_whatsapp_url,
    mensagem_renovacao: config.licenca_mensagem_renovacao,
    // Sprint 3.10 prep — renovação automática via PIX/webhook (não implementada)
    renovacao_automatica_preparada: true,
    renovacao_automatica_ativa: false
  };
}

function validateConfig(obj) {
  const errors = [];
  const config = normalizeConfig(obj);
  const { tipoImplantacao: tipo, modoOperacao: modo, ipServidor, porta } = config;

  if (!TIPOS.includes(tipo)) errors.push('tipoImplantacao inválido');
  if (!MODOS.includes(modo)) errors.push('modoOperacao inválido');

  if (!Number.isInteger(porta) || porta <= 0) errors.push('porta inválida');

  if (modo === 'CLIENTE_SERVIDOR' && !ipServidor) {
    errors.push('ipServidor obrigatório para modo CLIENTE_SERVIDOR');
  }

  if (tipo === 'ERP_FISCAL' && modo === 'CLIENTE_SERVIDOR') {
    errors.push('ERP Fiscal não suporta modo Cliente/Servidor');
  }

  if (modo === 'CLIENTE_SERVIDOR' && tipo !== 'ERP_MULTICAIXA') {
    errors.push('Modo Cliente/Servidor disponível apenas para ERP Multi-Caixa');
  }

  if (!MODOS_CONFIRMACAO_FISCAL.includes(config.modo_confirmacao_fiscal)) {
    errors.push('modo_confirmacao_fiscal inválido');
  }

  return { valid: errors.length === 0, errors, config };
}

function readElectronStationConfig() {
  const global = readConfig();
  const data = readJsonFile(getElectronConfigPath());
  const porta = Number.isInteger(Number(data?.porta)) && Number(data.porta) > 0
    ? Number(data.porta)
    : (global.porta || DEFAULT.porta);

  if (String(data?.modo || '').toLowerCase() === 'cliente' && String(data?.ipServidor || '').trim()) {
    return {
      modo: 'cliente',
      ipServidor: String(data.ipServidor).trim(),
      porta
    };
  }

  return {
    modo: 'local',
    ipServidor: '127.0.0.1',
    porta
  };
}

function saveElectronStationConfig({ modo, ipServidor, porta }) {
  const modoNormalizado = String(modo || 'local').trim().toLowerCase() === 'cliente' ? 'cliente' : 'local';
  const global = readConfig();
  const portaFinal = Number.isInteger(Number(porta)) && Number(porta) > 0
    ? Number(porta)
    : (global.porta || DEFAULT.porta);

  const payload = modoNormalizado === 'cliente'
    ? {
      modo: 'cliente',
      ipServidor: String(ipServidor || '').trim(),
      porta: portaFinal
    }
    : {
      modo: 'local',
      porta: portaFinal
    };

  if (payload.modo === 'cliente' && !payload.ipServidor) {
    throw new Error('IP do servidor é obrigatório no modo cliente.');
  }

  const electronPath = getElectronConfigPath();
  const dir = path.dirname(electronPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(electronPath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function getModoRedeEstacaoElectron() {
  return readElectronStationConfig();
}

function syncElectronConfig(cfg) {
  const config = normalizeConfig(cfg);
  const modoRede = getModoRedeElectron(config);
  const payload = modoRede.modo === 'cliente'
    ? { modo: 'cliente', ipServidor: modoRede.ipServidor, porta: modoRede.porta }
    : { modo: 'local', porta: modoRede.porta };

  const electronPath = getElectronConfigPath();
  const dir = path.dirname(electronPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(electronPath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function getModoRedeElectron(cfg) {
  const config = normalizeConfig(cfg || readConfig());
  const recursos = getRecursos(config).recursos;

  if (config.modoOperacao === 'CLIENTE_SERVIDOR' && recursos.clienteServidor) {
    return {
      modo: 'cliente',
      ipServidor: config.ipServidor,
      porta: config.porta
    };
  }

  return {
    modo: 'local',
    ipServidor: '127.0.0.1',
    porta: config.porta || DEFAULT.porta
  };
}

function reloadGlobalConfig() {
  const cfg = readConfig();
  global.CONFIGURACAO_AVANCADA = cfg;
  global.CONFIGURACAO_RECURSOS = getRecursos(cfg);
  return cfg;
}

function saveConfig(obj) {
  const validation = validateConfig(obj);
  if (!validation.valid) {
    const error = new Error(validation.errors.join('; '));
    error.details = validation.errors;
    throw error;
  }

  const pickBool = (src, key, normalized, cur) => (
    Object.prototype.hasOwnProperty.call(src || {}, key)
      ? normalized[key] === true
      : cur[key] === true
  );
  const pickNum = (src, key, normalized, cur, fallback) => (
    Object.prototype.hasOwnProperty.call(src || {}, key)
      ? Math.max(1, Number(normalized[key]) || fallback)
      : Math.max(1, Number(cur[key]) || fallback)
  );

  const current = readConfig();
  const toSave = {
    ...current,
    tipoImplantacao: validation.config.tipoImplantacao,
    modoOperacao: validation.config.modoOperacao,
    ipServidor: validation.config.ipServidor,
    porta: validation.config.porta,
    modo_confirmacao_fiscal: validation.config.modo_confirmacao_fiscal,
    habilitar_vendas_entrega: Object.prototype.hasOwnProperty.call(obj || {}, 'habilitar_vendas_entrega')
      ? validation.config.habilitar_vendas_entrega === true
      : current.habilitar_vendas_entrega === true,
    habilitar_expedicao: (
      Object.prototype.hasOwnProperty.call(obj || {}, 'habilitar_expedicao')
      || Object.prototype.hasOwnProperty.call(obj || {}, 'habilitar_faturamento')
    )
      ? validation.config.habilitar_expedicao === true
      : resolverExpedicaoComercial(current) === true,
    habilitar_faturamento: (
      Object.prototype.hasOwnProperty.call(obj || {}, 'habilitar_expedicao')
      || Object.prototype.hasOwnProperty.call(obj || {}, 'habilitar_faturamento')
    )
      ? validation.config.habilitar_expedicao === true
      : resolverExpedicaoComercial(current) === true,
    ativar_midp: pickBool(obj, 'ativar_midp', validation.config, current),
    mpfc_modo: Object.prototype.hasOwnProperty.call(obj || {}, 'mpfc_modo')
      ? validation.config.mpfc_modo
      : (current.mpfc_modo || DEFAULT.mpfc_modo),
    mpfc_percentual_dinheiro_fiscal: Object.prototype.hasOwnProperty.call(obj || {}, 'mpfc_percentual_dinheiro_fiscal')
      ? validation.config.mpfc_percentual_dinheiro_fiscal
      : (current.mpfc_percentual_dinheiro_fiscal != null
        ? current.mpfc_percentual_dinheiro_fiscal
        : DEFAULT.mpfc_percentual_dinheiro_fiscal),
    mpfc_margem_minima_sobre_custo: Object.prototype.hasOwnProperty.call(obj || {}, 'mpfc_margem_minima_sobre_custo')
      ? validation.config.mpfc_margem_minima_sobre_custo
      : (current.mpfc_margem_minima_sobre_custo != null
        ? current.mpfc_margem_minima_sobre_custo
        : DEFAULT.mpfc_margem_minima_sobre_custo),
    mpfc_nunca_vender_abaixo_margem: pickBool(obj, 'mpfc_nunca_vender_abaixo_margem', validation.config, current),
    modulo_pdv: Object.prototype.hasOwnProperty.call(obj || {}, 'modulo_pdv')
      ? validation.config.modulo_pdv === true
      : current.modulo_pdv !== false,
    modulo_pedidos: Object.prototype.hasOwnProperty.call(obj || {}, 'modulo_pedidos')
      ? validation.config.modulo_pedidos
      : current.modulo_pedidos,
    modulo_nfe: Object.prototype.hasOwnProperty.call(obj || {}, 'modulo_nfe')
      ? validation.config.modulo_nfe
      : current.modulo_nfe,
    modulo_nfce: Object.prototype.hasOwnProperty.call(obj || {}, 'modulo_nfce')
      ? validation.config.modulo_nfce
      : current.modulo_nfce,
    modulo_historico_vendas: Object.prototype.hasOwnProperty.call(obj || {}, 'modulo_historico_vendas')
      ? validation.config.modulo_historico_vendas
      : current.modulo_historico_vendas,
    modulo_compra_facil: pickBool(obj, 'modulo_compra_facil', validation.config, current),
    modulo_marketplace: pickBool(obj, 'modulo_marketplace', validation.config, current),
    modulo_crm: pickBool(obj, 'modulo_crm', validation.config, current),
    licenca_dias_aviso: Object.prototype.hasOwnProperty.call(obj || {}, 'licenca_dias_aviso')
      ? validation.config.licenca_dias_aviso
      : (current.licenca_dias_aviso || DEFAULT.licenca_dias_aviso),
    licenca_chave_pix: Object.prototype.hasOwnProperty.call(obj || {}, 'licenca_chave_pix')
      ? validation.config.licenca_chave_pix
      : (current.licenca_chave_pix || ''),
    licenca_whatsapp_url: Object.prototype.hasOwnProperty.call(obj || {}, 'licenca_whatsapp_url')
      ? validation.config.licenca_whatsapp_url
      : (current.licenca_whatsapp_url || ''),
    licenca_mensagem_renovacao: Object.prototype.hasOwnProperty.call(obj || {}, 'licenca_mensagem_renovacao')
      ? validation.config.licenca_mensagem_renovacao
      : normalizeLicencaMensagem(current.licenca_mensagem_renovacao),
    licenca_plano: Object.prototype.hasOwnProperty.call(obj || {}, 'licenca_plano')
      ? validation.config.licenca_plano
      : (current.licenca_plano || ''),
    imprimir_comprovante_entrega: pickBool(obj, 'imprimir_comprovante_entrega', validation.config, current),
    imprimir_comprovante_prestacao: pickBool(obj, 'imprimir_comprovante_prestacao', validation.config, current),
    imprimir_danfe_nfce_entrega: pickBool(obj, 'imprimir_danfe_nfce_entrega', validation.config, current),
    imprimir_cupom_nao_fiscal_entrega: pickBool(obj, 'imprimir_cupom_nao_fiscal_entrega', validation.config, current),
    entrega_alerta_horas_aguardando: pickNum(obj, 'entrega_alerta_horas_aguardando', validation.config, current, 2),
    entrega_alerta_horas_reserva: pickNum(obj, 'entrega_alerta_horas_reserva', validation.config, current, 4),
    entrega_alerta_horas_parado: pickNum(obj, 'entrega_alerta_horas_parado', validation.config, current, 3)
  };

  ensureConfigFile();
  fs.writeFileSync(getConfigPath(), JSON.stringify(toSave, null, 2), 'utf8');
  syncElectronConfig(toSave);
  reloadGlobalConfig();
  return toSave;
}

function savePadraoFiscal(obj) {
  const current = readConfig();
  const padrao = normalizePadraoFiscal(obj);
  const toSave = { ...current, ...padrao };

  ensureConfigFile();
  fs.writeFileSync(getConfigPath(), JSON.stringify(toSave, null, 2), 'utf8');
  reloadGlobalConfig();
  return toSave;
}

function recursoHabilitado(nomeRecurso) {
  const recursos = getRecursos().recursos;
  // RC8.0.3 — canônico = expedicao; faturamento = alias de API do módulo comercial
  if (nomeRecurso === 'expedicao' || nomeRecurso === 'faturamento') {
    return recursos.expedicao === true;
  }
  return recursos[nomeRecurso] === true;
}

/** RC8.0.0 — ponto único: módulo fiscal contratado (NF-e e/ou NFC-e). */
function fiscalHabilitado(cfg) {
  if (cfg) {
    return getRecursos(cfg).recursos.fiscal === true;
  }
  return recursoHabilitado('fiscal');
}

/** RC8.0.3 — Expedição (módulo comercial) contratada. Independente de fiscal. */
function expedicaoHabilitada(cfg) {
  if (cfg) {
    return getRecursos(cfg).recursos.expedicao === true;
  }
  return recursoHabilitado('expedicao');
}

function obterModoEstacaoLocal() {
  ensureConfigFile();
  return readElectronStationConfig();
}

function voltarModoLocalEstacao() {
  const current = readElectronStationConfig();
  return saveElectronStationConfig({
    modo: 'local',
    porta: current.porta || DEFAULT.porta
  });
}

function salvarModoEstacaoLocal({ modo, ipServidor, porta }) {
  const modoNormalizado = String(modo || 'local').trim().toLowerCase() === 'cliente' ? 'cliente' : 'local';
  const current = readConfig();

  if (modoNormalizado === 'cliente' && current.tipoImplantacao !== 'ERP_MULTICAIXA') {
    saveConfig({
      ...current,
      tipoImplantacao: 'ERP_MULTICAIXA',
      modoOperacao: current.modoOperacao,
      ipServidor: current.ipServidor,
      porta: current.porta,
      modo_confirmacao_fiscal: current.modo_confirmacao_fiscal
    });
  }

  return saveElectronStationConfig({
    modo: modoNormalizado,
    ipServidor: modoNormalizado === 'cliente' ? String(ipServidor || '').trim() : '',
    porta
  });
}

module.exports = {
  get CONFIG_PATH() { return getConfigPath(); },
  get ELECTRON_CONFIG_PATH() { return getElectronConfigPath(); },
  DEFAULT,
  MENSAGEM_RENOVACAO_PADRAO,
  TIPOS,
  MODOS,
  MODOS_CONFIRMACAO_FISCAL,
  getModoConfirmacaoFiscal,
  isMidpAtivado,
  normalizeModoConfirmacaoFiscal,
  getDbDir,
  getConfigPath,
  getElectronConfigPath,
  readConfig,
  saveConfig,
  savePadraoFiscal,
  getPadraoFiscal,
  normalizePadraoFiscal,
  validateConfig,
  ensureConfigFile,
  getRecursos,
  getLicenciamentoCds,
  resolveModuloFlag,
  getModoRedeElectron,
  getModoRedeEstacaoElectron,
  readElectronStationConfig,
  saveElectronStationConfig,
  syncElectronConfig,
  reloadGlobalConfig,
  recursoHabilitado,
  fiscalHabilitado,
  expedicaoHabilitada,
  resolverExpedicaoComercial,
  obterModoEstacaoLocal,
  voltarModoLocalEstacao,
  salvarModoEstacaoLocal,
  getRecoveryFlagPath,
  criarFlagForcarModoLocal,
  consumirFlagForcarModoLocal
};
