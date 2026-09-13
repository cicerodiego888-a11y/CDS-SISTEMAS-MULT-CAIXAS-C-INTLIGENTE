/**
 * CDS Monitoring Engine — orquestrador oficial de indicadores do ERP.
 * UI → Engine → Registry → Provider → WidgetBuilder → Result
 * Nenhuma tela deve consultar SQL/banco diretamente.
 */

const { MonitoringRegistry } = require('./MonitoringRegistry');
const { criarMonitoringMetrics } = require('./MonitoringMetrics');
const { criarMonitoringResult } = require('./MonitoringResult');
const { monitoringCache } = require('./MonitoringCache');
const { monitoringWidgetBuilder } = require('./widgets/MonitoringWidgetBuilder');
const { monitoringIntelligence } = require('./intelligence/MonitoringIntelligence');
const { monitoringActionCenter } = require('./actions/MonitoringActionCenter');
const FiscalProvider = require('./providers/FiscalProvider');
const FinanceiroProvider = require('./providers/FinanceiroProvider');
const CaixaProvider = require('./providers/CaixaProvider');
const EstoqueProvider = require('./providers/EstoqueProvider');
const RecebimentosProvider = require('./providers/RecebimentosProvider');
const ComercialProvider = require('./providers/ComercialProvider');
const AlertasProvider = require('./providers/AlertasProvider');
const TefProvider = require('./providers/TefProvider');

function registrarProvidersPadrao(registry) {
  registry.register(FiscalProvider);
  registry.register(FinanceiroProvider);
  registry.register(CaixaProvider);
  registry.register(EstoqueProvider);
  registry.register(RecebimentosProvider);
  registry.register(ComercialProvider);
  registry.register(AlertasProvider);
  registry.register(TefProvider);
  return registry;
}

class MonitoringEngine {
  /**
   * @param {{ registry?: MonitoringRegistry, cache?: import('./MonitoringCache').MonitoringCache, widgetBuilder?: import('./widgets/MonitoringWidgetBuilder').MonitoringWidgetBuilder }} [deps]
   */
  constructor(deps = {}) {
    this.registry = deps.registry || registrarProvidersPadrao(new MonitoringRegistry());
    this.cache = deps.cache || monitoringCache;
    this.widgetBuilder = deps.widgetBuilder || monitoringWidgetBuilder;
    this.intelligence = deps.intelligence || monitoringIntelligence;
    this.actionCenter = deps.actionCenter || monitoringActionCenter;
  }

  listProviders() {
    return this.registry.list();
  }

