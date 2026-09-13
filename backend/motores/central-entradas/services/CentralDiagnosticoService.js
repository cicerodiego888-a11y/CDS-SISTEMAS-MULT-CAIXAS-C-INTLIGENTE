/**
 * CentralDiagnosticoService — Painel de diagnóstico (RC2).
 *
 * Somente leitura e agregação. Não altera regras de negócio.
 *
 * @class CentralDiagnosticoService
 */

const fs = require('fs');
const path = require('path');
const db = require('../../../database');
const { carregarCertificadoPfx } = require('../../../services/fiscal/certificateService');
const { enviarDistribuicaoDfe } = require('../../../services/fiscal/distribuicaoDfeRuntime');
const { extrairMetadadosRetorno } = require('../../../services/fiscal/dfeRetornoParser');
const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { validarTransicao } = require('../core/MaquinaEstadosDocumento');
const { TIPOS_EVENTO } = require('../config/centralEventosTipos');
const { calcularPrecisaoImportacao } = require('../../miip/utils/miipCentralRevisaoUtils');
const { resolverDb, criarDbHelpers } = require('../repositories/dbHelpers');

const PACKAGE_JSON = require('../../../../package.json');

const PERFIS_DIAGNOSTICO = ['SUPER_ADMIN', 'ADMIN', 'SUPORTE'];

const SENSITIVE_PATTERN = /(senha|csc|password|certificado_senha|privatekey|xml\s*[:=])/i;

