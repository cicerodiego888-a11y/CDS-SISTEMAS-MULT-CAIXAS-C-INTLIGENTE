/**
 * MiipService — Fachada oficial e única porta de entrada do MIIP.
 *
 * Toda operação de identificação de produtos no CDS Sistemas DEVE passar
 * por este serviço. Rotas e outros módulos não devem chamar
 * MiipOrchestrator, engines ou repositories diretamente.
 *
 * Sprint 5 Integração: feature flag `usarMiip` + logs detalhados.
 *
 * @class MiipService
 */

const MiipOrchestratorMod = require('./MiipOrchestrator');
const MiipContext = require('./core/MiipContext');
const MiipAction = require('./core/MiipAction');
const { inicializarMiip } = require('./MiipBootstrap');
const { mapearItemCompraParaIdentificavel } = require('./utils/mapearItemCompra');
const miipFeatureFlags = require('./config/miipFeatureFlags');
const integracaoLogService = require('./logs/MiipIntegracaoLogService');
const MiipConfiguracoesRepositoryMod = require('./repositories/MiipConfiguracoesRepository');
const { MiipDecisoesRepository } = require('./repositories/MiipDecisoesRepository');
const MiipLearningService = require('./services/MiipLearningService');
const MiipImportacaoXmlService = require('./services/MiipImportacaoXmlService');
const fs = require('fs');
const path = require('path');
const MotorRegistry = require('./core/MotorRegistry');
const { obterTelemetryService } = require('./core/MiipPipelineFactory');
const { estaInicializado } = require('./MiipBootstrap');

class MiipService {
  /**
   * @param {Object} [deps]
   * @param {import('./MiipOrchestrator')} [deps.orchestrator]
   * @param {Object|null} [deps.db]
   * @param {Function} [deps.inicializar]
   * @param {import('./config/miipFeatureFlags')} [deps.featureFlags]
   * @param {import('./logs/MiipIntegracaoLogService')} [deps.integracaoLog]
   * @param {import('./repositories/MiipConfiguracoesRepository')} [deps.configuracoesRepository]
   * @param {import('./services/MiipLearningService')} [deps.learningService]
   * @param {import('./services/MiipImportacaoXmlService')} [deps.importacaoXmlService]
   */
  constructor(deps = {}) {
    /** @private */
    this._db = deps.db ?? null;
    /** @private */
    this._orchestrator = deps.orchestrator ?? new MiipOrchestratorMod.MiipOrchestrator({
      db: deps.db ?? null,
      configuracoesRepository: deps.configuracoesRepository
        ?? new MiipConfiguracoesRepositoryMod.MiipConfiguracoesRepository({ db: deps.db ?? null })
    });
    /** @private */
    this._inicializar = deps.inicializar ?? inicializarMiip;
    /** @private */
    this._featureFlags = deps.featureFlags ?? miipFeatureFlags;
    /** @private */
    this._integracaoLog = deps.integracaoLog ?? integracaoLogService;
    /** @private */
    this._configuracoesRepository = deps.configuracoesRepository
      ?? new MiipConfiguracoesRepositoryMod.MiipConfiguracoesRepository({ db: deps.db ?? null });
    /** @private */
    this._decisoesRepository = deps.decisoesRepository
      ?? new MiipDecisoesRepository({ db: deps.db ?? null });
    /** @private */
    this._learningService = deps.learningService
      ?? new MiipLearningService({ db: deps.db ?? null });
    /** @private */
    this._importacaoXmlService = deps.importacaoXmlService ?? new MiipImportacaoXmlService({
      integracaoLog: deps.integracaoLog ?? integracaoLogService,
      db: deps.db ?? null
    });
    this._importacaoXmlService.definirMiipService(this);
    /** @private @type {*} */
    this.db = deps.db ?? null;
    /** @private */
    this._flagSincronizada = false;
  }

  /**
   * Indica se a integração MIIP está habilitada (`usarMiip`).
   *
   * @returns {boolean}
   */
  estaHabilitado() {
    return this._featureFlags.estaHabilitado();
  }

  /**
   * Indica se a importação XML deve usar MIIP (Sprint 6A).
   *
   * @returns {boolean}
   */
  estaImportacaoXmlHabilitada() {
    return this._featureFlags.estaImportacaoXmlHabilitada();
  }

