/**
 * DTO oficial de Insight / Alert / Recommendation.
 */

const { SEVERITY, prioridadeFromSeveridade } = require('./MonitoringSeverity');

function criarInsight(opcoes = {}) {
  return {
    id: opcoes.id || `insight-${Date.now()}`,
    categoria: opcoes.categoria || 'geral',
    mensagem: opcoes.mensagem || '',
    prioridade: opcoes.prioridade != null ? opcoes.prioridade : prioridadeFromSeveridade(opcoes.severidade || SEVERITY.INFO),
    origem: opcoes.origem || 'MonitoringInsightService',
    timestamp: opcoes.timestamp || new Date().toISOString(),
    dominio: opcoes.dominio || opcoes.domain || 'geral',
    icon: opcoes.icon || 'fa-lightbulb',
    severidade: opcoes.severidade || SEVERITY.INFO,
    metricas: opcoes.metricas || {}
  };
}

function criarAlerta(opcoes = {}) {
  return {
    id: opcoes.id || `alert-${Date.now()}`,
    titulo: opcoes.titulo || '',
    descricao: opcoes.descricao || '',
    categoria: opcoes.categoria || 'operacional',
    dominio: opcoes.dominio || opcoes.domain || 'geral',
    severidade: opcoes.severidade || SEVERITY.ATENCAO,
    timestamp: opcoes.timestamp || new Date().toISOString()
  };
}

function criarRecomendacao(opcoes = {}) {
  return {
    id: opcoes.id || `rec-${Date.now()}`,
    titulo: opcoes.titulo || '',
    descricao: opcoes.descricao || '',
    dominio: opcoes.dominio || 'geral',
    origemAlerta: opcoes.origemAlerta || null,
    prioridade: opcoes.prioridade != null ? opcoes.prioridade : 2,
    timestamp: opcoes.timestamp || new Date().toISOString()
  };
}

module.exports = {
  criarInsight,
  criarAlerta,
  criarRecomendacao
};
