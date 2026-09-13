/**
 * CentralConfiguracaoService — Provider operacional da Central (RC4 + RC3.1).
 *
 * RC3.1 — Fonte fiscal única:
 *   Ambiente SEFAZ + UF emitente + certificado + CNPJ vêm exclusivamente de
 *   getFiscalConfig() (Configurações Avançadas → fiscal_ambiente / fiscal_uf_*).
 *   A Central NÃO persiste nem grava ambiente/UF emitente.
 *
 * Endpoints DF-e e Manifestação (SOAP) vêm exclusivamente do UrlResolver (Plataforma Fiscal).
 * Timeouts, sync, proxy e debug permanecem na tabela central_entradas_config.
 *
 * Demais módulos da Central NÃO devem importar getFiscalConfig diretamente —
 * consomem via obterContextoOperacional() / obterPainelCompleto().
 *
 * @module motores/central-entradas/services/CentralConfiguracaoService
 */

const path = require('path');
const fs = require('fs');
const CentralConfiguracaoRepository = require('../repositories/CentralConfiguracaoRepository');
const CentralConfigService = require('./CentralConfigService');
const centralEntradasFlags = require('../config/centralEntradasFlags');
const { logCentral, logCentralErro } = require('../utils/centralLog');

const CHAVES = Object.freeze({
  URL_DFE_PROD: 'sefaz_url_dfe_producao',
  URL_DFE_HOM: 'sefaz_url_dfe_homologacao',
  URL_CONSULTA_PROD: 'sefaz_url_consulta_chave_producao',
  URL_CONSULTA_HOM: 'sefaz_url_consulta_chave_homologacao',
  URL_MANIF_PROD: 'sefaz_url_manifestacao_producao',
  URL_MANIF_HOM: 'sefaz_url_manifestacao_homologacao',
  VERSAO_SERVICO: 'sefaz_versao_servico',
  TIMEOUT_MS: 'sefaz_timeout_ms',
  MAX_TENTATIVAS: 'sefaz_max_tentativas',
  INTERVALO_TENTATIVAS: 'sefaz_intervalo_tentativas_ms',
  POLITICA_MANIFESTACAO: 'manifestacao_destinatario_politica',
  REPROCESSAMENTO: 'sync_reprocessamento_automatico',
  HTTP_TIMEOUT: 'http_timeout_ms',
  HTTP_RETRY: 'http_retry',
  PROXY_HAB: 'proxy_habilitado',
  PROXY_URL: 'proxy_url',
  LOG_DETALHADO: 'log_detalhado',
  MODO_DEBUG: 'modo_debug',
  RECUP_XML_ATIVA: 'recuperacao_xml_ativa',
  RECUP_XML_INTERVALO: 'recuperacao_xml_intervalo_minutos',
  RECUP_XML_MAX_TENT: 'recuperacao_xml_max_tentativas',
  RECUP_XML_MAX_DIAS: 'recuperacao_xml_max_dias_monitoramento',
  RECUP_XML_LOTE: 'recuperacao_xml_lote_por_ciclo'
});

const POLITICAS_MANIFESTACAO = Object.freeze([
  'MANUAL',
  'AUTOMATICA_CIENCIA',
  'CONFIRMAR_OPERADOR'
]);

/** Campos de endpoint SOAP que a Central não persiste nem usa (UrlResolver). */
const CAMPOS_ENDPOINT_SOAP_IGNORADOS = Object.freeze([
  'urlDistribuicaoDfeProducao',
  'urlDistribuicaoDfeHomologacao',
  'urlConsultaChaveProducao',
  'urlConsultaChaveHomologacao',
  'urlManifestacaoProducao',
  'urlManifestacaoHomologacao'
]);

/**
 * Campos oficiais do cadastro fiscal — Central só consome (RC3.1).
 * Também ignora chaves legadas no flat do PUT.
 */
const CAMPOS_FISCAL_SOMENTE_LEITURA = Object.freeze([
  'ambiente',
  'uf',
  'codigoUf',
  'codigo',
  'central_ambiente',
  'central_uf',
  'central_codigo_uf'
]);