  /**
   * @returns {{ usarMiip: boolean, sincronizadoBanco: boolean }}
   */
  obterFeatureFlags() {
    return this._featureFlags.obterEstado();
  }

  /**
   * Garante bootstrap dos motores e sincroniza feature flag do banco (uma vez).
   *
   * @private
   */
  async _garantirInicializado() {
    this._inicializar({ db: this._db });

    if (!this._flagSincronizada) {
      await this._featureFlags.sincronizarDoBanco(this._configuracoesRepository);
      this._flagSincronizada = true;
    }
  }

  /**
   * Extrai produtoId do resultado consolidado.
   *
   * @param {import('./core/MiipResult')} resultado
   * @returns {number|null}
   */
  extrairProdutoId(resultado) {
    const melhor = resultado?.candidatos?.[0];
    const produtoId = Number(melhor?.produtoId ?? melhor?.produto_id);
    return Number.isFinite(produtoId) && produtoId > 0 ? produtoId : null;
  }

  /**
   * Registra evento detalhado do fluxo de integração ERP.
   *
   * @param {Object} dados
   * @returns {Object}
   */
  registrarIntegracao(dados) {
    return this._integracaoLog.registrar({
      usarMiip: this.estaHabilitado(),
      ...dados
    });
  }

  /**
   * Identifica o produto correspondente a um item externo.
   *
   * @param {import('./contracts/ItemIdentificavelDTO')|Object} item
   * @param {import('./core/MiipContext')|Object} [contexto]
   * @returns {Promise<{ encontrado: boolean, produtoId: number|null, resultado: import('./core/MiipResult'), desabilitado?: boolean }>}
   */
  async identificar(item, contexto) {
    await this._garantirInicializado();

    const contextoNormalizado = contexto instanceof MiipContext
      ? contexto
      : MiipContext.agora({ origem: 'compra', ...(contexto || {}) });

    if (!this.estaHabilitado()) {
      this.registrarIntegracao({
        evento: 'legado_feature_flag',
        origem: contextoNormalizado.origem,
        ponto: contexto?.ponto ?? 'ensureProductForItem',
        item,
        motivo: 'usarMiip=false'
      });

      return {
        encontrado: false,
        produtoId: null,
        resultado: null,
        desabilitado: true
      };
    }

    const inicio = Date.now();
    const itemNormalizado = mapearItemCompraParaIdentificavel(item);

    this.registrarIntegracao({
      evento: 'miip_inicio',
      origem: contextoNormalizado.origem,
      ponto: contexto?.ponto ?? 'ensureProductForItem',
      item: itemNormalizado
    });

    let resultado;
    let erro = null;

    try {
      resultado = await this._orchestrator.executar(itemNormalizado, contextoNormalizado);
    } catch (error) {
      erro = error?.message || 'Erro desconhecido no MIIP';
      this.registrarIntegracao({
        evento: 'miip_erro',
        origem: contextoNormalizado.origem,
        ponto: contexto?.ponto ?? 'ensureProductForItem',
        item: itemNormalizado,
        erro,
        duracaoMs: Date.now() - inicio
      });
      throw error;
    }

    const produtoId = this.extrairProdutoId(resultado);
    const duracaoMs = Date.now() - inicio;

    // RC9.3 — auto-aprendizado em AUTO_VINCULAR (GTIN ou associação)
    let aprendizado = null;
    try {
      aprendizado = await this._aprenderAutoVinculo(itemNormalizado, resultado, contextoNormalizado);
    } catch (learnErr) {
      this.registrarIntegracao({
        evento: 'miip_aprendizado_auto_erro',
        origem: contextoNormalizado.origem,
        item: itemNormalizado,
        erro: learnErr?.message,
        duracaoMs: Date.now() - inicio
      });
    }

    if (produtoId) {
      this.registrarIntegracao({
        evento: 'miip_sucesso',
        origem: contextoNormalizado.origem,
        ponto: contexto?.ponto ?? 'ensureProductForItem',
        item: itemNormalizado,
        produtoId,
        resultado,
        aprendizado,
        duracaoMs
      });
    } else {
      this.registrarIntegracao({
        evento: 'miip_sem_match',
        origem: contextoNormalizado.origem,
        ponto: contexto?.ponto ?? 'ensureProductForItem',
        item: itemNormalizado,
        resultado,
        motivo: 'nenhum candidato confiável',
        mubc: resultado?.decisao?.mubcDiagnostico
          ?? resultado?.candidatos?._meta?.mubcDiagnostico
          ?? null,
        topCandidatos: (resultado?.candidatos || []).slice(0, 10).map((c) => ({
          produtoId: c.produtoId,
          score: c.scoreTotal,
          motores: c.motoresQueVotaram
        })),
        duracaoMs
      });
    }

    // MIB-RC4.0 — consulta Knowledge Graph quando sem match (não bloqueia decisão)
    let knowledge = null;
    if (produtoId == null) {
      try {
        const { consultarGrafoMiip } = require('../mib/knowledge/MiipKnowledgeBridge');
        const db = this.db || require('../../database');
        knowledge = await consultarGrafoMiip(db, {
          nome: itemNormalizado?.descricao || itemNormalizado?.nome || item?.descricao || item?.nome,
          gtin: itemNormalizado?.gtin || itemNormalizado?.codigoBarras || item?.gtin || item?.codigo_barras,
          ncm: itemNormalizado?.ncm || item?.ncm,
          preco: itemNormalizado?.preco || item?.preco
        }, { origem: 'miip' });
      } catch (_) {
        knowledge = null;
      }
    }

    return {
      encontrado: produtoId != null,
      produtoId,
      resultado,
      aprendizado,
      knowledge
    };
  }

