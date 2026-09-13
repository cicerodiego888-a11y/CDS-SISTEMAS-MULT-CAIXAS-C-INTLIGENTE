/**
 * ExecutiveInsightsService — painel fixo 🧠 EXECUTIVE INSIGHTS.
 * Consome somente saída da camada Intelligence.
 */

const { SEVERITY, SEVERITY_ICON, prioridadeFromSeveridade } = require('./MonitoringSeverity');

class ExecutiveInsightsService {
  build(intelligence = {}) {
    const { insights = [], alerts = [], recommendations = [], trends = {}, health = {} } = intelligence;
    const ts = new Date().toISOString();

    const items = [];

    (insights || []).forEach((ins) => {
      items.push({
        id: ins.id,
        categoria: ins.categoria,
        mensagem: ins.mensagem,
        prioridade: ins.prioridade ?? prioridadeFromSeveridade(ins.severidade),
        origem: ins.origem || 'MonitoringInsightService',
        timestamp: ins.timestamp || ts,
        dominio: ins.dominio,
        scope: ins.scope || (ins.dominio === 'caixa' && ins.mensagem?.includes('Não Fiscal') ? 'nao_fiscal' : 'fiscal'),
        icon: ins.icon,
        severidade: ins.severidade,
        emoji: SEVERITY_ICON[ins.severidade] || '🔵',
        tipo: 'insight'
      });
    });

    (alerts || [])
      .filter((a) => a.severidade !== SEVERITY.INFO)
      .slice(0, 5)
      .forEach((a) => {
        items.push({
          id: `exec.${a.id}`,
          categoria: a.categoria,
          mensagem: a.titulo + (a.descricao ? `: ${a.descricao}` : ''),
          prioridade: prioridadeFromSeveridade(a.severidade),
          origem: 'MonitoringAlertService',
          timestamp: a.timestamp || ts,
          dominio: a.dominio,
          icon: 'fa-bell',
          severidade: a.severidade,
          emoji: SEVERITY_ICON[a.severidade] || '🟡',
          tipo: 'alerta'
        });
      });

    items.sort((a, b) => a.prioridade - b.prioridade);

    const destaqueRecomendacao = (recommendations || [])[0] || null;

    return {
      titulo: 'EXECUTIVE INSIGHTS',
      icon: 'fa-brain',
      items: items.slice(0, 8),
      recomendacaoDestaque: destaqueRecomendacao
        ? {
          titulo: destaqueRecomendacao.titulo,
          descricao: destaqueRecomendacao.descricao,
          dominio: destaqueRecomendacao.dominio
        }
        : null,
      saudeGeral: health.geral || 'BOM',
      tendenciaLabel: trends?.global?.label || '▬ Estável',
      updatedAt: ts
    };
  }
}

module.exports = { ExecutiveInsightsService };
