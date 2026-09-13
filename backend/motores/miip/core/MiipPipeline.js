/**
 * MiipPipeline — Cérebro do MIIP: pipeline profissional de execução.
 *
 * Todo item recebido pelo MIIP DEVE passar por este pipeline.
 * Nenhum Engine pode ser executado diretamente — apenas via `engineExecutor`.
 *
 * Sprint 2 Pipeline: arquitetura estrutural — sem regras de identificação,
 * sem banco, sem integração ERP e sem motores concretos.
 *
 * Fluxo:
 *   Entrada → Context → RequestId → Config → Engines → Candidatos →
 *   Decisão → Relatório → MiipResult → Métricas → Resposta
 *
 * @class MiipPipeline
 */

const MiipRequest = require('./MiipRequest');
const MiipResponse = require('./MiipResponse');
const MiipExecution = require('./MiipExecution');
const MiipExecutionState = require('./MiipExecutionState');
const MiipCandidateCollection = require('./MiipCandidateCollection');
const MiipDecisionBuilder = require('./MiipDecisionBuilder');
const MiipReportBuilder = require('./MiipReportBuilder');
const MiipResult = require('./MiipResult');
const MiipScore = require('./MiipScore');
const MiipContext = require('./MiipContext');
const pipelineMetrics = require('./MiipPipelineMetricsCollector');
const { persistirDecisao } = require('../utils/MiipDecisaoPersistencia');

/**
 * @returns {string}
 */