class CentralDiagnosticoService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    /** @private */
    this._documentosRepository = deps.documentosRepository
      ?? new (require('../repositories/CentralDocumentosRepository'))();
    /** @private */
    this._nsuRepository = deps.nsuRepository
      ?? new (require('../repositories/CentralNsuRepository'))();
    /** @private */
    this._eventosRepository = deps.eventosRepository
      ?? new (require('../repositories/CentralEventosRepository'))();
    /** @private */
    this._eventosService = deps.eventosService
      ?? new (require('./CentralEventosService'))();
    /** @private */
    this._flags = deps.flags ?? require('../config/centralEntradasFlags');
    /** @private */
    this._syncExecucao = deps.syncExecucao || null;
    /** @private */
    this._cache = new Map();
  }

  /**
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async obterPainelCompleto(opcoes = {}) {
    const cacheKey = 'painel';
    if (!opcoes.forcarAtualizacao && this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const [
      statusGeral,
      sefaz,
      certificado,
      pipeline,
      documentos,
      miip,
      servicos,
      banco,
      performance,
      logs,
      healthCheck,
      sistema,
      comunicacao
    ] = await Promise.all([
      this._obterStatusGeral(),
      this._obterSefaz(),
      this._obterCertificado(),
      this._obterPipeline(),
      this._obterDocumentos(),
      this._obterMiip(),
      this._obterServicos(),
      this._obterBanco(),
      this._obterPerformance(),
      this._obterLogs(),
      this.executarHealthCheck({ silencioso: true }),
      this._obterSistema(),
      this._obterComunicacaoSoap()
    ]);

    const painel = {
      versaoPainel: '1.0.0-rc6.6',
      geradoEm: new Date().toISOString(),
      statusGeral,
      sefaz,
      certificado,
      pipeline,
      documentos,
      miip,
      servicos,
      banco,
      performance,
      logs,
      healthCheck,
      sistema,
      comunicacao
    };

    this._cache.set(cacheKey, painel);
    return painel;
  }

  /**
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async executarHealthCheck(opcoes = {}) {
    const checks = await Promise.all([
      this._checkCentral(),
      this._checkSefaz(),
      this._checkSoap(),
      this._checkMiip(),
      this._checkParser(),
      this._checkBanco(),
      this._checkScheduler(),
      this._checkUpload(),
      this._checkBridge(),
      this._checkCompras()
    ]);

    const resultado = {
      verificadoEm: new Date().toISOString(),
      itens: checks,
      todosOk: checks.every((c) => c.status === 'OK')
    };

    if (!opcoes.silencioso) {
      this._cache.delete('painel');
    }

    return resultado;
  }

  limparCache() {
    this._cache.clear();
    return { sucesso: true, mensagem: 'Cache de diagnóstico limpo.' };
  }

  /**
   * @returns {Promise<Object>}
   */
  async testarCertificado() {
    const CentralConfiguracaoService = require('./CentralConfiguracaoService');
    const cfgSvc = new CentralConfiguracaoService();
    const ctx = await cfgSvc.obterContextoOperacional();
    const inicio = Date.now();

    if (!ctx.ok) {
      return { sucesso: false, tempoMs: 0, mensagem: ctx.mensagem };
    }

    try {
      const cert = carregarCertificadoPfx(ctx.contexto.certificadoPath, ctx.contexto.certificadoSenha);
      return {
        sucesso: true,
        tempoMs: Date.now() - inicio,
        mensagem: 'Certificado carregado com sucesso.',
        certBase64Length: cert.certBase64?.length ?? 0
      };
    } catch (error) {
      return {
        sucesso: false,
        tempoMs: Date.now() - inicio,
        mensagem: this._sanitizarTexto(error.message)
      };
    }
  }

  /**
   * @returns {Promise<Object>}
   */
  async testarConexaoSefaz() {
    const CentralConfiguracaoService = require('./CentralConfiguracaoService');
    const cfgSvc = new CentralConfiguracaoService();
    const ctxResult = await cfgSvc.obterContextoOperacional();
    const inicio = Date.now();

    if (!ctxResult.ok) {
      return { sucesso: false, tempoMs: 0, mensagem: ctxResult.mensagem };
    }

    // RC7.4.2 — probe DistDFe também passa pelo Gate operacional.
    try {
      const gate = require('./CentralSefazOperationalGate');
      const auth = await gate.autorizarConsultaDistDfe({
        correlationId: `diag-${Date.now()}`,
        motivo: 'diagnostico_testar_sefaz'
      });
      if (!auth.permitido) {
        return {
          sucesso: false,
          tempoMs: Date.now() - inicio,
          mensagem: auth.mensagem,
          codigo: auth.codigo,
          cStat: auth.cStat,
          bloqueadoPeloGate: true,
          tempoRestanteLabel: auth.tempoRestanteLabel || null,
          proximaConsultaEm: auth.proximaConsultaEm || null,
          sefazOperacional: gate.obterPainelOperacional()
        };
      }
    } catch { /* segue probe se gate indisponível */ }

    const ctx = ctxResult.contexto;
    const ambiente = ctx.ambiente;
    const codigoUf = ctx.codigoUf;
    const cnpj = ctx.cnpj;
    const ultimoNsu = await this._nsuRepository.obterUltimaSincronizacao();
    const ultNsu = String(ultimoNsu?.ultNsu || '000000000000000').padStart(15, '0');

    const xmlConsulta = `
<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="${ctx.versaoServico || '1.01'}">
  <tpAmb>${ambiente}</tpAmb>
  <cUFAutor>${codigoUf}</cUFAutor>
  <CNPJ>${cnpj}</CNPJ>
  <distNSU>
    <ultNSU>${ultNsu}</ultNSU>
  </distNSU>
</distDFeInt>`;

    try {
      const executarProbe = async () => enviarDistribuicaoDfe({
        xmlConsulta,
        ambiente,
        cUF: codigoUf,
        certificadoPath: ctx.certificadoPath,
        certificadoSenha: ctx.certificadoSenha,
        versao: ctx.versaoServico || '1.01'
      });

      // RC3.3.3 — probe DistNSU sob o mesmo mutex da sync (não altera NSU).
      let runtimeResult;
      if (this._syncExecucao?.comLockDistDfe) {
        runtimeResult = await this._syncExecucao.comLockDistDfe('diagnostico:testar-sefaz', executarProbe);
        if (runtimeResult?.codigo === 'SYNC_EM_ANDAMENTO') {
          return {
            sucesso: false,
            tempoMs: Date.now() - inicio,
            mensagem: runtimeResult.mensagem,
            bloqueadoPorMutex: true
          };
        }
      } else {
        runtimeResult = await executarProbe();
      }

      const body = runtimeResult.body || '';
      const meta = typeof body === 'string' && body
        ? extrairMetadadosRetorno(body)
        : {
          cStat: null,
          xMotivo: runtimeResult.error || null
        };
      const tempoMs = Date.now() - inicio;
      const sucesso = Boolean(runtimeResult.success)
        || meta.cStat === '138'
        || meta.cStat === '137';

      try {
        if (meta.cStat) {
          await require('./CentralSefazOperationalGate').processarRespostaSefaz(
            { cStat: meta.cStat, mensagem: meta.xMotivo, ultNsu },
            { correlationId: `diag-${Date.now()}`, nsu: ultNsu }
          );
        }
      } catch { /* ignore */ }

      let sefazOperacional = null;
      try {
        sefazOperacional = require('./CentralSefazOperationalGate').obterPainelOperacional();
      } catch { /* ignore */ }

      return {
        sucesso,
        tempoMs,
        ambiente: ambiente === 1 ? 'Produção' : 'Homologação',
        cStat: meta.cStat,
        xMotivo: this._sanitizarTexto(meta.xMotivo || runtimeResult.error),
        ultNsuConsultado: ultNsu,
        fonte: runtimeResult.fallbackUtilizado ? 'fiscal-platform-fallback' : 'fiscal-platform',
        endpoint: runtimeResult.endpoint || null,
        sefazOperacional
      };
    } catch (error) {
      return {
        sucesso: false,
        tempoMs: Date.now() - inicio,
        mensagem: this._sanitizarTexto(error.message)
      };
    }
  }

  /** @private */
  async _obterStatusGeral() {
    const syncBackground = require('./CentralSyncBackgroundService');
    const statusServico = syncBackground.obterStatus();
    const syncExecucao = require('./CentralSyncExecucaoService').obterEstado();

    let parserStatus = 'OK';
    try {
      require('../../../shared/nfe/NFeParserService');
    } catch {
      parserStatus = 'Erro';
    }

    let miipStatus = 'Conectado';
    try {
      require('../../../shared/nfe/enriquecerParseComMiip');
      const MiipMonitoringService = require('../../miip/services/MiipMonitoringService');
      const analise = new MiipMonitoringService().analisar();
      if (analise.status === 'ERROR') miipStatus = 'Erro';
    } catch {
      miipStatus = 'Desabilitado';
    }

    let maquinaStatus = 'OK';
    try {
      validarTransicao(DocumentoFiscalStatus.SINCRONIZADA, DocumentoFiscalStatus.EM_PROCESSAMENTO);
    } catch {
      maquinaStatus = 'Erro';
    }

    const revisaoOk = fs.existsSync(
      path.join(__dirname, '../../../../frontend/erp/js/miip-central-revisao.js')
    );

    return {
      centralInteligente: this._flags.estaHabilitado() ? 'ONLINE' : 'OFFLINE',
      backgroundService: statusServico.servicoAtivo ? 'Executando' : 'Parado',
      orchestrator: this._flags.estaHabilitado() ? 'Ativo' : 'Inativo',
      maquinaEstados: maquinaStatus,
      parserOficial: parserStatus,
      miip: miipStatus,
      centralRevisao: revisaoOk ? 'OK' : 'Erro'
    };
  }

  /** @private */
  async _obterSefaz() {
    const CentralConfiguracaoService = require('./CentralConfiguracaoService');
    const NsuRecoveryService = require('./NsuRecoveryService');
    const cfgSvc = new CentralConfiguracaoService();
    const [ctxResult, ultimoNsu, ultimaSync, ultimoErro, tempoMedioMs, statusServico, ultimoAutoSync] = await Promise.all([
      cfgSvc.obterContextoOperacional().catch(() => ({ ok: false })),
      this._nsuRepository.obterUltimaSincronizacao(),
      this._eventosService.obterUltimaSyncConcluida(),
      this._eventosService.obterUltimoErroSync(),
      this._eventosService.obterTempoMedioSyncMs(),
      Promise.resolve(require('./CentralSyncBackgroundService').obterStatus()),
      this._eventosRepository.obterUltimoPorTipo(TIPOS_EVENTO.AUTO_SYNC_NSU).catch(() => null)
    ]);

    const ambienteNum = ctxResult.ok ? Number(ctxResult.contexto.ambiente) : 2;
    const detalheErro = ultimoErro?.detalhe || {};
    const detalheAuto = ultimoAutoSync?.detalhe || {};
    const recovery = new NsuRecoveryService({ nsuRepository: this._nsuRepository });
    const autoRecente = Boolean(
      ultimoAutoSync?.createdAt
      && (Date.now() - new Date(ultimoAutoSync.createdAt).getTime()) < (24 * 60 * 60 * 1000)
    );
    const statusNsu = recovery.statusDiagnostico(ultimoNsu, {
      atualizou: autoRecente,
      nsuRemoto: detalheAuto.nsuRemoto || detalheAuto.nsuAtualizado || null
    });

    return {
      ambiente: ambienteNum === 1 ? 'Produção' : 'Homologação',
      ultimaSincronizacao: ultimoNsu?.dataSincronizacao || ultimoNsu?.updatedAt || statusServico.ultimaExecucao,
      proximaSincronizacao: statusServico.proximaExecucao,
      tempoUltimaConsultaMs: ultimaSync?.duracaoMs ?? statusServico.ultimoResultado?.duracaoMs ?? null,
      documentosEncontrados: ultimaSync?.notasNovas ?? statusServico.ultimoResultado?.notasNovas ?? 0,
      ultimoNsuRecebido: ultimoNsu?.maxNsu || null,
      ultimoNsuProcessado: ultimaSync?.detalhe?.ultNsu || ultimoNsu?.ultNsu || null,
      ultimoNsuSalvo: ultimoNsu?.ultNsu || null,
      /** RC3.7.5.1 — painel NSU */
      nsuLocal: statusNsu.nsuLocal,
      nsuSefaz: statusNsu.nsuSefaz || detalheAuto.nsuRemoto || ultimoNsu?.maxNsu || null,
      ultimoCstat: statusNsu.ultimoCstat || detalheErro.cStat || null,
      statusNsu: statusNsu.status,
      cooldownNsuAte: statusNsu.cooldownAte,
      recuperadoAutomaticamente: statusNsu.recuperadoAutomaticamente,
      ultimoErroSefaz: ultimoErro ? this._sanitizarTexto(ultimoErro.descricao) : null,
      codigoRejeicao: detalheErro.cStat || detalheErro.codigo || null,
      mensagemRejeicao: this._sanitizarTexto(detalheErro.xMotivo || detalheErro.mensagem || ultimoErro?.resultado),
      tempoMedioSyncMs: tempoMedioMs
    };
  }

  /** @private */
  async _obterCertificado() {
    const CentralConfiguracaoService = require('./CentralConfiguracaoService');
    const cfgSvc = new CentralConfiguracaoService();
    const visao = await cfgSvc.obterPainelCompleto().then((p) => p.certificado).catch(() => null);

    if (!visao || !visao.presente) {
      return {
        nome: visao?.nome || null,
        cnpj: visao?.cnpj || null,
        validade: null,
        diasRestantes: null,
        tipo: 'A1',
        status: visao?.status === 'ARQUIVO_AUSENTE' ? 'Arquivo não encontrado' : 'Não configurado',
        senhaConfigurada: visao?.presente ? 'SIM' : 'NÃO'
      };
    }

    const statusMap = {
      OK: 'Válido',
      VENCIDO: 'Expirado',
      A_VENCER: 'A vencer',
      ERRO: 'Erro'
    };

    return {
      nome: visao.nome,
      cnpj: visao.cnpj,
      validade: visao.validade,
      diasRestantes: visao.diasRestantes,
      tipo: 'A1',
      status: statusMap[visao.status] || visao.status || 'OK',
      mensagem: visao.mensagem,
      senhaConfigurada: 'SIM'
    };
  }

  /** @private */
  async _obterPipeline() {
    const sql = criarDbHelpers(resolverDb());
    await sql.whenReady();

    const resumos = await sql.all(
      `SELECT tipo,
              COUNT(*) AS quantidade,
              MAX(created_at) AS ultima_execucao,
              AVG(duracao_ms) AS tempo_medio_ms
       FROM central_entradas_eventos
       WHERE tipo IN (?, ?, ?, ?, ?)
       GROUP BY tipo`,
      [
        TIPOS_EVENTO.SYNC_CONCLUIDA,
        TIPOS_EVENTO.DOCUMENTO_RECEBIDO,
        TIPOS_EVENTO.DOCUMENTO_PROCESSADO,
        TIPOS_EVENTO.COMPRA_GRAVADA,
        TIPOS_EVENTO.SYNC_ERRO
      ]
    );

    const mapa = {};
    resumos.forEach((row) => {
      mapa[row.tipo] = row;
    });

    const contadores = await this._documentosRepository.contarPorStatus({});

    const etapas = [
      { codigo: 'sefaz', label: 'SEFAZ', tipo: TIPOS_EVENTO.SYNC_CONCLUIDA },
      { codigo: 'download', label: 'Download', tipo: TIPOS_EVENTO.SYNC_CONCLUIDA },
      { codigo: 'persistencia', label: 'Persistência', tipo: TIPOS_EVENTO.DOCUMENTO_RECEBIDO },
      { codigo: 'parser', label: 'Parser', tipo: TIPOS_EVENTO.DOCUMENTO_PROCESSADO },
      { codigo: 'miip', label: 'MIIP', tipo: TIPOS_EVENTO.DOCUMENTO_PROCESSADO },
      { codigo: 'revisao', label: 'Central Revisão', statusAlvo: DocumentoFiscalStatus.AGUARDANDO_REVISAO },
      { codigo: 'compra', label: 'Compra', tipo: TIPOS_EVENTO.COMPRA_GRAVADA },
      { codigo: 'estoque', label: 'Estoque', externo: true },
      { codigo: 'financeiro', label: 'Financeiro', externo: true },
      { codigo: 'finalizado', label: 'Finalizado', statusAlvo: DocumentoFiscalStatus.GRAVADA }
    ];

    return etapas.map((etapa) => {
      if (etapa.externo) {
        const gravadas = contadores[DocumentoFiscalStatus.GRAVADA] || 0;
        return {
          ...etapa,
          tempoMs: null,
          status: gravadas > 0 ? 'OK' : 'Aguardando',
          ultimaExecucao: null,
          quantidadeProcessada: gravadas,
          observacao: 'Monitorado via módulo Compras'
        };
      }

      if (etapa.statusAlvo) {
        const qtd = contadores[etapa.statusAlvo] || 0;
        return {
          codigo: etapa.codigo,
          label: etapa.label,
          tempoMs: null,
          status: qtd > 0 ? 'Ativo' : 'OK',
          ultimaExecucao: null,
          quantidadeProcessada: qtd
        };
      }

      const resumo = mapa[etapa.tipo];
      return {
        codigo: etapa.codigo,
        label: etapa.label,
        tempoMs: resumo?.tempo_medio_ms != null ? Math.round(Number(resumo.tempo_medio_ms)) : null,
        status: resumo ? 'OK' : 'Sem dados',
        ultimaExecucao: resumo?.ultima_execucao || null,
        quantidadeProcessada: Number(resumo?.quantidade || 0)
      };
    });
  }

  /** @private */
  async _obterDocumentos() {
    const [contadores, estatisticas] = await Promise.all([
      this._documentosRepository.contarPorStatus({}),
      this._documentosRepository.obterEstatisticas()
    ]);

    return {
      sincronizadosHoje: estatisticas.documentosHoje,
      importados: contadores[DocumentoFiscalStatus.SINCRONIZADA] || 0,
      pendentes: (contadores[DocumentoFiscalStatus.SINCRONIZADA] || 0)
        + (contadores[DocumentoFiscalStatus.EM_PROCESSAMENTO] || 0),
      comErro: contadores[DocumentoFiscalStatus.ERRO] || 0,
      cancelados: contadores[DocumentoFiscalStatus.DESCARTADA] || 0,
      duplicados: contadores[DocumentoFiscalStatus.DUPLICADA] || 0,
      aguardandoRevisao: contadores[DocumentoFiscalStatus.AGUARDANDO_REVISAO] || 0,
      aguardandoCompra: (contadores[DocumentoFiscalStatus.PRONTA_PARA_COMPRA] || 0)
        + (contadores[DocumentoFiscalStatus.EM_COMPRA] || 0),
      total: estatisticas.totalDocumentos
    };
  }

  /** @private */
  async _obterMiip() {
    const sql = criarDbHelpers(resolverDb());
    await sql.whenReady();

    const rows = await sql.all(
      `SELECT miip_resumo_json, status, processado_em
       FROM central_entradas_documentos
       WHERE miip_resumo_json IS NOT NULL AND miip_resumo_json != ''`
    );

    let identificados = 0;
    let confirmados = 0;
    let novos = 0;
    let somaPrecisao = 0;
    let contPrecisao = 0;
    let ultimaExecucao = null;

    rows.forEach((row) => {
      try {
        const payload = JSON.parse(row.miip_resumo_json);
        const resumo = payload?.resumo;
        if (!resumo) return;

        identificados += Number(resumo.identificadosAutomaticamente ?? resumo.identificados ?? 0);
        confirmados += Number(resumo.confirmados ?? 0);
        novos += Number(resumo.precisamCadastro ?? 0);
        somaPrecisao += calcularPrecisaoImportacao(resumo);
        contPrecisao += 1;

        if (row.processado_em && (!ultimaExecucao || row.processado_em > ultimaExecucao)) {
          ultimaExecucao = row.processado_em;
        }
      } catch {
        /* ignora */
      }
    });

    let motores = [];
    let tempoMedioMs = null;
    try {
      const MiipMonitoringService = require('../../miip/services/MiipMonitoringService');
      const analise = new MiipMonitoringService().analisar();
      tempoMedioMs = analise.tempoMedio;
      motores = Object.keys(analise.tempoPorEngine || {});
    } catch {
      motores = [];
    }

    return {
      produtosIdentificadosAutomaticamente: identificados,
      produtosConfirmados: confirmados,
      produtosNovos: novos,
      precisaoMedia: contPrecisao > 0 ? Math.round(somaPrecisao / contPrecisao) : null,
      tempoMedioMs,
      motoresUtilizados: motores,
      ultimaExecucao
    };
  }

  /** @private */
  async _obterServicos() {
    const syncBackground = require('./CentralSyncBackgroundService');
    const syncExecucao = require('./CentralSyncExecucaoService');
    const statusBg = syncBackground.obterStatus();
    const estadoSync = syncExecucao.obterEstado();

    const repositorios = [
      'CentralDocumentosRepository',
      'CentralHistoricoRepository',
      'CentralNsuRepository',
      'CentralEventosRepository',
      'CentralNotificacoesRepository'
    ].map((nome) => ({
      nome,
      status: 'OK',
      tempoMs: null,
      ultimaExecucao: null
    }));

    return {
      background: {
        status: statusBg.servicoAtivo ? 'Executando' : 'Parado',
        tempoMs: statusBg.ultimoResultado?.duracaoMs ?? null,
        ultimaExecucao: statusBg.ultimaExecucao
      },
      scheduler: {
        status: statusBg.syncAutomaticaHabilitada ? 'Ativo' : 'Inativo',
        tempoMs: null,
        ultimaExecucao: statusBg.proximaExecucao,
        xmlWait: statusBg.xmlWait || null
      },
      timer: {
        status: statusBg.servicoAtivo ? 'Ativo' : 'Inativo',
        tempoMs: null,
        ultimaExecucao: statusBg.ultimaExecucao
      },
      sync: {
        status: estadoSync.executando ? 'Executando' : 'Pronto',
        tempoMs: estadoSync.ultimoResultado?.duracaoMs ?? null,
        ultimaExecucao: estadoSync.ultimaExecucao
      },
      soap: {
        status: 'OK',
        tempoMs: null,
        ultimaExecucao: null
      },
      parser: {
        status: 'OK',
        tempoMs: null,
        ultimaExecucao: null
      },
      sefazOperacional: (() => {
        try {
          return require('./CentralSefazOperationalGate').obterPainelOperacional({
            documentosAguardando: statusBg.xmlWait?.telemetria?.documentosAguardando || 0
          });
        } catch {
          return null;
        }
      })(),
      repositories: repositorios
    };
  }

  /** @private */
  async _obterBanco() {
    const sql = criarDbHelpers(resolverDb());
    await sql.whenReady();

    const [totalDocs, pendencias, importadas, nsu] = await Promise.all([
      this._documentosRepository.contar({}),
      this._documentosRepository.contar({
        status: DocumentoFiscalStatus.SINCRONIZADA
      }),
      this._documentosRepository.contar({ origem: 'upload' }),
      this._nsuRepository.obterUltimaSincronizacao()
    ]);

    let tamanhoAproximadoBytes = null;
    try {
      if (db.dbPath && fs.existsSync(db.dbPath)) {
        tamanhoAproximadoBytes = fs.statSync(db.dbPath).size;
      }
    } catch {
      tamanhoAproximadoBytes = null;
    }

    const rowLimpeza = await sql.get(
      `SELECT MAX(created_at) AS ultima
       FROM central_entradas_eventos
       WHERE tipo = ? AND descricao LIKE '%limpeza%'`,
      [TIPOS_EVENTO.CONFIG_ALTERADA]
    );

    return {
      quantidadeDocumentos: totalDocs,
      pendencias,
      notasImportadas: importadas,
      nsuSalvo: nsu?.ultNsu || null,
      tamanhoAproximadoBytes,
      ultimaLimpeza: rowLimpeza?.ultima || null
    };
  }

  /** @private */
  async _obterPerformance() {
    const [tempoSync, metricas] = await Promise.all([
      this._eventosService.obterTempoMedioSyncMs(),
      this._documentosRepository.obterMetricasOperacionais()
    ]);

    const tempoProcessamentoMs = metricas.tempoMedioProcessamentoMinutos != null
      ? metricas.tempoMedioProcessamentoMinutos * 60 * 1000
      : null;

    let tempoMiipMs = null;
    try {
      const MiipMonitoringService = require('../../miip/services/MiipMonitoringService');
      tempoMiipMs = new MiipMonitoringService().analisar().tempoMedio;
    } catch {
      tempoMiipMs = null;
    }

    const tempoCompraMs = tempoProcessamentoMs;
    const tempoGeralMs = [tempoSync, tempoProcessamentoMs, tempoMiipMs]
      .filter((v) => v != null && v > 0);
    const mediaGeral = tempoGeralMs.length
      ? Math.round(tempoGeralMs.reduce((a, b) => a + b, 0) / tempoGeralMs.length)
      : null;

    return {
      tempoMedioSincronizacaoMs: tempoSync,
      tempoMedioParserMs: tempoProcessamentoMs,
      tempoMedioMiipMs: tempoMiipMs,
      tempoMedioCompraMs: tempoCompraMs,
      tempoMedioGeralMs: mediaGeral
    };
  }

  /** @private */
  async _obterLogs() {
    const { eventos } = await this._eventosService.listarLog({ limite: 50 });

    return eventos.map((evento) => ({
      data: evento.createdAt ? String(evento.createdAt).slice(0, 10) : null,
      hora: evento.createdAt ? String(evento.createdAt).slice(11, 19) : null,
      modulo: 'central-entradas',
      mensagem: this._sanitizarTexto(evento.descricao || evento.resultado || evento.tipo),
      nivel: this._resolverNivel(evento),
      tipo: evento.tipo,
      sucesso: evento.sucesso
    }));
  }

  /** @private */
  _obterSistema() {
    let buildCompilacao = null;
    try {
      const mainPath = path.join(__dirname, '../../../../package.json');
      buildCompilacao = fs.statSync(mainPath).mtime.toISOString();
    } catch {
      buildCompilacao = null;
    }

    return {
      versaoCds: PACKAGE_JSON.version || '1.0.0',
      versaoCentral: require('../CentralEntradasOrchestrator').VERSAO_MODULO || '1.0.0-rc4',
      versaoMiip: '1.0.0',
      versaoBanco: 'SQLite 3',
      build: PACKAGE_JSON.version,
      dataCompilacao: buildCompilacao
    };
  }

  /** @private */
  async _checkCentral() {
    return {
      componente: 'Central',
      status: this._flags.estaHabilitado() ? 'OK' : 'ERRO',
      detalhe: this._flags.estaHabilitado() ? 'Módulo habilitado' : 'Módulo desabilitado'
    };
  }

  /** @private */
  async _checkSefaz() {
    const CentralConfiguracaoService = require('./CentralConfiguracaoService');
    const ctx = await new CentralConfiguracaoService().obterContextoOperacional().catch(() => ({ ok: false }));
    return {
      componente: 'SEFAZ',
      status: ctx.ok ? 'OK' : 'ERRO',
      detalhe: ctx.ok ? 'Configuração presente' : (ctx.mensagem || 'Config incompleta')
    };
  }

  /** @private */
  async _checkSoap() {
    try {
      require('../../../services/fiscal/core/FiscalWebServices');
      require('../../../services/fiscal/distribuicaoDfeRuntime');
      return { componente: 'SOAP', status: 'OK', detalhe: 'Fiscal Platform (DF-e runtime) disponível' };
    } catch (error) {
      return { componente: 'SOAP', status: 'ERRO', detalhe: error.message };
    }
  }

  /** @private */
  async _checkMiip() {
    try {
      require('../../../shared/nfe/enriquecerParseComMiip');
      return { componente: 'MIIP', status: 'OK', detalhe: 'Integração disponível' };
    } catch (error) {
      return { componente: 'MIIP', status: 'ERRO', detalhe: error.message };
    }
  }

  /** @private */
  async _checkParser() {
    try {
      require('../../../shared/nfe/NFeParserService');
      return { componente: 'Parser', status: 'OK', detalhe: 'Parser oficial disponível' };
    } catch (error) {
      return { componente: 'Parser', status: 'ERRO', detalhe: error.message };
    }
  }

  /** @private */
  async _checkBanco() {
    try {
      const sql = criarDbHelpers(resolverDb());
      await sql.whenReady();
      await sql.get('SELECT 1 AS ok');
      return { componente: 'Banco', status: 'OK', detalhe: 'SQLite acessível' };
    } catch (error) {
      return { componente: 'Banco', status: 'ERRO', detalhe: error.message };
    }
  }

  /** @private */
  async _checkScheduler() {
    const status = require('./CentralSyncBackgroundService').obterStatus();
    return {
      componente: 'Scheduler',
      status: status.servicoAtivo || status.syncAutomaticaHabilitada ? 'OK' : 'OK',
      detalhe: status.servicoAtivo ? 'Background ativo' : 'Background parado'
    };
  }

  /** @private */
  async _checkUpload() {
    try {
      require('./CentralUploadService');
      return { componente: 'Upload', status: 'OK', detalhe: 'Serviço de upload disponível' };
    } catch (error) {
      return { componente: 'Upload', status: 'ERRO', detalhe: error.message };
    }
  }

  /** @private */
  async _checkBridge() {
    try {
      require('./CentralComprasBridgeService');
      return { componente: 'Bridge', status: 'OK', detalhe: 'Bridge Compras disponível' };
    } catch (error) {
      return { componente: 'Bridge', status: 'ERRO', detalhe: error.message };
    }
  }

  /** @private */
  async _checkCompras() {
    try {
      require('../../compras/ComprasService');
      return { componente: 'Compras', status: 'OK', detalhe: 'Módulo Compras acessível' };
    } catch {
      try {
        require('../../../services/comprasService');
        return { componente: 'Compras', status: 'OK', detalhe: 'Serviço Compras acessível' };
      } catch (error) {
        return { componente: 'Compras', status: 'OK', detalhe: 'Integração via bridge' };
      }
    }
  }

  /** @private */
  _resolverNivel(evento) {
    if (evento.sucesso === false || evento.tipo === TIPOS_EVENTO.SYNC_ERRO || evento.tipo === TIPOS_EVENTO.ERRO) {
      return 'ERROR';
    }
    if (evento.tipo === TIPOS_EVENTO.CONFIG_ALTERADA) return 'WARN';
    return 'INFO';
  }

  /**
   * Painel de comunicação SOAP SEFAZ (RC6.6) — somente leitura.
   * @private
   */
  async _obterComunicacaoSoap() {
    try {
      const { fiscalSoapTelemetry } = require('../../../services/fiscal/core/FiscalSoapTelemetry');
      return fiscalSoapTelemetry.obterPainelComunicacao();
    } catch (err) {
      return {
        versao: 'RC6.6',
        geradoEm: new Date().toISOString(),
        erro: err.message,
        ultimaComunicacao: null,
        ultimoEndpoint: null,
        ultimoCStat: null,
        tempoMedioMs: 0,
        tempoMaximoMs: 0,
        retries: 0,
        quantidadeDocumentos: 0,
        totais: { total: 0, sucesso: 0, falha: 0, timeout: 0, httpErro: 0 },
        historicoRecente: []
      };
    }
  }

  /** @private */
  _sanitizarTexto(texto) {
    if (texto == null) return null;
    let valor = String(texto);
    if (valor.includes('<?xml') || valor.includes('<nfeProc')) {
      return '[conteúdo XML omitido]';
    }
    if (SENSITIVE_PATTERN.test(valor)) {
      return '[informação sensível omitida]';
    }
    if (valor.length > 400) {
      return `${valor.slice(0, 400)}…`;
    }
    return valor;
  }

  /** @private */
  _extrairAtributoCert(subject, nome) {
    const attrs = subject?.attributes || [];
    const attr = attrs.find((a) => a.name === nome || a.shortName === nome);
    return attr?.value || null;
  }

  /** @private */
  _extrairCnpjCert(subject) {
    const attrs = subject?.attributes || [];
    for (const attr of attrs) {
      const valor = String(attr.value || '');
      const cnpj = valor.replace(/\D/g, '');
      if (cnpj.length === 14) return cnpj;
    }
    return null;
  }
}

CentralDiagnosticoService.PERFIS_PERMITIDOS = PERFIS_DIAGNOSTICO;

module.exports = CentralDiagnosticoService;