class CentralConfiguracaoService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    /** @private */
    this._repository = deps.configuracaoRepository
      ?? deps.configRepository
      ?? new CentralConfiguracaoRepository();
    /** @private */
    this._syncConfig = deps.syncConfigService
      ?? new CentralConfigService({
        configRepository: this._repository,
        flags: deps.flags ?? centralEntradasFlags
      });
    /** @private */
    this._flags = deps.flags ?? centralEntradasFlags;
    /** @private */
    this._getFiscalConfig = deps.getFiscalConfig
      || (() => require('../../../services/fiscal/configService').getFiscalConfig({ validarUrls: false }));
    /** @private */
    this._carregarCertificado = deps.carregarCertificado
      || ((p, s) => require('../../../services/fiscal/certificateService').carregarCertificadoPfx(p, s));
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterPainelCompleto() {
    await this._repository.ensureDefaults();
    const [sync, mapa, certificado, meta, fiscalSnap] = await Promise.all([
      this._syncConfig.obterResumo(),
      this._obterMapaValores(),
      this._obterVisaoCertificado(),
      this._obterMetadadosAlteracao(),
      this._obterSnapshotFiscal()
    ]);

    const ambienteCode = fiscalSnap.ambiente;
    const endpointsDfe = this._resolverEndpointsDfe();
    const endpointsManif = this._resolverEndpointsManifestacao();
    const endpointsConsulta = this._resolverEndpointsConsultaChave();
    const politicaManifestacao = POLITICAS_MANIFESTACAO.includes(mapa[CHAVES.POLITICA_MANIFESTACAO])
      ? mapa[CHAVES.POLITICA_MANIFESTACAO]
      : 'MANUAL';

    return {
      versaoConfiguracao: 'RC4',
      unificacaoFiscal: 'RC3.1',
      ambiente: {
        codigo: ambienteCode,
        label: ambienteCode === 1 ? 'Produção' : 'Homologação',
        uf: fiscalSnap.uf,
        codigoUf: fiscalSnap.codigoUf,
        somenteLeitura: true,
        origem: 'getFiscalConfig',
        origemLabel: 'Centro de Configurações (fonte oficial)',
        atualizadoEm: meta.atualizadoEm,
        ultimaAlteracao: meta.ultimaAlteracao
      },
      sefaz: {
        urlDistribuicaoDfe: ambienteCode === 1 ? endpointsDfe.producao : endpointsDfe.homologacao,
        urlDistribuicaoDfeProducao: endpointsDfe.producao,
        urlDistribuicaoDfeHomologacao: endpointsDfe.homologacao,
        origemEndpointDfe: 'UrlResolver',
        endpointsEditaveis: false,
        // RC4.3.1 — Consulta chave somente leitura via Registry → UrlResolver
        urlConsultaChave: ambienteCode === 1 ? endpointsConsulta.producao : endpointsConsulta.homologacao,
        urlConsultaChaveProducao: endpointsConsulta.producao,
        urlConsultaChaveHomologacao: endpointsConsulta.homologacao,
        origemEndpointConsulta: 'UrlResolver',
        endpointConsultaResolvido: Boolean(endpointsConsulta.producao && endpointsConsulta.homologacao),
        // RC4.1 — URLs de Manifestação somente leitura, resolvidas via Registry → UrlResolver
        urlManifestacao: ambienteCode === 1 ? endpointsManif.producao : endpointsManif.homologacao,
        urlManifestacaoProducao: endpointsManif.producao,
        urlManifestacaoHomologacao: endpointsManif.homologacao,
        origemEndpointManifestacao: 'UrlResolver',
        endpointManifestacaoResolvido: Boolean(endpointsManif.producao && endpointsManif.homologacao),
        versaoServico: mapa[CHAVES.VERSAO_SERVICO] || '1.01',
        timeoutMs: Number(mapa[CHAVES.TIMEOUT_MS]) || 90000,
        maxTentativas: Number(mapa[CHAVES.MAX_TENTATIVAS]) || 2,
        intervaloTentativasMs: Number(mapa[CHAVES.INTERVALO_TENTATIVAS]) || 3000,
        manifestacaoPreparada: true,
        // Compat: "ativa" = automática; UI RC4.1 usa politicaManifestacao (um único estado)
        manifestacaoAtiva: politicaManifestacao === 'AUTOMATICA_CIENCIA',
        politicaManifestacao,
        politicaManifestacaoLabel: this._labelPoliticaManifestacao(politicaManifestacao),
        politicasManifestacaoDisponiveis: [...POLITICAS_MANIFESTACAO]
      },
      plataformaFiscal: {
        registry: true,
        urlResolver: true,
        soapTransport: true,
        endpointResolvido: Boolean(
          (ambienteCode === 1 ? endpointsDfe.producao : endpointsDfe.homologacao)
          && (ambienteCode === 1 ? endpointsManif.producao : endpointsManif.homologacao)
          && (ambienteCode === 1 ? endpointsConsulta.producao : endpointsConsulta.homologacao)
        ),
        modo: this._labelPoliticaManifestacao(politicaManifestacao),
        modoCodigo: politicaManifestacao
      },
      certificado,
      sincronizacao: {
        ...sync,
        reprocessamentoAutomatico: mapa[CHAVES.REPROCESSAMENTO] !== false
      },
      recuperacaoXml: {
        ativa: mapa[CHAVES.RECUP_XML_ATIVA] !== false,
        intervaloMinutos: Number(mapa[CHAVES.RECUP_XML_INTERVALO]) || 60,
        maxTentativas: Number(mapa[CHAVES.RECUP_XML_MAX_TENT]) || 48,
        maxDiasMonitoramento: Number(mapa[CHAVES.RECUP_XML_MAX_DIAS]) || 30,
        lotePorCiclo: Number(mapa[CHAVES.RECUP_XML_LOTE]) || 5,
        intervalosPermitidos: [30, 60, 120, 360, 1440]
      },
      diagnostico: await this._obterResumoDiagnostico(),
      avancado: {
        httpTimeoutMs: Number(mapa[CHAVES.HTTP_TIMEOUT]) || 90000,
        httpRetry: Number(mapa[CHAVES.HTTP_RETRY]) || 2,
        proxyHabilitado: mapa[CHAVES.PROXY_HAB] === true,
        proxyUrl: mapa[CHAVES.PROXY_URL] || '',
        proxyFuncional: false,
        logDetalhado: mapa[CHAVES.LOG_DETALHADO] === true,
        modoDebug: mapa[CHAVES.MODO_DEBUG] === true
      },
      certificadosFiliais: certificado.presente
        ? [{ id: 'principal', nome: certificado.nome || 'Principal', cnpj: certificado.cnpj, status: certificado.status }]
        : [],
      preparadoPara: ['manifestacao', 'cte', 'mdfe', 'nfse', 'multiplos_cnpjs', 'proxy']
    };
  }

  /**
   * Contexto operacional para sync/SOAP — único contrato interno.
   * Ambiente/UF/certificado/CNPJ: sempre getFiscalConfig (RC3.1).
   * @returns {Promise<{ ok: boolean, codigoErro?: string, mensagem?: string, contexto?: Object }>}
   */
  async obterContextoOperacional() {
    await this._repository.ensureDefaults();
    const mapa = await this._obterMapaValores();
    const sync = await this._syncConfig.obterResumo();

    let fiscal = {};
    try {
      fiscal = await this._getFiscalConfig();
    } catch (error) {
      return {
        ok: false,
        codigoErro: 'CONFIG_FISCAL',
        mensagem: this._mensagemAmigavel(error.message)
      };
    }

    const ambiente = this._ambienteDeFiscal(fiscal);
    const ufSnap = this._ufDeFiscal(fiscal);

    const certificadoPath = fiscal.certificadoPath || null;
    const certificadoSenha = fiscal.certificadoSenha || null;
    const cnpj = String(fiscal.cnpj || '').replace(/\D/g, '');

    if (!certificadoPath || !certificadoSenha) {
      return {
        ok: false,
        codigoErro: 'CERTIFICADO',
        mensagem: 'Certificado digital não configurado. Configure em Configurações Avançadas → Fiscal.'
      };
    }

    if (!cnpj || cnpj.length !== 14) {
      return {
        ok: false,
        codigoErro: 'CNPJ',
        mensagem: 'CNPJ do emitente não configurado. Verifique o cadastro fiscal da empresa.'
      };
    }

    if (!fs.existsSync(certificadoPath)) {
      return {
        ok: false,
        codigoErro: 'CERTIFICADO',
        mensagem: 'Arquivo do certificado não encontrado no caminho configurado.'
      };
    }

    const urlDfe = this._resolverEndpointDfe(ambiente);
    if (!urlDfe) {
      return {
        ok: false,
        codigoErro: 'URL_SEFAZ',
        mensagem: 'Endpoint DF-e não resolvido pela Plataforma Fiscal (UrlResolver).'
      };
    }

    return {
      ok: true,
      contexto: {
        ambiente,
        uf: ufSnap.uf,
        codigoUf: ufSnap.codigoUf,
        origemAmbiente: 'getFiscalConfig',
        cnpj,
        certificadoPath,
        certificadoSenha,
        urls: {
          // Somente informativo — SOAP usa UrlResolver em distribuicaoDfeRuntime
          distribuicaoDfe: urlDfe,
          origemDistribuicaoDfe: 'UrlResolver',
          consultaChave: this._urlPorAmbiente(ambiente, mapa[CHAVES.URL_CONSULTA_PROD], mapa[CHAVES.URL_CONSULTA_HOM]),
          manifestacao: this._urlPorAmbiente(ambiente, mapa[CHAVES.URL_MANIF_PROD], mapa[CHAVES.URL_MANIF_HOM])
        },
        versaoServico: mapa[CHAVES.VERSAO_SERVICO] || '1.01',
        timeoutMs: Number(mapa[CHAVES.TIMEOUT_MS]) || Number(mapa[CHAVES.HTTP_TIMEOUT]) || 90000,
        maxTentativas: Number(mapa[CHAVES.MAX_TENTATIVAS]) || 2,
        intervaloTentativasMs: Number(mapa[CHAVES.INTERVALO_TENTATIVAS]) || 3000,
        syncMaxDocumentos: sync.syncMaxDocumentos,
        politicaManifestacao: POLITICAS_MANIFESTACAO.includes(mapa[CHAVES.POLITICA_MANIFESTACAO])
          ? mapa[CHAVES.POLITICA_MANIFESTACAO]
          : 'MANUAL',
        reprocessamentoAutomatico: mapa[CHAVES.REPROCESSAMENTO] !== false,
        logDetalhado: mapa[CHAVES.LOG_DETALHADO] === true,
        modoDebug: mapa[CHAVES.MODO_DEBUG] === true
      }
    };
  }

  /**
   * @param {Object} alteracoes
   * @returns {Promise<Object>}
   */
  async atualizar(alteracoes = {}) {
    await this._repository.ensureDefaults();

    const syncCampos = [
      'syncAutomaticaHabilitada', 'syncIntervaloMinutos', 'syncAoAbrir',
      'syncMaxDocumentos', 'horarioPermitidoInicio', 'horarioPermitidoFim',
      'horarioBloqueadoInicio', 'horarioBloqueadoFim', 'notificarNovasNotas'
    ];
    const syncPayload = {};
    for (const c of syncCampos) {
      if (alteracoes[c] !== undefined) syncPayload[c] = alteracoes[c];
      if (alteracoes.sincronizacao && alteracoes.sincronizacao[c] !== undefined) {
        syncPayload[c] = alteracoes.sincronizacao[c];
      }
    }
    if (Object.keys(syncPayload).length) {
      await this._syncConfig.atualizar(syncPayload);
    }

    const mapaCampos = {
      versaoServico: [CHAVES.VERSAO_SERVICO, 'string'],
      timeoutMs: [CHAVES.TIMEOUT_MS, 'number'],
      maxTentativas: [CHAVES.MAX_TENTATIVAS, 'number'],
      intervaloTentativasMs: [CHAVES.INTERVALO_TENTATIVAS, 'number'],
      politicaManifestacao: [CHAVES.POLITICA_MANIFESTACAO, 'string'],
      reprocessamentoAutomatico: [CHAVES.REPROCESSAMENTO, 'boolean'],
      httpTimeoutMs: [CHAVES.HTTP_TIMEOUT, 'number'],
      httpRetry: [CHAVES.HTTP_RETRY, 'number'],
      proxyHabilitado: [CHAVES.PROXY_HAB, 'boolean'],
      proxyUrl: [CHAVES.PROXY_URL, 'string'],
      logDetalhado: [CHAVES.LOG_DETALHADO, 'boolean'],
      modoDebug: [CHAVES.MODO_DEBUG, 'boolean'],
      recuperacaoXmlAtiva: [CHAVES.RECUP_XML_ATIVA, 'boolean'],
      recuperacaoXmlIntervaloMinutos: [CHAVES.RECUP_XML_INTERVALO, 'number'],
      recuperacaoXmlMaxTentativas: [CHAVES.RECUP_XML_MAX_TENT, 'number'],
      recuperacaoXmlMaxDias: [CHAVES.RECUP_XML_MAX_DIAS, 'number'],
      recuperacaoXmlLotePorCiclo: [CHAVES.RECUP_XML_LOTE, 'number']
    };

    const flat = {
      ...alteracoes,
      ...(alteracoes.sefaz || {}),
      ...(alteracoes.avancado || {}),
      ...(alteracoes.sincronizacao || {}),
      ...(alteracoes.recuperacaoXml
        ? {
          recuperacaoXmlAtiva: alteracoes.recuperacaoXml.ativa,
          recuperacaoXmlIntervaloMinutos: alteracoes.recuperacaoXml.intervaloMinutos,
          recuperacaoXmlMaxTentativas: alteracoes.recuperacaoXml.maxTentativas,
          recuperacaoXmlMaxDias: alteracoes.recuperacaoXml.maxDiasMonitoramento,
          recuperacaoXmlLotePorCiclo: alteracoes.recuperacaoXml.lotePorCiclo
        }
        : {})
    };
    // RC3.1 — bloco ambiente não é persistido (fonte oficial: getFiscalConfig)
    delete flat.ambiente;
    // RC4.3.1 — endpoints SOAP não são persistidos (fonte: UrlResolver)
    delete flat.urlConsultaChaveProducao;
    delete flat.urlConsultaChaveHomologacao;
    delete flat.urlManifestacaoProducao;
    delete flat.urlManifestacaoHomologacao;
    delete flat.urlDistribuicaoDfeProducao;
    delete flat.urlDistribuicaoDfeHomologacao;

    if (
      flat.politicaManifestacao !== undefined
      && !POLITICAS_MANIFESTACAO.includes(String(flat.politicaManifestacao))
    ) {
      throw new Error('Política de manifestação inválida.');
    }

    for (const campoIgnorado of CAMPOS_ENDPOINT_SOAP_IGNORADOS) {
      delete flat[campoIgnorado];
    }
    for (const campoIgnorado of CAMPOS_FISCAL_SOMENTE_LEITURA) {
      delete flat[campoIgnorado];
    }

    for (const [campo, valor] of Object.entries(flat)) {
      if (valor === undefined || !mapaCampos[campo]) continue;
      const [chave, tipo] = mapaCampos[campo];
      await this._repository.salvar(chave, valor, tipo);
    }

    await this._syncConfig.hidratarFlags();
    logCentral('CONFIG', { fase: 'atualizado', unificacaoFiscal: 'RC3.1' });

    // RC3.7.5 — reinicia motor se config de recuperação mudou
    try {
      const { obterMotorRecuperacaoXml } = require('../recuperacao-xml');
      const motor = obterMotorRecuperacaoXml();
      motor.parar({ silencioso: true });
      await motor.iniciar({ delayMs: 5000 });
    } catch { /* ignore */ }

    return this.obterPainelCompleto();
  }

  /**
   * Restaura defaults operacionais da Central (timeouts/sync/etc.).
   * Não toca fiscal_ambiente / UF emitente (fonte oficial externa).
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async restaurarPadrao(opcoes = {}) {
    await this._repository.ensureDefaults();
    for (const [chave, valor, tipo] of CentralConfiguracaoRepository.DEFAULTS) {
      if (!opcoes.incluirSync && String(chave).startsWith('sync_')) continue;
      await this._repository.salvar(chave, tipo === 'number' ? Number(valor) : (tipo === 'boolean' ? valor === 'true' : valor), tipo);
    }
    return this.obterPainelCompleto();
  }

  // —— Compatibilidade com CentralConfigService (sync) ——

  /**
   * Alias oficial RC5 — mesmo contrato de CentralConfigService.obterResumo().
   * @returns {Promise<Object>}
   */
  obterResumo() {
    return this.obterResumoSync();
  }

  obterResumoSync() {
    return this._syncConfig.obterResumo();
  }

  async obterPoliticaManifestacao() {
    await this._repository.ensureDefaults();
    const mapa = await this._obterMapaValores();
    return POLITICAS_MANIFESTACAO.includes(mapa[CHAVES.POLITICA_MANIFESTACAO])
      ? mapa[CHAVES.POLITICA_MANIFESTACAO]
      : 'MANUAL';
  }

  atualizarSync(alteracoes) {
    return this._syncConfig.atualizar(alteracoes);
  }

  hidratarFlags() {
    return this._syncConfig.hidratarFlags();
  }

  obterIntervaloMs() {
    return this._syncConfig.obterIntervaloMs();
  }

  verificarHorarioPermitido(agora) {
    return this._syncConfig.verificarHorarioPermitido(agora);
  }

  /** @private */
  async _obterMapaValores() {
    const registros = await this._repository.listarTodas();
    const mapa = {};
    for (const reg of registros) {
      mapa[reg.chave] = this._repository.parseValor(reg);
    }
    return mapa;
  }

  /**
   * Snapshot seguro do cadastro fiscal oficial (nunca falha o painel).
   * @private
   * @returns {Promise<{ ambiente: number, uf: string, codigoUf: string }>}
   */
  async _obterSnapshotFiscal() {
    try {
      const fiscal = await this._getFiscalConfig();
      return {
        ambiente: this._ambienteDeFiscal(fiscal),
        ...this._ufDeFiscal(fiscal)
      };
    } catch {
      return { ambiente: 2, uf: 'CE', codigoUf: '23' };
    }
  }

  /**
   * @private
   * @param {Object} fiscal
   * @returns {number} 1|2
   */
  _ambienteDeFiscal(fiscal = {}) {
    const code = Number(fiscal.ambiente ?? fiscal.fiscal_ambiente);
    return code === 1 ? 1 : 2;
  }

  /**
   * @private
   * @param {Object} fiscal
   * @returns {{ uf: string, codigoUf: string }}
   */
  _ufDeFiscal(fiscal = {}) {
    const uf = String(fiscal.uf || fiscal.fiscal_uf_sigla || fiscal.fiscal_uf || 'CE').trim().toUpperCase() || 'CE';
    const codigoUf = String(fiscal.codigoUf || fiscal.fiscal_codigo_uf || '23').replace(/\D/g, '').padStart(2, '0') || '23';
    return { uf, codigoUf };
  }

  /**
   * Resolve endpoint DF-e via Plataforma Fiscal (UrlResolver + Registry).
   * A Central não monta nem armazena a URL SOAP efetiva.
   * @private
   * @param {number} ambienteCode 1|2
   * @returns {string|null}
   */
  _resolverEndpointDfe(ambienteCode) {
    try {
      const { FiscalWebServices } = require('../../../services/fiscal/core/FiscalWebServices');
      const { ModelType } = require('../../../services/fiscal/core/ModelType');
      const { OperationType } = require('../../../services/fiscal/core/OperationType');
      const { fromAmbienteCode } = require('../../../services/fiscal/core/EnvironmentType');
      const { UF_AN } = require('../../../services/fiscal/core/RegistryBuilder');

      const ambiente = fromAmbienteCode(ambienteCode);
      if (!ambiente) return null;

      const resolution = new FiscalWebServices().resolve({
        modelo: ModelType.NFE,
        operacao: OperationType.DISTRIBUICAO_DFE,
        ambiente,
        uf: UF_AN,
        versao: '1.01'
      });

      return resolution.success && resolution.definition?.endpoint
        ? resolution.definition.endpoint
        : null;
    } catch (error) {
      logCentralErro('CONFIG', { fase: 'resolver-dfe', erro: error.message });
      return null;
    }
  }

  /**
   * @private
   * @returns {{ producao: string, homologacao: string }}
   */
  _resolverEndpointsDfe() {
    return {
      producao: this._resolverEndpointDfe(1) || '',
      homologacao: this._resolverEndpointDfe(2) || ''
    };
  }

  /**
   * Resolve endpoint de Manifestação (RecepcaoEvento) via Plataforma Fiscal.
   * Somente leitura para o painel — não altera Registry/UrlResolver/Runtime.
   * @private
   * @param {number} ambienteCode 1|2
   * @returns {string|null}
   */
  _resolverEndpointManifestacao(ambienteCode) {
    try {
      const { FiscalWebServices } = require('../../../services/fiscal/core/FiscalWebServices');
      const { ModelType } = require('../../../services/fiscal/core/ModelType');
      const { OperationType } = require('../../../services/fiscal/core/OperationType');
      const { fromAmbienteCode } = require('../../../services/fiscal/core/EnvironmentType');
      const { UF_AN } = require('../../../services/fiscal/core/RegistryBuilder');

      const ambiente = fromAmbienteCode(ambienteCode);
      if (!ambiente) return null;

      const resolution = new FiscalWebServices().resolve({
        modelo: ModelType.NFE,
        operacao: OperationType.MANIFESTACAO_CIENCIA,
        ambiente,
        uf: UF_AN,
        versao: '1.00'
      });

      return resolution.success && resolution.definition?.endpoint
        ? resolution.definition.endpoint
        : null;
    } catch (error) {
      logCentralErro('CONFIG', { fase: 'resolver-manifestacao', erro: error.message });
      return null;
    }
  }

  /**
   * @private
   * @returns {{ producao: string, homologacao: string }}
   */
  _resolverEndpointsManifestacao() {
    return {
      producao: this._resolverEndpointManifestacao(1) || '',
      homologacao: this._resolverEndpointManifestacao(2) || ''
    };
  }

  /**
   * Resolve endpoint de Consulta por chave (consSitNFe) via Plataforma Fiscal.
   * RC4.3.1 — somente leitura no painel; não altera Registry/UrlResolver/Runtime.
   * @private
   * @param {number} ambienteCode 1|2
   * @returns {string|null}
   */
  _resolverEndpointConsultaChave(ambienteCode) {
    try {
      const { FiscalWebServices } = require('../../../services/fiscal/core/FiscalWebServices');
      const { ModelType } = require('../../../services/fiscal/core/ModelType');
      const { OperationType } = require('../../../services/fiscal/core/OperationType');
      const { fromAmbienteCode } = require('../../../services/fiscal/core/EnvironmentType');
      const { UF_SVRS } = require('../../../services/fiscal/core/RegistryBuilder');

      const ambiente = fromAmbienteCode(ambienteCode);
      if (!ambiente) return null;

      const resolution = new FiscalWebServices().resolve({
        modelo: ModelType.NFE,
        operacao: OperationType.CONSULTA_PROTOCOLO,
        ambiente,
        uf: UF_SVRS,
        versao: '4.00'
      });

      return resolution.success && resolution.definition?.endpoint
        ? resolution.definition.endpoint
        : null;
    } catch (error) {
      logCentralErro('CONFIG', { fase: 'resolver-consulta-chave', erro: error.message });
      return null;
    }
  }

  /**
   * @private
   * @returns {{ producao: string, homologacao: string }}
   */
  _resolverEndpointsConsultaChave() {
    return {
      producao: this._resolverEndpointConsultaChave(1) || '',
      homologacao: this._resolverEndpointConsultaChave(2) || ''
    };
  }

  /**
   * @private
   * @param {string} politica
   * @returns {string}
   */
  _labelPoliticaManifestacao(politica) {
    const mapa = {
      AUTOMATICA_CIENCIA: 'Automática',
      CONFIRMAR_OPERADOR: 'Solicitar Confirmação',
      MANUAL: 'Manual'
    };
    return mapa[politica] || 'Manual';
  }

  /** @private */
  _urlPorAmbiente(ambiente, prod, hom) {
    return Number(ambiente) === 1 ? (prod || '') : (hom || '');
  }

  /** @private */
  async _obterVisaoCertificado() {
    try {
      const fiscal = await this._getFiscalConfig();
      const certificadoPath = fiscal.certificadoPath;
      if (!certificadoPath) {
        return {
          presente: false,
          nome: null,
          cnpj: fiscal.cnpj || null,
          validade: null,
          diasRestantes: null,
          status: 'AUSENTE',
          caminho: null,
          mensagem: 'Nenhum certificado configurado — edite em Configurações Avançadas'
        };
      }

      const existe = fs.existsSync(certificadoPath);
      if (!existe) {
        return {
          presente: false,
          nome: path.basename(certificadoPath),
          cnpj: fiscal.cnpj || null,
          validade: null,
          diasRestantes: null,
          status: 'ARQUIVO_AUSENTE',
          caminho: certificadoPath,
          mensagem: 'Arquivo do certificado não encontrado'
        };
      }

      try {
        const cert = this._carregarCertificado(certificadoPath, fiscal.certificadoSenha);
        let validade = null;
        let diasRestantes = null;
        let status = 'OK';
        let nome = path.basename(certificadoPath);
        try {
          const forge = require('node-forge');
          const x509 = forge.pki.certificateFromPem(cert.certPem);
          validade = x509.validity.notAfter;
          diasRestantes = Math.ceil((validade.getTime() - Date.now()) / 86400000);
          if (diasRestantes < 0) status = 'VENCIDO';
          else if (diasRestantes <= 30) status = 'A_VENCER';
          const cn = x509.subject.getField('CN');
          if (cn?.value) nome = cn.value;
        } catch { /* ignore parse */ }

        return {
          presente: true,
          nome,
          cnpj: fiscal.cnpj || null,
          validade: validade ? new Date(validade).toISOString() : null,
          diasRestantes,
          status,
          caminho: certificadoPath,
          mensagem: status === 'OK' ? 'Certificado válido' : status
        };
      } catch (error) {
        return {
          presente: true,
          nome: path.basename(certificadoPath),
          cnpj: fiscal.cnpj || null,
          validade: null,
          diasRestantes: null,
          status: 'ERRO',
          caminho: certificadoPath,
          mensagem: this._mensagemAmigavel(error.message)
        };
      }
    } catch (error) {
      return {
        presente: false,
        nome: null,
        cnpj: null,
        validade: null,
        diasRestantes: null,
        status: 'ERRO',
        caminho: null,
        mensagem: this._mensagemAmigavel(error.message)
      };
    }
  }

  /** @private */
  async _obterMetadadosAlteracao() {
    const registros = await this._repository.listarTodas();
    let latest = null;
    for (const reg of registros) {
      if (!reg.updatedAt) continue;
      if (!latest || String(reg.updatedAt) > String(latest)) latest = reg.updatedAt;
    }
    return {
      atualizadoEm: latest,
      ultimaAlteracao: latest
    };
  }

  /** @private */
  async _obterResumoDiagnostico() {
    const { VERSAO_MODULO } = require('../CentralEntradasOrchestrator');
    let tempoMedio = null;
    let ultimaSync = null;
    let ultimoErro = null;
    try {
      const eventos = require('./CentralEventosService');
      const svc = new eventos();
      tempoMedio = await svc.obterTempoMedioSyncMs();
      ultimaSync = await svc.obterUltimaSyncConcluida();
      ultimoErro = await svc.obterUltimoErroSync();
    } catch { /* ignore */ }

    return {
      versaoCentral: VERSAO_MODULO,
      versaoPipeline: 'RC3',
      versaoParser: 'oficial',
      versaoMiip: 'RC1',
      tempoMedioSyncMs: tempoMedio,
      ultimaSincronizacao: ultimaSync?.createdAt || null,
      ultimoErro: ultimoErro?.descricao || null,
      sefazOperacional: (() => {
        try {
          return require('./CentralSefazOperationalGate').obterPainelOperacional();
        } catch {
          return null;
        }
      })()
    };
  }

  /** @private */
  _mensagemAmigavel(msg) {
    const m = String(msg || '');
    if (/certificado/i.test(m)) return 'Certificado digital ausente ou inválido. Configure em Configurações Avançadas → Fiscal.';
    if (/cnpj/i.test(m)) return 'CNPJ do emitente não configurado.';
    if (/ambiente fiscal/i.test(m)) return 'Ambiente fiscal não configurado. Defina em Configurações Avançadas.';
    if (/url|autoriza/i.test(m)) return 'Configuração SEFAZ incompleta. Verifique a aba SEFAZ.';
    if (/timeout|ECONNABORTED/i.test(m)) return 'A SEFAZ não respondeu a tempo. Tente novamente.';
    return m || 'Falha na configuração operacional da Central.';
  }
}

CentralConfiguracaoService.CHAVES = CHAVES;
CentralConfiguracaoService.CAMPOS_FISCAL_SOMENTE_LEITURA = CAMPOS_FISCAL_SOMENTE_LEITURA;
CentralConfiguracaoService.POLITICAS_MANIFESTACAO = POLITICAS_MANIFESTACAO;

module.exports = CentralConfiguracaoService;
