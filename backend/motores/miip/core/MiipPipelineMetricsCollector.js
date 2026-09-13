/**
 * MiipPipelineMetricsCollector — Métricas de execução do Pipeline MIIP.
 *
 * Distinto de `metrics/MiipMetricsCollector` (métricas por motor individual).
 * Sprint 2 Pipeline: coleta em memória — sem persistência.
 *
 * @class MiipPipelineMetricsCollector
 */

class MiipPipelineMetricsCollector {
  constructor() {
    /** @private @type {Object[]} */
    this._execucoes = [];
  }

  /**
   * Registra métricas de uma execução completa do pipeline.
   *
   * @param {Object} dados
   * @param {string} dados.requestId
   * @param {number} [dados.durationMs]
   * @param {number} [dados.totalEngines]
   * @param {number} [dados.totalCandidatos]
   * @param {boolean} [dados.sucesso]
   * @param {string|null} [dados.erro]
   * @returns {Object}
   */
  registrarExecucao(dados = {}) {
    const registro = {
      requestId: dados.requestId ?? null,
      durationMs: Number(dados.durationMs ?? 0),
      totalEngines: Number(dados.totalEngines ?? 0),
      totalCandidatos: Number(dados.totalCandidatos ?? 0),
      sucesso: dados.sucesso !== false,
      erro: dados.erro ?? null,
      timestamp: new Date().toISOString()
    };

    this._execucoes.push(registro);
    return registro;
  }

  /**
   * @returns {Object}
   */
  obterResumo() {
    const total = this._execucoes.length;
    const sucesso = this._execucoes.filter((e) => e.sucesso).length;
    const duracaoTotal = this._execucoes.reduce((acc, e) => acc + e.durationMs, 0);

    return {
      totalExecucoes: total,
      totalSucesso: sucesso,
      totalErro: total - sucesso,
      tempoMedioMs: total > 0 ? duracaoTotal / total : 0,
      execucoes: [...this._execucoes]
    };
  }

  /**
   * Limpa métricas (apenas testes).
   */
  reiniciar() {
    this._execucoes = [];
  }
}

const instancia = new MiipPipelineMetricsCollector();

module.exports = instancia;
module.exports.MiipPipelineMetricsCollector = MiipPipelineMetricsCollector;
