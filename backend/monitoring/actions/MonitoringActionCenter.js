/**
 * MonitoringActionCenter — COP Action Center.
 * Consome saída da Intelligence e anexa Actions[] (somente navegação sugerida).
 * Não altera Intelligence. Não consulta banco. Não grava dados.
 */

const { MonitoringActionRegistry } = require('./MonitoringActionRegistry');
const { MonitoringActionBuilder, registrarCatalogoPadrao } = require('./MonitoringActionBuilder');
const { criarActionContext } = require('./MonitoringActionContext');
const { filtrarActionsPorPermissao } = require('./MonitoringActionPermissions');
const { criarActionResult, PRIORITY } = require('./MonitoringActionResult');

class MonitoringActionCenter {
  constructor(deps = {}) {
    this.registry = deps.registry || registrarCatalogoPadrao(new MonitoringActionRegistry());
    this.builder = deps.builder || new MonitoringActionBuilder(this.registry);
  }

  /**
   * @param {Object} intelligence — saída M3 (não mutada)
   * @param {Object} [contextInput] — usuário/perfil
   * @param {Object} [payload] — summary de providers (somente leitura em memória)
   */
  build(intelligence = {}, contextInput = {}, payload = {}) {
    const context = criarActionContext(contextInput);
    const rawActions = this.builder.buildFromIntelligence(intelligence);
    const actions = filtrarActionsPorPermissao(rawActions, context);

    const enrichedAlerts = (intelligence.alerts || []).map((a) => ({
      ...a,
      actions: filtrarActionsPorPermissao(this.builder.buildForSignal(a, 'alerta'), context)
    }));

    const enrichedInsights = (intelligence.insights || []).map((i) => ({
      ...i,
      actions: filtrarActionsPorPermissao(this.builder.buildForSignal(i, 'insight'), context)
    }));

    const enrichedRecs = (intelligence.recommendations || []).map((r) => ({
      ...r,
      actions: filtrarActionsPorPermissao(this.builder.buildForSignal(r, 'recomendacao'), context)
    }));

    const workQueue = this._buildWorkQueue(enrichedAlerts, payload);
    const timeline = this._buildTimeline(intelligence, payload);
    const topActions = actions.slice(0, 10);

    const result = criarActionResult({
      id: 'cop-action-center',
      title: 'Ações Recomendadas',
      description: 'Sugestões de navegação — nenhuma ação é executada automaticamente.',
      severity: this._severityFromHealth(intelligence.health?.geral),
      health: intelligence.health?.geral || null,
      trend: intelligence.trends?.global?.label || null,
      alerts: enrichedAlerts,
      recommendations: enrichedRecs,
      actions: topActions,
      workQueue,
      timeline,
      updatedAt: new Date().toISOString()
    });

    return {
      actionCenter: result,
      insights: enrichedInsights,
      alerts: enrichedAlerts,
      recommendations: enrichedRecs,
      recommendedActions: topActions,
      workQueue,
      timeline,
      meta: {
        iaReady: true,
        autoExecute: false,
        versao: 'M4',
        descricao: 'Action Center — navegação sugerida; pronto para assistentes/IA anexarem actions sem alterar Providers/Intelligence.'
      }
    };
  }

  /**
   * Enriquece COP (cópia) com painéis do Action Center — sem mutar Intelligence.
   */
  enrichCop(cop = {}, actionBundle = {}) {
    return {
      ...cop,
      recommendedActions: actionBundle.recommendedActions || [],
      workQueue: actionBundle.workQueue || [],
      timeline: actionBundle.timeline || [],
      actionCenter: actionBundle.actionCenter || null,
      meta: {
        ...(cop.meta || {}),
        ...(actionBundle.meta || {}),
        versao: 'M4'
      }
    };
  }

  _severityFromHealth(h) {
    if (h === 'CRITICO') return 'CRITICO';
    if (h === 'ATENCAO') return 'ATENCAO';
    if (h === 'EXCELENTE' || h === 'BOM') return 'SUCESSO';
    return 'INFO';
  }

  _buildWorkQueue(alerts, payload) {
    const items = [];
    const push = (id, titulo, dominio, severidade, meta = {}) => {
      items.push({
        id,
        titulo,
        dominio,
        severidade,
        prioridade: severidade === 'CRITICO' ? PRIORITY.CRITICO : (severidade === 'ATENCAO' ? PRIORITY.ALTA : PRIORITY.MEDIA),
        ...meta
      });
    };

    (alerts || []).forEach((a) => {
      push(a.id, a.titulo, a.dominio, a.severidade, { origem: 'alerta', actions: a.actions || [] });
    });

    // Itens estruturais derivados do payload em memória (sem SQL)
    const nfXml = alerts.find((a) => a.id === 'alert.central.nf_sem_xml');
    if (!nfXml && payload?.fiscal?.entradas) {
      /* noop — só se já houver alerta */
    }

    items.sort((a, b) => (a.prioridade || 9) - (b.prioridade || 9));
    return items.slice(0, 12);
  }

  /**
   * Timeline operacional sintética a partir de Intelligence (sem banco).
   * Eventos de ciclo DF-e / operação como narrativa ordenada.
   */
  _buildTimeline(intelligence, _payload) {
    const events = [];
    const ts = intelligence.updatedAt || new Date().toISOString();

    const add = (id, titulo, status, origem, dominio, hora) => {
      events.push({
        id,
        titulo,
        status,
        origem,
        dominio,
        horario: hora || ts
      });
    };

    add('tl.engine', 'Monitoring Engine atualizado', 'ok', 'MonitoringEngine', 'sistema', ts);

    (intelligence.alerts || []).slice(0, 6).forEach((a, idx) => {
      add(
        `tl.alert.${a.id}`,
        a.titulo,
        a.severidade === 'CRITICO' ? 'critico' : (a.severidade === 'SUCESSO' ? 'ok' : 'atencao'),
        'MonitoringAlertService',
        a.dominio || 'geral',
        a.timestamp || ts
      );
      // Espaçamento visual sintético
      void idx;
    });

    const hasCentral = (intelligence.alerts || []).some((a) => a.categoria === 'central' || a.id?.includes('central'));
    if (hasCentral) {
      add('tl.dfe.recebimento', 'Ciclo DF-e — documentos sob atenção', 'atencao', 'Central Inteligente', 'fiscal', ts);
      add('tl.dfe.manifestacao', 'Manifestação / Ciência (monitorada)', 'atencao', 'Central Inteligente', 'fiscal', ts);
      add('tl.dfe.xml', 'Download XML / PROC', 'atencao', 'Central Inteligente', 'fiscal', ts);
      add('tl.dfe.parser', 'Parser', 'ok', 'Parser', 'fiscal', ts);
      add('tl.dfe.miip', 'MIIP', 'ok', 'MIIP', 'fiscal', ts);
    }

    (intelligence.recommendations || []).slice(0, 3).forEach((r) => {
      add(`tl.rec.${r.id}`, `Recomendação: ${r.titulo}`, 'info', 'MonitoringRecommendationService', r.dominio || 'geral', r.timestamp || ts);
    });

    return events.slice(0, 20);
  }
}

const monitoringActionCenter = new MonitoringActionCenter();

module.exports = {
  MonitoringActionCenter,
  monitoringActionCenter
};
