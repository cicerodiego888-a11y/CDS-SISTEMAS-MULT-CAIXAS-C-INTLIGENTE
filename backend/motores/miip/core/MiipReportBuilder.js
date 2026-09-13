/**
 * MiipReportBuilder — Geração estrutural do relatório de execução.
 *
 * Sprint 2 Pipeline: esqueleto do relatório — conteúdo enriquecido em sprint futura.
 *
 * @class MiipReportBuilder
 */

class MiipReportBuilder {
  /**
   * @param {import('./MiipExecution')} execution
   * @returns {Object}
   */
  build(execution) {
    if (!execution) {
      return {
        versao: '1.0.0-pipeline',
        requestId: null,
        resumo: null
      };
    }

    return {
      versao: '1.0.0-pipeline',
      requestId: execution.requestId,
      estado: execution.estado,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      durationMs: execution.duration,
      contexto: execution.context?.toJSON?.() ?? execution.context ?? null,
      enginesExecutados: execution.enginesExecutados ?? [],
      candidatos: execution.candidatos?.toJSON?.() ?? null,
      timeline: execution.timeline?.toJSON?.() ?? null,
      metricas: execution.metricas ?? null,
      logs: execution.logs ?? [],
      resultado: execution.resultado?.toJSON?.() ?? execution.resultado ?? null,
      resumo: {
        totalCandidatos: execution.candidatos?.total?.() ?? 0,
        totalEngines: (execution.enginesExecutados ?? []).length,
        etapas: execution.timeline?.listar?.()?.length ?? 0
      }
    };
  }
}

module.exports = MiipReportBuilder;