function gerarRequestId() {
  return `miip-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Carregador de configuração padrão (memória — sem banco).
 *
 * @returns {Promise<Object>}
 */
async function carregarConfiguracaoPadrao() {
  return {
    usarMiip: true,
    motoresAtivos: [],
    timeoutMotorMs: 500,
    versao: '1.0.0-pipeline'
  };
}

class MiipPipeline {
  /**
   * @param {Object} [deps]
   * @param {Function} [deps.carregarConfiguracao]
   * @param {Function} [deps.resolverEngines] - (config) => EngineDescriptor[]
   * @param {Function} [deps.engineExecutor] - (engines, item, context) => Promise<candidatos[]>
   * @param {import('./MiipDecisionBuilder')} [deps.decisionBuilder]
   * @param {import('./MiipReportBuilder')} [deps.reportBuilder]
   * @param {import('./MiipPipelineMetricsCollector')} [deps.metricsCollector]
   * @param {import('../services/MiipTelemetryService')} [deps.telemetryService]
   * @param {import('../repositories/MiipDecisoesRepository')} [deps.decisoesRepository]
   */
  constructor(deps = {}) {
    this._carregarConfiguracao = deps.carregarConfiguracao ?? carregarConfiguracaoPadrao;
    this._resolverEngines = deps.resolverEngines ?? (() => []);
    this._engineExecutor = deps.engineExecutor ?? (async () => []);
    this._decisionBuilder = deps.decisionBuilder ?? new MiipDecisionBuilder();
    this._reportBuilder = deps.reportBuilder ?? new MiipReportBuilder();
    this._metricsCollector = deps.metricsCollector ?? pipelineMetrics;
    this._telemetryService = deps.telemetryService ?? null;
    this._decisoesRepository = deps.decisoesRepository ?? null;
  }

  /**
   * Ponto de entrada principal do pipeline.
   *
   * @param {import('./MiipRequest')|Object} entrada
   * @returns {Promise<import('./MiipResponse')>}
   */
  async executar(entrada) {
    const request = entrada instanceof MiipRequest
      ? entrada
      : MiipRequest.create(entrada);

    const execution = MiipExecution.criar(request);

    try {
      await this._executarFluxo(request, execution);
      execution.finalizar();
    } catch (error) {
      execution.falhar(error);
      execution.registrarLog('pipeline_erro', { erro: execution.erro });
    }

    const response = MiipResponse.fromExecution(execution, execution.relatorio);
    return response;
  }

  /**
   * @private
   * @param {MiipRequest} request
   * @param {MiipExecution} execution
   */
  async _executarFluxo(request, execution) {
    await execution.timeline.executarEtapa('entrada', async () => {
      execution.registrarLog('entrada', { item: request.item?.toJSON?.() ?? request.item });
    });

    await execution.timeline.executarEtapa('criar_context', async () => {
      execution.context = request.contexto instanceof MiipContext
        ? request.contexto
        : MiipContext.agora(request.contexto);
      execution.transicionar(MiipExecutionState.INICIADO);
    });

    await execution.timeline.executarEtapa('gerar_request_id', async () => {
      request.requestId = request.requestId || gerarRequestId();
      execution.requestId = request.requestId;
      execution.context.operacaoId = execution.context.operacaoId || request.requestId;

      if (this._telemetryService) {
        this._telemetryService.iniciarExecucao({ requestId: execution.requestId });
      }
    });

    await execution.timeline.executarEtapa('registrar_inicio', async () => {
      execution.registrarLog('inicio', {
        requestId: execution.requestId,
        origem: execution.context.origem
      });
    });

    const configuracao = await execution.timeline.executarEtapa('carregar_configuracao', async () => {
      const config = await this._carregarConfiguracao(execution.context);
      execution.configuracao = config;
      return config;
    });

    const engines = await execution.timeline.executarEtapa('obter_engines_ativos', async () => {
      return this._resolverEngines(configuracao, execution.context);
    });

    const enginesOrdenados = await execution.timeline.executarEtapa('ordenar_engines', async () => {
      return [...engines].sort((a, b) => Number(a.prioridade ?? 0) - Number(b.prioridade ?? 0));
    });

    execution.transicionar(MiipExecutionState.EXECUTANDO);

    const candidatosBrutos = await execution.timeline.executarEtapa('executar_engines', async () => {
      const resultadoEngines = await this._engineExecutor(
        enginesOrdenados,
        request.item,
        execution.context
      );

      const tempoPorEngine = resultadoEngines?._meta?.tempoPorEngine ?? {};
      if (this._telemetryService && execution.requestId) {
        Object.entries(tempoPorEngine).forEach(([motor, tempoMs]) => {
          this._telemetryService.registrarEngine(execution.requestId, {
            motor,
            tempoMs: Number(tempoMs ?? 0)
          });
        });
      }

      return resultadoEngines;
    });

    const engineMeta = candidatosBrutos?._meta ?? {};
    const produtosPorMotor = engineMeta.produtosPorMotor ?? [];

    await execution.timeline.executarEtapa('receber_candidatos', async () => {
      const lista = Array.isArray(candidatosBrutos) ? candidatosBrutos : [];
      execution.enginesExecutados = enginesOrdenados.map((e) => e.codigo || e.nome || 'engine');
      execution.candidatos.adicionarVarios(lista);
      execution.registrarLog('candidatos_recebidos', { total: execution.candidatos.total() });
    });

    execution.transicionar(MiipExecutionState.CONSOLIDANDO);

    const colecaoConsolidada = await execution.timeline.executarEtapa('consolidar_candidatos', async () => {
      return execution.candidatos.eliminarDuplicados();
    });

    execution.candidatos = colecaoConsolidada;

    const melhorCandidato = await execution.timeline.executarEtapa('escolher_melhor_candidato', async () => {
      return colecaoConsolidada.melhor();
    });

    const decisao = this._decisionBuilder.build(colecaoConsolidada, {
      enginesExecutados: execution.enginesExecutados,
      produtosPorMotor,
      contexto: execution.context,
      similarityResult: engineMeta.similarityResult ?? null,
      semanticProduct: engineMeta.semanticProduct ?? null
    });

    const relatorio = await execution.timeline.executarEtapa('gerar_relatorio', async () => {
      execution.candidatos = colecaoConsolidada;
      const parcial = this._reportBuilder.build(execution);
      execution.relatorio = parcial;
      return parcial;
    });

    const resultado = await execution.timeline.executarEtapa('gerar_miip_result', async () => {
      const ranqueados = colecaoConsolidada.ranking();
      const melhor = ranqueados[0];
      const segundo = ranqueados[1];
      const scoreValor = melhor?.scoreTotal ?? 0;

      const miipResult = MiipResult.create({
        decisao,
        score: scoreValor > 0
          ? MiipScore.create({
            valor: scoreValor,
            gap: segundo ? melhor.scoreTotal - segundo.scoreTotal : null,
            enginesConcordantes: execution.enginesExecutados.length
          })
          : MiipScore.vazio(),
        candidatos: ranqueados,
        enginesExecutados: execution.enginesExecutados,
        requestId: execution.requestId,
        startedAt: execution.startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: execution.timeline.duracaoTotalMs(),
        engineCount: execution.enginesExecutados.length
      });

      execution.resultado = miipResult;
      execution.registrarLog('resultado_gerado', {
        candidatos: ranqueados.length,
        melhorProdutoId: melhorCandidato?.produtoId ?? null
      });

      void relatorio;
      return miipResult;
    });

    await execution.timeline.executarEtapa('registrar_metricas', async () => {
      execution.metricas = this._metricsCollector.registrarExecucao({
        requestId: execution.requestId,
        durationMs: execution.timeline.duracaoTotalMs(),
        totalEngines: execution.enginesExecutados.length,
        totalCandidatos: colecaoConsolidada.total(),
        sucesso: true
      });
      void resultado;
    });

    await execution.timeline.executarEtapa('persistir_decisao', async () => {
      if (this._decisoesRepository) {
        execution.decisaoPersistida = await persistirDecisao({
          decisoesRepository: this._decisoesRepository,
          request,
          execution,
          decisao,
          resultado: execution.resultado,
          meta: engineMeta
        });
      }
    });

    await execution.timeline.executarEtapa('registrar_telemetria', async () => {
      if (this._telemetryService && execution.requestId) {
        const melhor = colecaoConsolidada.melhor();
        execution.telemetria = this._telemetryService.finalizarExecucao(execution.requestId, {
          enginesExecutados: execution.enginesExecutados,
          tempoTotal: execution.timeline.duracaoTotalMs(),
          tempoPorEngine: engineMeta.tempoPorEngine ?? {},
          produtoSelecionado: melhor,
          decisao: decisao?.acao ?? null,
          nivelConfianca: decisao?.confianca ?? null,
          scoreFinal: decisao?.score ?? resultado?.score?.valor ?? null,
          quantidadeCandidatos: colecaoConsolidada.total(),
          explicacao: decisao?.explicacao ?? null
        });
      }
    });

    execution.registrarLog('pipeline_concluido', {
      requestId: execution.requestId,
      durationMs: execution.timeline.duracaoTotalMs()
    });
  }

  /**
   * @returns {{ pronto: boolean, versao: string }}
   */
  healthCheck() {
    return {
      pronto: true,
      versao: '1.0.0-rc1',
      componente: 'MiipPipeline'
    };
  }
}

const instancia = new MiipPipeline();

module.exports = instancia;
module.exports.MiipPipeline = MiipPipeline;
