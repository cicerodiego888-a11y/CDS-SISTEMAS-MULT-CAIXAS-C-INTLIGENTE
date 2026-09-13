/**
 * MiipMonitoringService — Monitoramento operacional do MIIP.
 *
 * Sprint 14 — Observabilidade e Telemetria.
 *
 * @class MiipMonitoringService
 * @module motores/miip/services/MiipMonitoringService
 */

const fs = require('fs');
const path = require('path');
const MiipPerformanceMetrics = require('../core/MiipPerformanceMetrics');
const MiipHealthStatus = require('../core/MiipHealthStatus');
const MotorRegistry = require('../core/MotorRegistry');
const { MiipMetricsCollector } = require('../metrics/MiipMetricsCollector');

const MIIP_ROOT = path.join(__dirname, '..');

const CONFIGS_OBRIGATORIOS = [
  'config/decision-rules.json',
  'config/similarity-weights.json',
  'config/miip.defaults.json'
];

class MiipMonitoringService {
  /**
   * @param {Object} [deps]
   * @param {import('./MiipTelemetryService')} [deps.telemetryService]
   * @param {MiipMetricsCollector} [deps.metricsCollector]
   * @param {import('../core/MotorRegistry')} [deps.motorRegistry]
   */
  constructor(deps = {}) {
    this._telemetry = deps.telemetryService ?? null;
    this._metrics = deps.metricsCollector ?? new MiipMetricsCollector();
    this._registry = deps.motorRegistry ?? MotorRegistry;
  }

  /**
   * @param {import('../core/MiipExecutionReport')[]} [execucoes]
   * @returns {MiipPerformanceMetrics}
   */
  obterMetricas(execucoes) {
    const lista = execucoes ?? this._telemetry?.obterHistorico?.() ?? [];
    return MiipPerformanceMetrics.calcular(lista.map((e) => e.toJSON?.() ?? e));
  }

  /**
   * @returns {Object}
   */
  analisar() {
    const metricas = this.obterMetricas();
    const resumoMotores = this._metrics.obterResumo?.() ?? { motores: [] };
    const motoresComErro = (resumoMotores.motores ?? []).filter((m) => m.totalErros > 0);
    const motoresDesativados = this._registry.listarInativos?.() ?? [];
    const falhasConfig = this._verificarConfigs();

    let status = MiipHealthStatus.OK;

    if (motoresComErro.length > 0 || falhasConfig.length > 0) {
      status = MiipHealthStatus.ERROR;
    } else if (motoresDesativados.length > 0) {
      status = MiipHealthStatus.WARNING;
    }

    return {
      status,
      metricas: metricas.toJSON(),
      tempoMedio: metricas.tempoMedio,
      tempoMaximo: metricas.tempoMaximo,
      tempoMinimo: metricas.tempoMinimo,
      totalExecucoes: metricas.totalExecucoes,
      tempoPorEngine: metricas.tempoPorEngine,
      motoresComErro: motoresComErro.map((m) => ({
        motor: m.motor,
        totalErros: m.totalErros,
        totalConsultas: m.totalConsultas
      })),
      motoresDesativados: motoresDesativados.map((m) => ({
        codigo: m.codigo,
        descricao: m.descricao
      })),
      falhasConfiguracao: falhasConfig,
      verificadoEm: new Date().toISOString()
    };
  }

  /**
   * @private
   * @returns {Object[]}
   */
  _verificarConfigs() {
    const falhas = [];

    CONFIGS_OBRIGATORIOS.forEach((rel) => {
      const caminho = path.join(MIIP_ROOT, rel);
      if (!fs.existsSync(caminho)) {
        falhas.push({ arquivo: rel, erro: 'arquivo_ausente' });
        return;
      }

      try {
        JSON.parse(fs.readFileSync(caminho, 'utf8'));
      } catch (error) {
        falhas.push({ arquivo: rel, erro: 'json_invalido', mensagem: error.message });
      }
    });

    return falhas;
  }
}

module.exports = MiipMonitoringService;
