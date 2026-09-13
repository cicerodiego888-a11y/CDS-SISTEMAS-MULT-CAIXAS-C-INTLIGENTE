/**
 * Contrato oficial de Widget do CDS Monitoring Engine.
 * Reutilizável: Dashboard, Mobile, BI (mesmo DTO).
 */

function criarWidget(opcoes = {}) {
  return {
    id: opcoes.id || `widget-${Date.now()}`,
    domain: opcoes.domain || 'geral',
    scope: opcoes.scope || 'fiscal', // fiscal | nao_fiscal | both
    title: opcoes.title || '',
    icon: opcoes.icon || 'fa-chart-bar',
    badge: opcoes.badge || null,
    value: opcoes.value != null ? opcoes.value : 0,
    subtitle: opcoes.subtitle || '',
    trend: opcoes.trend != null ? opcoes.trend : null,
    updatedAt: opcoes.updatedAt || new Date().toISOString(),
    metrics: opcoes.metrics || {},
    meta: opcoes.meta || {}
  };
}

module.exports = {
  criarWidget
};