  /**
   * RC9.3 — Grava miip_associacoes quando AUTO_VINCULAR (inclui match por GTIN).
   * Não altera MotorGTIN / MotorAssociacao — hook pós-decisão.
   *
   * @private
   */
  async _aprenderAutoVinculo(item, resultado, contexto) {
    const acao = resultado?.decisao?.acao;
    if (acao !== MiipAction.AUTO_VINCULAR) {
      return { gravado: false, motivo: 'acao_nao_auto' };
    }

    const produtoId = this.extrairProdutoId(resultado)
      ?? Number(resultado?.decisao?.melhorCandidato?.produtoId);
    const fornecedorCnpj = item?.fornecedorCnpj ?? item?.fornecedor_cnpj;
    const codigoFornecedor = item?.codigoFornecedor ?? item?.codigo_fornecedor;

    if (!produtoId || !fornecedorCnpj || !codigoFornecedor) {
      return {
        gravado: false,
        motivo: 'dados_insuficientes_para_associacao',
        produtoId: produtoId || null,
        fornecedorCnpj: fornecedorCnpj || null,
        codigoFornecedor: codigoFornecedor || null
      };
    }

    const motor = (resultado?.decisao?.melhorCandidato?.motoresQueVotaram || [])[0]
      || resultado?.decisao?.motor
      || 'auto_vinculo';

    const learn = await this._learningService.registrarConfirmacao({
      confirmado: true,
      produtoId,
      fornecedorCnpj,
      codigoFornecedor,
      codigoBarras: item?.codigoBarras ?? item?.codigo_barras ?? null,
      ncm: item?.ncm ?? null,
      unidade: item?.unidade ?? null,
      fornecedorNome: item?.fornecedorNome ?? item?.fornecedor_nome ?? null,
      descricaoFornecedor: item?.produtoNome ?? item?.produto_nome ?? null,
      origem: `auto_${motor}`,
      operacaoId: resultado?.requestId ?? contexto?.operacaoId ?? null,
      usuarioId: contexto?.usuarioId ?? null
    });

    this.registrarIntegracao({
      evento: 'miip_aprendizado_auto',
      origem: contexto?.origem ?? 'compra',
      ponto: 'auto_vinculo',
      item,
      produtoId,
      aprendizado: {
        gravado: Boolean(learn.gravado),
        associacaoId: learn.associacaoId ?? null,
        motivo: learn.motivo ?? null,
        reutilizacao: Boolean(learn.reutilizacao),
        origem: `auto_${motor}`
      }
    });

    return learn;
  }

