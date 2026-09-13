/**
 * CDS Monitoring Engine — contrato oficial de retorno.
 * Módulo independente (não pertence à Plataforma Fiscal nem à Central Inteligente).
 */

function criarMonitoringResult(opcoes = {}) {
  const agora = new Date().toISOString();
  return {
    success: opcoes.success !== false,
    timestamp: opcoes.timestamp || agora,
    source: opcoes.source || 'monitoring',
    metrics: opcoes.metrics || {},
    data: opcoes.data != null ? opcoes.data : {},
    warnings: Array.isArray(opcoes.warnings) ? opcoes.warnings : [],
    errors: Array.isArray(opcoes.errors) ? opcoes.errors : []
  };
}

module.exports = {
  criarMonitoringResult,
  MonitoringResult: { create: criarMonitoringResult }
};