  /**
   * Agrega o summary oficial consumido por GET /api/monitoring/summary
   * @param {Object} context
   */
  async summary(context = {}) {
    const metrics = criarMonitoringMetrics();
    const competenciaKey = context.competencia?.competencia || 'atual';
    const cacheKey = `summary:v5:${competenciaKey}`;
    // Cache desabilitado em M1–M4 (estrutura); ações dependem de contexto/usuário
    metrics.markCacheHit(false);
    void this.cache.get(cacheKey);

    const fiscalResult = await this._safeCollect('fiscal', context, metrics);
    const financeiroResult = await this._safeCollect('financeiro', context, metrics);
    const caixaResult = await this._safeCollect('caixa', context, metrics);
    const estoqueResult = await this._safeCollect('estoque', context, metrics);
    const recebimentosResult = await this._safeCollect('recebimentos', context, metrics);
    const comercialResult = await this._safeCollect('comercial', context, metrics);
    const alertasResult = await this._safeCollect('alertas', context, metrics);
    const tefResult = await this._safeCollect('tef', context, metrics);

    const fiscalData = fiscalResult.data || {};
    const indicadoresFiscais = fiscalData.indicadoresFiscais || {};
    const payload = {
      competencia: context.competencia || null,
      indicadoresFiscais,
      fiscal: {
        vendas: fiscalData.vendas || {},
        entradas: fiscalData.entradas || {},
        indicadoresFiscais
      },
      naoFiscal: {
        vendas: (fiscalData.naoFiscal && fiscalData.naoFiscal.vendas) || {},
        entradas: (fiscalData.naoFiscal && fiscalData.naoFiscal.entradas) || {}
      },
      financeiro: (financeiroResult.data && financeiroResult.data.financeiro) || {},
      caixa: (caixaResult.data && caixaResult.data.caixa) || {},
      estoque: (estoqueResult.data && estoqueResult.data.estoque) || {},
      recebimentos: (recebimentosResult.data && recebimentosResult.data.recebimentos) || {},
      comercial: (comercialResult.data && comercialResult.data.comercial) || {},
      alertas: (alertasResult.data && alertasResult.data.alertas) || {},
      tef: (tefResult.data && tefResult.data.tef) || {}
    };

    const updatedAt = new Date().toISOString();
    const rawWidgets = this.widgetBuilder.build(payload, {
      updatedAt,
      competenciaLabel: indicadoresFiscais.competenciaLabel
    });

    const snapPre = metrics.snapshot();
    const intelligence = await this.intelligence.analyze(payload, rawWidgets, snapPre);

    payload.widgets = intelligence.widgets || rawWidgets;
    payload.intelligence = {
      health: intelligence.health,
      trends: intelligence.trends,
      alerts: intelligence.alerts,
      insights: intelligence.insights,
      recommendations: intelligence.recommendations,
      updatedAt: intelligence.updatedAt
    };
    payload.executiveInsights = intelligence.executiveInsights;

    // Action Center — camada pós-Intelligence (não altera Intelligence)
    const actionBundle = this.actionCenter.build(intelligence, {
      usuarioId: context.usuarioId,
      perfil: context.perfil,
      role: context.role,
      permissoes: context.permissoes
    }, payload);

    payload.cop = this.actionCenter.enrichCop(intelligence.cop || {}, actionBundle);
    payload.actionCenter = actionBundle.actionCenter;
    payload.recommendedActions = actionBundle.recommendedActions;
    payload.workQueue = actionBundle.workQueue;
    payload.timeline = actionBundle.timeline;

    // Enrich intelligence view copies with actions (UI only — original intelligence files untouched)
    payload.intelligence.alerts = actionBundle.alerts;
    payload.intelligence.insights = actionBundle.insights;
    payload.intelligence.recommendations = actionBundle.recommendations;

    this.cache.set(cacheKey, payload, 0);

    const snap = metrics.snapshot();
    return criarMonitoringResult({
      success: snap.errors.length === 0,
      source: 'MonitoringEngine',
      metrics: snap,
      data: payload,
      warnings: snap.warnings,
      errors: snap.errors
    });
  }

  async _safeCollect(providerId, context, metrics) {
    const provider = this.registry.get(providerId);
    if (!provider) {
      const msg = `Provider não registrado: ${providerId}`;
      metrics.addProvider(providerId, { success: false, tempoConsultaMs: 0, errors: [msg] });
      return criarMonitoringResult({
        success: false,
        source: providerId,
        data: {},
        errors: [msg]
      });
    }

    const t0 = Date.now();
    try {
      const result = await provider.collect(context);
      metrics.addProvider(providerId, {
        success: result.success !== false,
        tempoConsultaMs: Date.now() - t0,
        warnings: result.warnings,
        errors: result.errors
      });
      return result;
    } catch (err) {
      const msg = err.message || String(err);
      metrics.addProvider(providerId, {
        success: false,
        tempoConsultaMs: Date.now() - t0,
        errors: [msg]
      });
      return criarMonitoringResult({
        success: false,
        source: providerId,
        data: {},
        errors: [msg]
      });
    }
  }
}

const monitoringEngine = new MonitoringEngine();

module.exports = {
  MonitoringEngine,
  monitoringEngine,
  registrarProvidersPadrao
};