  /**
   * @param {import('./contracts/ItemIdentificavelDTO')[]|Object[]} itens
   * @param {import('./core/MiipContext')|Object} [contexto]
   * @returns {Promise<Object[]>}
   */
  async identificarLote(itens, contexto) {
    if (!Array.isArray(itens) || itens.length === 0) return [];

    const resultados = [];
    for (const item of itens) {
      resultados.push(await this.identificar(item, contexto));
    }
    return resultados;
  }

  /**
   * Processa identificação MIIP de todos os itens de uma NF-e importada.
   * Retorna `null` quando `usarMiipImportacaoXML` está desabilitado (fluxo legado).
   *
   * @param {Object} dadosXml
   * @returns {Promise<Object|null>}
   */
  async processarImportacaoXml(dadosXml) {
    await this._garantirInicializado();

    if (!this.estaImportacaoXmlHabilitada()) {
      this.registrarIntegracao({
        evento: 'importacao_xml_legado',
        origem: 'compra',
        ponto: 'importacao_xml',
        motivo: 'usarMiipImportacaoXML=false'
      });
      return null;
    }

    return this._importacaoXmlService.processar(dadosXml);
  }

  /**
   * @returns {Object|null}
   */
  obterUltimaImportacaoXml() {
    return this._importacaoXmlService.obterSessaoAtual();
  }

  /**
   * Registra confirmação manual do operador e grava aprendizado em `miip_associacoes`.
   *
 * Exige `confirmado: true` — confirmação do operador OU auto-aprendizado RC9.3
 * (origem auto_* após AUTO_VINCULAR).
 *
 * @param {Object} feedback
 * @param {boolean} feedback.confirmado - Confirmação explícita / auto
 * @param {number} feedback.produtoId - Produto escolhido
 * @param {string} feedback.fornecedorCnpj - CNPJ do fornecedor
 * @param {string} feedback.codigoFornecedor - Código cProd do fornecedor
 * @param {number} [feedback.usuarioId]
 * @param {string} [feedback.operacaoId]
 * @param {Object} [feedback.item]
 * @returns {Promise<{ sucesso: boolean, gravado: boolean, associacaoId: number|null, operacaoId: string, motivo: string|null, substituiu?: boolean }>}
 */
  async registrarFeedback(feedback) {
    await this._garantirInicializado();

    const resultado = await this._learningService.registrarConfirmacao(feedback);

    return {
      sucesso: Boolean(resultado.sucesso),
      gravado: Boolean(resultado.gravado),
      associacaoId: resultado.associacaoId ?? null,
      operacaoId: resultado.operacaoId ?? feedback?.operacaoId ?? '',
      motivo: resultado.motivo ?? null,
      reutilizacao: Boolean(resultado.reutilizacao),
      reativada: Boolean(resultado.reativada),
      substituida: Boolean(resultado.substituida),
      pendenteDecisao: Boolean(resultado.pendenteDecisao),
      estado: resultado.estado ?? null,
      conflito: resultado.conflito ?? null,
      confirmacoes: resultado.confirmacoes ?? null
    };
  }

  /**
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async obterHistorico(filtros = {}) {
    await this._garantirInicializado();
    const lista = await this._decisoesRepository.listar(filtros);
    return lista.map((decisao) => ({
      id: decisao.id,
      operacaoId: decisao.operacaoId,
      origem: decisao.origem,
      acao: decisao.acaoRecomendada,
      confianca: decisao.confianca,
      score: decisao.scoreFinal,
      produtoSugeridoId: decisao.produtoSugeridoId,
      produtoDecididoId: decisao.produtoDecididoId,
      conflito: decisao.conflito,
      feedbackStatus: decisao.feedbackStatus,
      duracaoMs: decisao.duracaoTotalMs,
      explicacao: decisao.metadados?.explicacao ?? null,
      versaoRegra: decisao.metadados?.versaoRegra ?? null,
      createdAt: decisao.createdAt,
      decidedAt: decisao.decidedAt
    }));
  }

  /**
   * @param {Object} [filtros]
   * @returns {Promise<Object>}
   */
  async obterEstatisticas(filtros = {}) {
    await this._garantirInicializado();
    return this._decisoesRepository.agregarEstatisticas(filtros);
  }

