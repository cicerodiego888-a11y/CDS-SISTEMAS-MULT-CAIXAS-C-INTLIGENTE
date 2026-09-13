/**
 * CentralEntradasOrchestrator — Orquestrador oficial da Central Inteligente de Entradas.
 *
 * RC1: único ponto de coordenação dos fluxos de negócio.
 * Padrão equivalente ao MiipOrchestrator.
 *
 * @class CentralEntradasOrchestrator
 */

const centralEntradasFlags = require('./config/centralEntradasFlags');
const { ORIGENS } = require('./config/centralEventosTipos');
const { isValido, DocumentoFiscalStatus } = require('./core/DocumentoFiscalStatus');
const CentralNsuService = require('./services/CentralNsuService');
const { listarPresets } = require('./utils/filtrosRapidosCentral');
const { paraDetalheCompletoDTO } = require('./utils/centralEntradasMapper');
const { gravarAuditoria } = require('../../services/auditoria');

const CentralDocumentosRepository = require('./repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('./repositories/CentralHistoricoRepository');
const CentralNsuRepository = require('./repositories/CentralNsuRepository');

const DocumentoTransitionService = require('./services/DocumentoTransitionService');
const CentralDocumentoService = require('./services/CentralDocumentoService');
const CentralHistoricoService = require('./services/CentralHistoricoService');
const CentralDashboardService = require('./services/CentralDashboardService');
const CentralSincronizacaoService = require('./services/CentralSincronizacaoService');
const CentralProcessamentoService = require('./services/CentralProcessamentoService');
const CentralComprasBridgeService = require('./services/CentralComprasBridgeService');
const CentralRevisaoPersistenteService = require('./services/CentralRevisaoPersistenteService');
const CentralScoreDocumentoService = require('./services/CentralScoreDocumentoService');
const CentralAlertasService = require('./services/CentralAlertasService');
const CentralScoreFornecedorService = require('./services/CentralScoreFornecedorService');
const CentralPendenciasService = require('./services/CentralPendenciasService');
const CentralOperacionalDashboardService = require('./services/CentralOperacionalDashboardService');
const CentralAtencaoService = require('./services/CentralAtencaoService');
const CentralConfiguracaoService = require('./services/CentralConfiguracaoService');
const CentralEventosService = require('./services/CentralEventosService');
const CentralNotificacoesService = require('./services/CentralNotificacoesService');
const CentralUploadService = require('./services/CentralUploadService');
const CentralSyncExecucaoService = require('./services/CentralSyncExecucaoService');
const CentralDiagnosticoService = require('./services/CentralDiagnosticoService');
const CentralManifestacaoDfeService = require('./services/CentralManifestacaoDfeService');
const CentralHomologacaoService = require('./services/CentralHomologacaoService');

const VERSAO_MODULO = '1.0.0-rc4';

class CentralEntradasOrchestrator {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    const repoDeps = { db: deps.db ?? null };
    const documentosRepository = deps.documentosRepository
      ?? new CentralDocumentosRepository(repoDeps);
    const historicoRepository = deps.historicoRepository
      ?? new CentralHistoricoRepository(repoDeps);
    const nsuRepository = deps.nsuRepository ?? new CentralNsuRepository(repoDeps);

    /** @private */
    this._flags = deps.flags ?? centralEntradasFlags;
    /** @private */
    this._documentosRepository = documentosRepository;
    /** @private */
    this._nsuRepository = nsuRepository;

    /** @private */
    this._transitionService = deps.transitionService ?? new DocumentoTransitionService({
      documentosRepository,
      historicoRepository
    });

    /** @private */
    this._historicoService = deps.historicoService
      ?? new CentralHistoricoService({ historicoRepository });

    /** @private */
    this._documentoService = deps.documentoService
      ?? new CentralDocumentoService({ documentosRepository });

    /** @private */
    this._dashboardService = deps.dashboardService
      ?? new CentralDashboardService({ documentosRepository, nsuRepository });

    /** @private */
    this._sincronizacaoService = deps.sincronizacaoService
      ?? new CentralSincronizacaoService({
        documentosRepository,
        nsuRepository,
        nsuService: deps.nsuService
          ?? new CentralNsuService({ nsuRepository }),
        configuracaoService: deps.configuracaoService
      });

    /** @private */
    this._nsuService = deps.nsuService
      ?? this._sincronizacaoService._nsuService
      ?? new CentralNsuService({ nsuRepository });

    /** @private */
    this._syncExecucao = deps.syncExecucao ?? CentralSyncExecucaoService;

    /** @private */
    this._processamentoService = deps.processamentoService
      ?? new CentralProcessamentoService({
        documentosRepository,
        historicoRepository,
        transitionService: this._transitionService
      });

    /** @private */
    this._revisaoPersistenteService = deps.revisaoPersistenteService
      ?? new CentralRevisaoPersistenteService({
        documentosRepository,
        db: deps.db ?? null
      });

    /** @private */
    this._comprasBridgeService = deps.comprasBridgeService
      ?? new CentralComprasBridgeService({
        documentosRepository,
        historicoRepository,
        transitionService: this._transitionService,
        revisaoPersistenteService: this._revisaoPersistenteService
      });

    /** @private */
    this._scoreDocumentoService = deps.scoreDocumentoService
      ?? new CentralScoreDocumentoService();

    /** @private */
    this._alertasService = deps.alertasService
      ?? new CentralAlertasService({ documentosRepository, nsuRepository });

    /** @private */
    this._scoreFornecedorService = deps.scoreFornecedorService
      ?? new CentralScoreFornecedorService({
        documentosRepository,
        scoreService: this._scoreDocumentoService
      });

    /** @private */
    this._pendenciasService = deps.pendenciasService
      ?? new CentralPendenciasService({
        documentosRepository,
        nsuRepository,
        alertasService: this._alertasService
      });

    /** @private */
    this._operacionalService = deps.operacionalService
      ?? new CentralOperacionalDashboardService({
        documentosRepository,
        nsuRepository,
        alertasService: this._alertasService
      });

    /** @private */
    this._atencaoService = deps.atencaoService
      ?? new CentralAtencaoService({
        documentosRepository,
        nsuRepository,
        alertasService: this._alertasService,
        pendenciasService: this._pendenciasService
      });

    /** @private */
    this._configuracaoService = deps.configuracaoService ?? new CentralConfiguracaoService({
      configuracaoRepository: deps.configuracaoRepository
    });
    /** @private @deprecated RC5 — use _configuracaoService; mantido só se injetado em testes legados */
    this._configService = deps.configService ?? this._configuracaoService;
    /** @private */
    this._manifestacaoDfeService = deps.manifestacaoDfeService
      ?? new CentralManifestacaoDfeService({
        db: deps.db ?? null,
        documentosRepository,
        historicoRepository,
        configuracaoService: this._configuracaoService,
        eventosRepository: deps.eventosRepository,
        nsuRepository,
        nsuService: this._nsuService,
        syncExecucao: this._syncExecucao
      });
    /** @private */
    this._eventosService = deps.eventosService ?? new CentralEventosService();
    /** @private */
    this._homologacaoService = deps.homologacaoService ?? new CentralHomologacaoService({
      db: deps.db ?? null,
      documentosRepository,
      nsuRepository,
      nsuService: this._nsuService,
      eventosRepository: deps.eventosRepository,
      historicoRepository
    });
    /** @private */
    this._notificacoesService = deps.notificacoesService ?? new CentralNotificacoesService();
    /** @private */
    this._uploadService = deps.uploadService ?? new CentralUploadService({
      processamentoService: this._processamentoService
    });

    /** @private */
    this._diagnosticoService = deps.diagnosticoService ?? new CentralDiagnosticoService({
      documentosRepository,
      nsuRepository,
      syncExecucao: this._syncExecucao
    });
  }

  /** @private */
  _obterSyncBackground() {
    return require('./services/CentralSyncBackgroundService');
  }

  /**
   * @returns {boolean}
   */
  estaHabilitado() {
    return this._flags.estaHabilitado();
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterHealth() {
    const [
      ultimoNsu,
      ultimoErro,
      ultimaSync,
      tempoMedioMs,
      statusServico
    ] = await Promise.all([
      this._nsuRepository.obterUltimaSincronizacao(),
      this._eventosService.obterUltimoErroSync(),
      this._eventosService.obterUltimaSyncConcluida(),
      this._eventosService.obterTempoMedioSyncMs(),
      Promise.resolve(this._obterSyncBackground().obterStatus())
    ]);

    return {
      modulo: 'central-entradas',
      versao: VERSAO_MODULO,
      habilitado: this.estaHabilitado(),
      status: statusServico.servicoAtivo ? 'ok' : 'ok',
      sprint: 'RC4',
      servicoAtivo: statusServico.servicoAtivo,
      syncAutomaticaHabilitada: statusServico.syncAutomaticaHabilitada,
      executandoSync: statusServico.executando,
      ultimaSincronizacao: ultimoNsu?.dataSincronizacao || ultimoNsu?.updatedAt || null,
      ultimoErro: ultimoErro
        ? { mensagem: ultimoErro.descricao, em: ultimoErro.createdAt }
        : null,
      tempoMedioSyncMs: tempoMedioMs,
      proximaExecucao: statusServico.proximaExecucao,
      ultimaExecucaoAutomatica: statusServico.ultimaExecucao,
      ultimaSyncEvento: ultimaSync
        ? {
          notasNovas: ultimaSync.notasNovas,
          duracaoMs: ultimaSync.duracaoMs,
          em: ultimaSync.createdAt
        }
        : null
    };
  }

  /**
   * @returns {Object}
   */
  obterMetadados() {
    const { TODOS: STATUS_TODOS, LABELS_UI } = require('./core/DocumentoFiscalStatus');
    return {
      modulo: 'Central Inteligente de Entradas',
      versao: VERSAO_MODULO,
      descricao: 'Caixa de Entrada Fiscal (Inbox) — sincroniza, armazena, organiza, monitora e disponibiliza documentos',
      estados: STATUS_TODOS.map((status) => ({
        codigo: status,
        label: LABELS_UI[status] || status
      })),
      filtrosRapidos: listarPresets()
    };
  }

  async listarDocumentos(filtros = {}) {
    const resultado = await this._documentoService.listar(filtros);
    try {
      resultado.documentos = await this._revisaoPersistenteService
        .enriquecerDocumentosComProgresso(resultado.documentos || []);
    } catch { /* ignore enrichment */ }
    return resultado;
  }

  async obterDocumento(id) {
    return this._documentoService.obterPorId(id);
  }

  async obterDocumentoDetalhe(id) {
    const documento = await this._documentoService.obterBrutoPorId(id);
    if (!documento) return null;

    const historico = await this._historicoService.listarPorDocumento(id);
    const detalhe = paraDetalheCompletoDTO(documento, historico);

    try {
      const [enriquecido] = await this._revisaoPersistenteService
        .enriquecerDocumentosComProgresso([detalhe.documento || documento]);
      if (detalhe.documento && enriquecido?.revisaoProgresso) {
        detalhe.documento.revisaoProgresso = enriquecido.revisaoProgresso;
      }
      detalhe.revisaoProgresso = enriquecido?.revisaoProgresso || null;
    } catch { /* ignore */ }

    // RC7.4.2 — informações operacionais do Gate + Scheduler.
    try {
      const xmlWait = require('./services/CentralXmlWaitScheduler');
      const gate = require('./services/CentralSefazOperationalGate');
      const estado = xmlWait.obterEstadoDocumento(id);
      if (estado && detalhe.documento) {
        detalhe.documento.xmlWait = estado;
        // RC3.4.4 — statusLabel coerente com SLEEP/Gate (não “SEFAZ sem XML”).
        try {
          const { resolverStatusReal } = require('./utils/centralDocumentalInteligente');
          detalhe.documento.statusLabel = resolverStatusReal(detalhe.documento, estado);
        } catch { /* ignore */ }
      }
      detalhe.xmlWaitTelemetria = xmlWait.obterTelemetria();
      detalhe.sefazOperacional = gate.obterPainelOperacional({
        documentosAguardando: detalhe.xmlWaitTelemetria?.documentosAguardando || 0,
        proximaConsultaPrevista: detalhe.xmlWaitTelemetria?.proximaConsultaPrevista || null,
        quantidadeTentativas: detalhe.xmlWaitTelemetria?.numeroTentativas || null
      });
    } catch { /* ignore */ }

    // RC3.4.3 — eventos + auditoria documental (somente leitura; sem SEFAZ).
    try {
      const {
        mapearEventosMirx,
        montarAuditoriaDocumental
      } = require('./utils/centralDocumentalInteligente');
      const log = await this._eventosService.listarLog({
        documentoId: id,
        limite: 80
      });
      detalhe.eventos = log.eventos || [];
      detalhe.eventosMirx = mapearEventosMirx(detalhe.eventos);
      detalhe.auditoriaDocumental = montarAuditoriaDocumental({
        doc: detalhe.documento,
        wait: detalhe.documento?.xmlWait || {},
        historico,
        eventosMirx: detalhe.eventosMirx
      });
    } catch {
      detalhe.eventos = detalhe.eventos || [];
      detalhe.eventosMirx = detalhe.eventosMirx || [];
    }

    // RC3.4.6 — saúde documental (somente leitura local).
    try {
      const health = require('./health');
      detalhe.saude = await health.obterMonitor().analisarDocumento(id);
      if (detalhe.documento) detalhe.documento.saude = detalhe.saude;
    } catch {
      detalhe.saude = null;
    }

    return detalhe;
  }

  async obterHistorico(documentoId) {
    return this._historicoService.listarPorDocumento(documentoId);
  }

  async obterDashboard() {
    return this._dashboardService.obterResumo();
  }

  /** RC3.4.6 — painel Saúde da Central (sem SEFAZ). */
  async obterSaudeCentral(opcoes = {}) {
    const health = require('./health');
    return health.obterMonitor().obterPainel(opcoes);
  }

  async listarAlertasSaude(filtros = {}) {
    const health = require('./health');
    await health.obterMonitor().obterPainel({});
    return health.obterMonitor().listarAlertas(filtros);
  }

  async obterSaudeDocumento(id) {
    const health = require('./health');
    const cached = health.obterMonitor().obterDocumento(id);
    if (cached) return cached;
    return health.obterMonitor().analisarDocumento(id);
  }

  async analisarSaudeCentral(opcoes = {}) {
    const health = require('./health');
    return health.forcarScan(opcoes);
  }

  /**
   * Processa documentos SINCRONIZADA sem parse (pipeline único Parser + MIIP).
   *
   * @param {Object} [opcoes]
   * @returns {Promise<Object[]>}
   */
  async processarDocumentosPendentes(opcoes = {}) {
    const limite = Math.min(Number(opcoes.limite) || 100, 200);
    const pendentes = await this._documentosRepository.listarPendentesProcessamento(limite);
    const resultados = [];

    for (const doc of pendentes) {
      // eslint-disable-next-line no-await-in-loop
      const resultado = await this._processamentoService.processar(doc.id, {
        usuarioId: opcoes.usuarioId
      });
      resultados.push({
        documentoId: doc.id,
        chave: doc.chave,
        ...resultado
      });
    }

    return resultados;
  }

  /**
   * Sincronização DF-e + auto-processamento pós-sync (fluxo unificado com Upload).
   *
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async executarSincronizacao(opcoes = {}) {
    const resultado = await this._syncExecucao.executar({
      origem: opcoes.origem || ORIGENS.MANUAL,
      ignorarHorario: opcoes.ignorarHorario ?? true,
      forcar: opcoes.forcar,
      maxIteracoes: opcoes.maxIteracoes,
      usuarioId: opcoes.usuarioId
    });

    if (resultado.sucesso) {
      const filaEsgotada = resultado.ultNsu
        && resultado.maxNsu
        && resultado.ultNsu === resultado.maxNsu;
      const deveAguardar = resultado.codigo === 'AGUARDAR_JANELA_DFE'
        || ['137', '656'].includes(String(resultado.cStat || ''))
        || filaEsgotada;
      const bloqueadoConsultaAte = resultado.proximaConsultaEm
        || (deveAguardar
          ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
          : null);

      resultado.cicloDfe = await this._manifestacaoDfeService.processarCandidatos({
        usuarioId: opcoes.usuarioId,
        bloqueadoConsultaAte,
        limite: opcoes.limiteManifestacao,
        apenasManifestacao: true
      });
    }

    if (resultado.sucesso && !resultado.ignorado) {
      const processamentos = await this.processarDocumentosPendentes({
        usuarioId: opcoes.usuarioId,
        limite: opcoes.limiteProcessamento
      });
      resultado.processamentosAutomaticos = processamentos;
      resultado.documentosProcessados = processamentos.filter((p) => p.sucesso).length;
    }

    return resultado;
  }

  async sincronizar(opcoes = {}) {
    return this.executarSincronizacao({
      origem: opcoes.origem || ORIGENS.MANUAL,
      ignorarHorario: true,
      usuarioId: opcoes.usuarioId
    });
  }

  async sincronizarAoAbrir() {
    const cfg = await this._configuracaoService.obterResumoSync();
    if (!cfg.syncAoAbrir) return null;
    return this.executarSincronizacao({ origem: ORIGENS.ABRIR_CENTRAL });
  }

  async uploadDocumentos(arquivos = [], opcoes = {}) {
    return this._uploadService.processarUpload(arquivos, opcoes);
  }

  async buscarPorChave(chave) {
    const resultado = await this._sincronizacaoService.buscarPorChave(chave);

    if (resultado.novo && resultado.documento?.id) {
      const processamentos = await this.processarDocumentosPendentes({ limite: 5 });
      resultado.processamentosAutomaticos = processamentos;
    }

    return resultado;
  }

  async obterXmlDocumento(id) {
    const documento = await this._documentosRepository.buscarPorId(id);
    if (!documento || !documento.xml) return null;

    return {
      id: documento.id,
      chave: documento.chave,
      xml: documento.xml,
      status: documento.status,
      tipoDocumento: documento.tipoDocumento,
      xmlCompleto: ['PROC_NFE', 'NFE'].includes(documento.tipoDocumento),
      downloadLabel: ['PROC_NFE', 'NFE'].includes(documento.tipoDocumento)
        ? 'Baixar XML Completo'
        : (documento.tipoDocumento === 'RES_NFE'
          || documento.status === DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
          ? 'Baixar Resumo'
          : 'Baixar XML')
    };
  }

  async obterParseDocumento(id) {
    const documento = await this._documentosRepository.buscarPorId(id);
    if (!documento) return null;

    return {
      id: documento.id,
      chave: documento.chave,
      parseDisponivel: Boolean(documento.parseJson),
      parse: documento.parseJson || null,
      miipResumo: documento.miipResumoJson || null,
      processadoEm: documento.processadoEm || null
    };
  }

  async processarDocumento(id, opcoes = {}) {
    return this._processamentoService.processar(id, opcoes);
  }

  async processarCicloDfeDocumento(id, opcoes = {}) {
    // RC7.4.2 — Gate operacional único (Solicitar XML / ciclo DF-e).
    if (opcoes.ignorarBloqueio656 !== true) {
      try {
        const gate = require('./services/CentralSefazOperationalGate');
        const auth = await gate.autorizarConsultaDistDfe({
          correlationId: opcoes.correlationId,
          documentoId: id,
          forcar: opcoes.forcarConsulta === true,
          forcarAdminConfirmado: opcoes.forcarAdminConfirmado === true,
          confirmacaoAdmin: opcoes.confirmacaoAdmin === true,
          motivo: 'Aguardando liberação da SEFAZ'
        });
        if (!auth.permitido) {
          return {
            documentoId: Number(id),
            ...auth,
            xmlCompleto: false,
            aguardandoDisponibilizacao: true,
            gateProcessado: true
          };
        }
      } catch { /* ignore */ }
    }

    const resultado = await this._manifestacaoDfeService.processarDocumento(id, {
      ...opcoes,
      confirmado: opcoes.confirmado === true
    });

    if (resultado?.cStat) {
      try {
        await require('./services/CentralSefazOperationalGate').processarRespostaSefaz(resultado, {
          correlationId: opcoes.correlationId || resultado?.detalhe?.correlationId,
          documentoId: id,
          chave: resultado?.documento?.chave,
          nsu: resultado?.ultNsu
        });
        resultado.gateProcessado = true;
      } catch { /* ignore */ }
    }

    if (resultado.xmlCompleto) {
      resultado.processamentosAutomaticos = await this.processarDocumentosPendentes({
        usuarioId: opcoes.usuarioId,
        limite: 5
      });
    }
    return resultado;
  }

  async concluirRevisao(id, dados = {}) {
    return this._comprasBridgeService.concluirRevisao(id, dados);
  }

  /**
   * Fluxo único: revisão (se houver) → PRONTA_IMPORTACAO → EM_IMPORTACAO + payload Compras.
   * Não grava a compra — apenas encaminha para a tela de Compras.
   */
  async finalizarEntrada(id, dados = {}) {
    return this._comprasBridgeService.finalizarEntrada(id, dados);
  }

  obterOuCriarSessaoRevisao(id, opcoes = {}) {
    return this._revisaoPersistenteService.obterOuCriarSessao(id, opcoes);
  }

  obterSessaoRevisao(id) {
    return this._revisaoPersistenteService.obterSessao(id);
  }

  salvarDecisaoRevisao(id, itemIndex, dados = {}) {
    return this._revisaoPersistenteService.salvarDecisao(id, itemIndex, dados);
  }

  reiniciarSessaoRevisao(id, opcoes = {}) {
    return this._revisaoPersistenteService.obterOuCriarSessao(id, {
      ...opcoes,
      forcarNova: true
    });
  }

  async obterPayloadCompra(id) {
    return this._comprasBridgeService.montarPayloadAbrirCompra(id);
  }

  async abrirCompra(id, opcoes = {}) {
    return this._comprasBridgeService.registrarAberturaCompra(id, opcoes);
  }

  async vincularCompra(documentoId, compraId, opcoes = {}) {
    return this._comprasBridgeService.vincularCompra(documentoId, compraId, opcoes);
  }

  async listarAlertas() {
    return this._alertasService.listarAlertas();
  }

  async obterPendencias(opcoes = {}) {
    const alertasResultado = opcoes.alertasResultado
      ?? await this._alertasService.listarAlertas();
    return this._pendenciasService.obterPendencias({
      ...opcoes,
      alertasResultado
    });
  }

  async obterOperacional(opcoes = {}) {
    const alertasResultado = await this._alertasService.listarAlertas();
    return this._operacionalService.obterIndicadores({ alertasResultado, ...opcoes });
  }

  async obterItensAtencao(opcoes = {}) {
    const alertasResultado = opcoes.alertasResultado
      ?? await this._alertasService.listarAlertas();
    const pendenciasResultado = opcoes.pendenciasResultado
      ?? await this._pendenciasService.obterPendencias({
        limite: opcoes.limitePendencias ?? 5,
        alertasResultado
      });
    return this._atencaoService.obterItensAtencao({
      alertasResultado,
      pendenciasResultado
    });
  }

  /**
   * Painel de inteligência com um único cálculo de alertas (RC3).
   * Evita recalcular as mesmas consultas em /operacional + /alertas + /pendencias + /atencao.
   *
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async obterInteligenciaOperacional(opcoes = {}) {
    const alertas = await this._alertasService.listarAlertas();
    const pendencias = await this._pendenciasService.obterPendencias({
      limite: opcoes.limitePendencias ?? 20,
      alertasResultado: alertas
    });
    const [operacional, atencao] = await Promise.all([
      this._operacionalService.obterIndicadores({
        alertasResultado: alertas,
        ano: opcoes.ano,
        mes: opcoes.mes,
        competencia: opcoes.competencia,
        dataEmissaoInicio: opcoes.dataEmissaoInicio || opcoes.data_emissao_inicio || null,
        dataEmissaoFim: opcoes.dataEmissaoFim || opcoes.data_emissao_fim || null
      }),
      this._atencaoService.obterItensAtencao({
        alertasResultado: alertas,
        pendenciasResultado: pendencias
      })
    ]);

    return {
      alertas,
      operacional,
      pendencias,
      atencao,
      indicadoresFiscais: {
        valorMensal: operacional.valorMensal,
        valorAnual: operacional.valorAnual,
        quantidadeMensal: operacional.quantidadeMensal,
        quantidadeAnual: operacional.quantidadeAnual,
        competencia: operacional.competencia,
        competenciaLabel: operacional.competenciaLabel,
        ambiente: operacional.ambiente,
        ambienteLabel: operacional.ambienteLabel
      },
      geradoEm: new Date().toISOString()
    };
  }

  async obterScoreDocumento(id) {
    const documento = await this._documentosRepository.buscarPorId(id);
    if (!documento) return null;

    const score = this._scoreDocumentoService.calcular(documento);
    return {
      documentoId: documento.id,
      chave: documento.chave,
      parseDisponivel: Boolean(documento.parseJson),
      miipDisponivel: Boolean(documento.miipResumoJson || documento.miipSessaoId),
      scoreGeral: score.scoreGeral,
      scoreCor: score.cor,
      fatores: score.fatores,
      detalhes: score.detalhes,
      resumo: documento.miipResumoJson?.resumo || null,
      processadoEm: documento.processadoEm || null
    };
  }

  async obterEstatisticasFornecedor(cnpj, opcoes = {}) {
    return this._scoreFornecedorService.obterEstatisticas(cnpj, opcoes);
  }

  async obterConfiguracoes() {
    return this._configuracaoService.obterResumoSync();
  }

  async obterConfiguracaoEnterprise() {
    return this._configuracaoService.obterPainelCompleto();
  }

  async atualizarConfiguracoes(alteracoes) {
    const { emitirEvento, TIPOS_EVENTO } = require('./utils/centralEventosEmitter');
    const resultado = await this._configuracaoService.atualizar(alteracoes);
    await emitirEvento({
      tipo: TIPOS_EVENTO.CONFIG_ALTERADA,
      origem: 'api',
      descricao: 'Configurações da Central atualizadas',
      resultado: 'sucesso',
      sucesso: true,
      detalhe: alteracoes
    });
    await this._obterSyncBackground().reiniciar();
    // Compat sprint8: endpoints /config esperam resumo de sync
    if (resultado && resultado.sincronizacao) {
      return {
        ...resultado.sincronizacao,
        reprocessamentoAutomatico: resultado.sincronizacao.reprocessamentoAutomatico
      };
    }
    return this._configuracaoService.obterResumoSync();
  }

  async restaurarConfiguracaoPadrao(opcoes = {}) {
    const painel = await this._configuracaoService.restaurarPadrao(opcoes);
    await this._obterSyncBackground().reiniciar();
    return painel;
  }

  async listarEventos(filtros = {}) {
    return this._eventosService.listarLog(filtros);
  }

  obterStatusServico() {
    return this._obterSyncBackground().obterStatus();
  }

  definirProximaExecucaoSync(data) {
    this._syncExecucao.definirProximaExecucao(data);
  }

  obterEstadoSyncExecucao() {
    return this._syncExecucao.obterEstado();
  }

  async listarNotificacoes(filtros = {}) {
    const [notificacoes, naoLidas] = await Promise.all([
      this._notificacoesService.listar(filtros),
      this._notificacoesService.contarNaoLidas()
    ]);
    return { notificacoes, naoLidas };
  }

  async marcarNotificacaoLida(id) {
    return this._notificacoesService.marcarLida(id);
  }

  async marcarTodasNotificacoesLidas() {
    return this._notificacoesService.marcarTodasLidas();
  }

  /**
   * Alteração manual de status — apenas administradores, com auditoria.
   *
   * @param {number|string} id
   * @param {string} novoStatus
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async alterarStatusManual(id, novoStatus, opcoes = {}) {
    const perfil = String(opcoes.perfilUsuario || '').toUpperCase();
    const role = opcoes.roleUsuario;
    const isAdmin = role === 'admin' || perfil === 'ADMIN' || perfil === 'SUPER_ADMIN';

    if (!isAdmin) {
      const erro = new Error('Apenas administradores podem alterar status manualmente.');
      erro.statusCode = 403;
      throw erro;
    }

    if (!isValido(novoStatus)) {
      const erro = new Error(`Status inválido: ${novoStatus}`);
      erro.statusCode = 400;
      throw erro;
    }

    const documento = await this._documentosRepository.buscarPorId(id);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    await this._transitionService.transicionar(id, documento.status, novoStatus, {
      detalhe: opcoes.detalhe ?? `Alteração manual: ${documento.status} → ${novoStatus}`,
      usuarioId: opcoes.usuarioId ?? null,
      origem: 'manual_admin'
    });

    await gravarAuditoria({
      usuario_id: opcoes.usuarioId ?? null,
      usuario_nome: opcoes.usuarioNome ?? null,
      modulo: 'central-entradas',
      acao: 'alterar_status_manual',
      referencia_tipo: 'documento_fiscal',
      referencia_id: id,
      detalhes: {
        statusAnterior: documento.status,
        statusNovo: novoStatus,
        detalhe: opcoes.detalhe ?? null
      },
      ip_requisicao: opcoes.ipRequisicao ?? null
    });

    return this._documentoService.obterPorId(id);
  }

  obterDiagnostico(opcoes = {}) {
    return this._diagnosticoService.obterPainelCompleto(opcoes);
  }

  executarHealthCheckDiagnostico() {
    return this._diagnosticoService.executarHealthCheck();
  }

  testarCertificadoDiagnostico() {
    return this._diagnosticoService.testarCertificado();
  }

  testarSefazDiagnostico() {
    return this._diagnosticoService.testarConexaoSefaz();
  }

  limparCacheDiagnostico() {
    return this._diagnosticoService.limparCache();
  }

  /** RC3.4 — Homologação assistida (somente leitura / observabilidade). */
  obterPainelHomologacao(opcoes = {}) {
    return this._homologacaoService.obterPainel(opcoes);
  }

  inspecionarDocumentoHomologacao(documentoId) {
    return this._homologacaoService.inspecionarDocumento(documentoId);
  }

  obterMetricasHomologacao() {
    return this._homologacaoService.obterMetricas();
  }

  exportarRelatorioHomologacao(documentoId, formato = 'json') {
    return this._homologacaoService.exportarRelatorio(documentoId, formato);
  }
}

const instanciaPadrao = new CentralEntradasOrchestrator();

module.exports = instanciaPadrao;
module.exports.CentralEntradasOrchestrator = CentralEntradasOrchestrator;
module.exports.VERSAO_MODULO = VERSAO_MODULO;
