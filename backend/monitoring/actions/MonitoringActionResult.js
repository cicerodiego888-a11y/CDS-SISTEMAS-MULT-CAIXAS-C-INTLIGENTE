/**
 * DTO oficial de Action — COP Action Center.
 * Somente navegação sugerida. Sem HTML. Sem SQL. Sem escrita.
 */

const PRIORITY = Object.freeze({
  CRITICO: 1,
  ALTA: 2,
  MEDIA: 3,
  BAIXA: 4
});

function criarAction(opcoes = {}) {
  return {
    id: opcoes.id || `action-${Date.now()}`,
    label: opcoes.label || '',
    icon: opcoes.icon || 'fa-arrow-right',
    page: opcoes.page || null,
    route: opcoes.route || null,
    action: opcoes.action || 'navigate',
    permission: opcoes.permission || null,
    params: opcoes.params || {},
    priority: opcoes.priority != null ? opcoes.priority : PRIORITY.MEDIA,
    priorityLabel: opcoes.priorityLabel || labelPrioridade(opcoes.priority),
    category: opcoes.category || 'geral',
    dominio: opcoes.dominio || opcoes.domain || 'geral',
    sourceId: opcoes.sourceId || null,
    sourceType: opcoes.sourceType || null,
    description: opcoes.description || ''
  };
}

function labelPrioridade(p) {
  if (p === PRIORITY.CRITICO || p === 1) return 'Crítico';
  if (p === PRIORITY.ALTA || p === 2) return 'Alta';
  if (p === PRIORITY.MEDIA || p === 3) return 'Média';
  return 'Baixa';
}

function criarActionResult(opcoes = {}) {
  return {
    id: opcoes.id || 'action-center',
    title: opcoes.title || 'COP Action Center',
    description: opcoes.description || '',
    severity: opcoes.severity || 'INFO',
    health: opcoes.health || null,
    trend: opcoes.trend || null,
    alerts: opcoes.alerts || [],
    recommendations: opcoes.recommendations || [],
    actions: opcoes.actions || [],
    workQueue: opcoes.workQueue || [],
    timeline: opcoes.timeline || [],
    updatedAt: opcoes.updatedAt || new Date().toISOString()
  };
}

module.exports = {
  PRIORITY,
  criarAction,
  criarActionResult,
  labelPrioridade
};