  /**
   * Health check RC1 — somente leitura; não executa identificação.
   *
   * @returns {Promise<Object>}
   */
  async healthCheck() {
    const MIIP_ROOT = path.join(__dirname);

    let inicializado = false;
    let engines = [];

    try {
      await this._garantirInicializado();
      inicializado = estaInicializado();
      engines = MotorRegistry.listarAtivos().map((motor) => ({
        codigo: motor.codigo,
        prioridade: motor.prioridade,
        ativo: motor.ativo !== false
      }));
    } catch (error) {
      return {
        pronto: false,
        versao: '1.0.0-rc1',
        release: 'RC1',
        erro: error?.message || 'Falha ao inicializar MIIP',
        verificadoEm: new Date().toISOString()
      };
    }

    const pipelineOk = fs.existsSync(path.join(MIIP_ROOT, 'core/MiipPipeline.js'));
    const decisionOk = fs.existsSync(path.join(MIIP_ROOT, 'core/DecisionEngine.js'));
    const explainOk = fs.existsSync(path.join(MIIP_ROOT, 'core/MiipExplainService.js'));
    const learningOk = fs.existsSync(path.join(MIIP_ROOT, 'services/MiipLearningService.js'));

    let banco = { ok: false, tempoMedioMs: null };
    try {
      const db = this._db ?? require('../../database');
      await db.whenReady();
      await db.get('SELECT 1 AS ok');
      const stats = await this._decisoesRepository.agregarEstatisticas();
      banco = {
        ok: true,
        tempoMedioMs: Math.round(Number(stats.tempoMedioMs ?? 0))
      };
    } catch (error) {
      banco = { ok: false, tempoMedioMs: null, erro: error?.message };
    }

    const registryTotal = MotorRegistry.total();
    const registryAtivos = MotorRegistry.totalAtivos();
    const enginesOk = engines.length >= 7 && registryAtivos >= 7;

    let telemetria = { ok: true, execucoesRegistradas: 0, ultimaExecucao: null };
    try {
      const historico = obterTelemetryService().obterHistorico();
      const ultimo = historico.length > 0 ? historico[historico.length - 1] : null;
      telemetria = {
        ok: true,
        execucoesRegistradas: historico.length,
        ultimaExecucao: ultimo
          ? {
            requestId: ultimo.requestId,
            tempoTotalMs: ultimo.tempoTotal,
            health: ultimo.health,
            motores: ultimo.enginesExecutados?.length ?? 0
          }
          : null
      };
    } catch (error) {
      telemetria = { ok: false, execucoesRegistradas: 0, erro: error?.message };
    }

    const componentesOk = pipelineOk && inicializado && enginesOk
      && decisionOk && explainOk && learningOk && banco.ok && telemetria.ok;

    const statusGeral = componentesOk
      ? 'ok'
      : (inicializado ? 'degradado' : 'indisponivel');

    return {
      pronto: componentesOk,
      statusGeral,
      versao: '1.0.0-rc1',
      release: 'RC1',
      usarMiip: this.estaHabilitado(),
      usarMiipImportacaoXML: this._featureFlags.obterUsarMiipImportacaoXML(),
      importacaoXmlHabilitada: this.estaImportacaoXmlHabilitada(),
      tempoMedioMs: banco.tempoMedioMs,
      verificadoEm: new Date().toISOString(),
      componentes: {
        pipeline: { ok: pipelineOk && inicializado },
        registry: {
          ok: registryAtivos >= 7,
          totalRegistrados: registryTotal,
          totalAtivos: registryAtivos,
          motores: MotorRegistry.listarAtivos().map((m) => ({
            codigo: m.codigo,
            prioridade: m.prioridade,
            versao: m.versao,
            ativo: m.ativo !== false
          }))
        },
        engines: {
          ok: enginesOk,
          total: engines.length,
          carregados: engines.map((e) => e.codigo)
        },
        decisionEngine: { ok: decisionOk },
        explain: { ok: explainOk },
        learning: { ok: learningOk },
        banco,
        telemetria
      },
      metodos: [
        'estaHabilitado',
        'estaImportacaoXmlHabilitada',
        'identificar',
        'identificarLote',
        'processarImportacaoXml',
        'obterUltimaImportacaoXml',
        'registrarIntegracao',
        'registrarFeedback',
        'obterHistorico',
        'obterEstatisticas',
        'healthCheck'
      ]
    };
  }
}

const instancia = new MiipService();

module.exports = instancia;
module.exports.MiipService = MiipService;
