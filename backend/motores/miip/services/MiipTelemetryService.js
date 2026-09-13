/**
 * MiipTelemetryService — Telemetria de execuções MIIP.
 *
 * Sprint 14 — Observabilidade e Telemetria.
 * Não altera regras de negócio nem motores.
 *
 * @class MiipTelemetryService
 * @module motores/miip/services/MiipTelemetryService
 */

const MiipExecutionReport = require('../core/MiipExecutionReport');
const MiipHealthStatus = require('../core/MiipHealthStatus');
const { MiipMetricsCollector } = require('../metrics/MiipMetricsCollector');
const { MiipMotorLogService } = require('../logs/MiipMotorLogService');

/**
 * @returns {string}
 */
function gerarRequestId() {
  return `miip-tel-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

class MiipTelemetryService {
  /**
   * @param {Object} [deps]
   * @param {MiipMetricsCollector} [deps.metricsCollector]
   * @param {MiipMotorLogService} [deps.logService]
   */
  constructor(deps = {}) {
    this._metrics = deps.metricsCollector ?? new MiipMetricsCollector();
    this._logs = deps.logService ?? new MiipMotorLogService();
    /** @private @type {Map<string, Object>} */
    this._sessoes = new Map();
    /** @private @type {MiipExecutionReport[]} */
    this._historico = [];
  }

  /**
   * @returns {MiipExecutionReport[]}
   */
  obterHistorico() {
    return [...this._historico];
  }

  /**
   * @returns {void}
   */
  reiniciar() {
    this._sessoes.clear();
    this._historico = [];
    this._metrics.reiniciar?.();
    this._logs.reiniciar?.();
  }

  /**
   * Inicia rastreamento de uma execução.
   *
   * @param {Object} [opcoes]
   * @param {string} [opcoes.requestId]
   * @returns {string}
   */
  iniciarExecucao(opcoes = {}) {
    const requestId = opcoes.requestId ?? gerarRequestId();

    this._sessoes.set(requestId, {
      requestId,
      iniciadoEm: new Date().toISOString(),
      enginesExecutados: [],
      tempoPorEngine: {},
      warnings: [],
      errors: []
    });

    return requestId;
  }

  /**
   * Registra execução de um motor.
   *
   * @param {string} requestId
   * @param {Object} dados
   * @param {string} dados.motor
   * @param {number} [dados.tempoMs]
   * @param {boolean} [dados.erro]
   * @param {boolean} [dados.timeout]
   * @param {boolean} [dados.encontrado]
   * @returns {void}
   */
  registrarEngine(requestId, dados = {}) {
    const sessao = this._sessoes.get(requestId);
    if (!sessao) return;

    const motor = dados.motor ?? 'desconhecido';
    const tempoMs = Number(dados.tempoMs ?? 0);

    if (!sessao.enginesExecutados.includes(motor)) {
      sessao.enginesExecutados.push(motor);
    }

    sessao.tempoPorEngine[motor] = tempoMs;

    if (dados.timeout) {
      sessao.warnings.push(`Timeout no motor ${motor}`);
    }

    if (dados.erro) {
      sessao.errors.push({
        motor,
        mensagem: dados.mensagem ?? `Erro no motor ${motor}`,
        tempoMs
      });
    }

    this._metrics.registrarExecucao({
      motor,
      duracaoMs: tempoMs,
      encontrado: dados.encontrado === true,
      erro: dados.erro === true || dados.timeout === true
    });

    this._logs.registrar({
      motor,
      duracaoMs: tempoMs,
      erro: dados.erro ? (dados.mensagem ?? 'erro_motor') : null,
      evento: dados.timeout ? 'engine_timeout' : 'engine_executado'
    });
  }

  /**
   * Finaliza execução e gera relatório.
   *
   * @param {string} requestId
   * @param {Object} [resultado]
   * @returns {MiipExecutionReport}
   */
  finalizarExecucao(requestId, resultado = {}) {
    const sessao = this._sessoes.get(requestId) ?? {
      requestId,
      iniciadoEm: new Date().toISOString(),
      enginesExecutados: [],
      tempoPorEngine: {},
      warnings: [],
      errors: []
    };

    const finalizadoEm = new Date().toISOString();
    const tempoTotal = Number(resultado.tempoTotal ?? resultado.tempoMs ?? 0);

    let health = MiipHealthStatus.OK;
    if (sessao.errors.length > 0) {
      health = MiipHealthStatus.ERROR;
    } else if (sessao.warnings.length > 0) {
      health = MiipHealthStatus.WARNING;
    }

    const report = MiipExecutionReport.create({
      requestId,
      enginesExecutados: resultado.enginesExecutados ?? sessao.enginesExecutados,
      tempoTotal,
      tempoPorEngine: { ...sessao.tempoPorEngine, ...(resultado.tempoPorEngine ?? {}) },
      produtoSelecionado: resultado.produtoSelecionado ?? null,
      decisao: resultado.decisao ?? null,
      nivelConfianca: resultado.nivelConfianca ?? null,
      scoreFinal: resultado.scoreFinal ?? null,
      quantidadeCandidatos: resultado.quantidadeCandidatos ?? 0,
      explicacao: resultado.explicacao ?? null,
      warnings: [...sessao.warnings, ...(resultado.warnings ?? [])],
      errors: [...sessao.errors, ...(resultado.errors ?? [])],
      health,
      iniciadoEm: sessao.iniciadoEm,
      finalizadoEm
    });

    this._historico.push(report);
    this._sessoes.delete(requestId);

    this._logs.registrar({
      motor: 'miip_telemetry',
      evento: 'execucao_finalizada',
      duracaoMs: tempoTotal,
      produtoId: report.produtoSelecionado?.produtoId ?? null,
      resultado: report.toJSON()
    });

    return report;
  }

  /**
   * Atalho: registra execução completa em uma chamada.
   *
   * @param {Object} dados
   * @returns {MiipExecutionReport}
   */
  registrarExecucao(dados = {}) {
    const requestId = this.iniciarExecucao({ requestId: dados.requestId });

    (dados.engines ?? []).forEach((engine) => {
      this.registrarEngine(requestId, engine);
    });

    return this.finalizarExecucao(requestId, dados);
  }
}

module.exports = MiipTelemetryService;
