/**
 * Coletor de métricas do Monitoring Engine (estrutura M1).
 */

function criarMonitoringMetrics() {
  const inicio = Date.now();
  const providers = [];
  const warnings = [];
  const errors = [];
  let cacheHit = false;

  return {
    markCacheHit(hit) {
      cacheHit = Boolean(hit);
    },
    addProvider(nome, info = {}) {
      providers.push({
        provider: nome,
        tempoConsultaMs: Number(info.tempoConsultaMs || 0),
        success: info.success !== false,
        warnings: info.warnings || [],
        errors: info.errors || []
      });
      if (Array.isArray(info.warnings)) warnings.push(...info.warnings);
      if (Array.isArray(info.errors)) errors.push(...info.errors);
    },
    snapshot() {
      return {
        tempoConsulta: Date.now() - inicio,
        cacheHit,
        provider: providers.map((p) => p.provider),
        providers,
        warnings,
        errors
      };
    }
  };
}

module.exports = {
  criarMonitoringMetrics,
  MonitoringMetrics: { create: criarMonitoringMetrics }
};
