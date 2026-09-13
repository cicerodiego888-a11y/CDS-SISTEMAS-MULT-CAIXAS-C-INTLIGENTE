/**
 * MonitoringIntelligence — orquestrador da camada de inteligência operacional.
 * Provider → Widget Builder → **Intelligence** → Result
 */

const { MonitoringTrendService } = require('./MonitoringTrendService');
const { MonitoringHealthService } = require('./MonitoringHealthService');
const { MonitoringAlertService } = require('./MonitoringAlertService');
const { MonitoringRecommendationService } = require('./MonitoringRecommendationService');
const { MonitoringInsightService } = require('./MonitoringInsightService');
const { ExecutiveInsightsService } = require('./ExecutiveInsightsService');
const { MODULE_STATUS } = require('./MonitoringSeverity');

class MonitoringIntelligence {
  constructor(deps = {}) {
    this.trendService = deps.trendService || new MonitoringTrendService();
    this.healthService = deps.healthService || new MonitoringHealthService();
    this.alertService = deps.alertService || new MonitoringAlertService();
    this.recommendationService = deps.recommendationService || new MonitoringRecommendationService();
    this.insightService = deps.insightService || new MonitoringInsightService();
    this.executiveService = deps.executiveService || new ExecutiveInsightsService();
  }

  async analyze(payload = {}, widgets = [], engineMetrics = {}) {
    const trends = await this.trendService.analyze(payload);
    const alerts = await this.alertService.generate(payload, trends);
    const health = this.healthService.evaluate(payload, alerts);
    const insights = this.insightService.generate(payload, trends, alerts);
    const recommendations = this.recommendationService.generate(alerts);

    const intelligence = {
      trends,
      health,
      alerts,
      insights,
      recommendations,
      updatedAt: new Date().toISOString()
    };

    intelligence.executiveInsights = this.executiveService.build(intelligence);
    intelligence.cop = this._buildCop(intelligence, engineMetrics);
    intelligence.widgets = this._enrichWidgets(widgets, intelligence);

    return intelligence;
  }

  _buildCop(intelligence, engineMetrics) {
    const crit = (intelligence.alerts || []).filter((a) => a.severidade === 'CRITICO');
    const modulos = [
      { id: 'monitoring_engine', nome: 'Monitoring Engine', status: MODULE_STATUS.ONLINE },
      { id: 'api', nome: 'API', status: MODULE_STATUS.ONLINE },
      { id: 'banco', nome: 'Banco', status: MODULE_STATUS.ONLINE },
      { id: 'plataforma_fiscal', nome: 'Plataforma Fiscal', status: MODULE_STATUS.NAO_MONITORADO },
      { id: 'central_inteligente', nome: 'Central Inteligente', status: this._statusCentral(intelligence) },
      { id: 'sefaz', nome: 'SEFAZ', status: MODULE_STATUS.ONLINE },
      { id: 'tef', nome: 'TEF', status: MODULE_STATUS.ATENCAO },
      { id: 'backup', nome: 'Backup', status: MODULE_STATUS.NAO_MONITORADO },
      { id: 'motor_comercial', nome: 'Motor Comercial', status: MODULE_STATUS.NAO_MONITORADO },
      { id: 'miip', nome: 'MIIP', status: MODULE_STATUS.NAO_MONITORADO }
    ];

    return {
      titulo: 'CENTRO DE OPERAÇÕES CDS',
      saudeGeral: intelligence.health?.geral,
      alertasCriticos: crit,
      recomendacoes: (intelligence.recommendations || []).slice(0, 5),
      insights: (intelligence.insights || []).slice(0, 5),
      ultimaAtualizacao: intelligence.updatedAt,
      modulos,
      metricasEngine: engineMetrics || {},
      meta: {
        iaReady: true,
        versao: 'M3',
        descricao: 'Camada preparada para integração de IA — insights/recomendações como DTOs estáveis.'
      }
    };
  }

  _statusCentral(intelligence) {
    const centralAlerts = (intelligence.alerts || []).filter((a) =>
      a.categoria === 'central' || a.id?.includes('central')
    );
    if (centralAlerts.some((a) => a.severidade === 'CRITICO')) return MODULE_STATUS.OFFLINE;
    if (centralAlerts.length) return MODULE_STATUS.ATENCAO;
    return MODULE_STATUS.ONLINE;
  }

  _enrichWidgets(widgets, intelligence) {
    const healthDomains = intelligence.health?.domains || {};
    return (widgets || []).map((w) => {
      const domain = w.domain || 'geral';
      const domainAlerts = (intelligence.alerts || []).filter((a) => a.dominio === domain);
      const domainInsights = (intelligence.insights || []).filter((i) => i.dominio === domain);
      const domainRecs = (intelligence.recommendations || []).filter((r) => r.dominio === domain);
      const domainTrend = intelligence.trends?.domains?.[domain] || intelligence.trends?.global;

      return {
        ...w,
        health: healthDomains[domain] || intelligence.health?.geral,
        recommendations: domainRecs.slice(0, 3),
        alerts: domainAlerts.slice(0, 5),
        insights: domainInsights.slice(0, 3),
        trendDetail: domainTrend || null,
        updatedAt: w.updatedAt || intelligence.updatedAt
      };
    });
  }
}

const monitoringIntelligence = new MonitoringIntelligence();

module.exports = {
  MonitoringIntelligence,
  monitoringIntelligence
};
