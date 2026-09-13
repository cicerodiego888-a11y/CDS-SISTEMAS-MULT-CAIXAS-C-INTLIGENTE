'use strict';

const { ContextEngine } = require('./ContextEngine');
const ForecastEngine = require('./ForecastEngine');
const BusinessRuleEngine = require('./BusinessRuleEngine');
const RecommendationHub = require('./RecommendationHub');
const AutomationEngine = require('./AutomationEngine');
const { coletarSinais } = require('../adapters/MotorAdapters');

/**
 * Decision Engine — consolida motores e produz decisões CIP.
 */
class DecisionEngine {
  /**
   * @param {import('sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this.context = new ContextEngine();
    this.forecast = new ForecastEngine();
    this.rules = new BusinessRuleEngine();
    this.hub = new RecommendationHub();
    this.automation = new AutomationEngine(db);
    this._ultimo = null;
  }

  /**
   * Análise completa.
   * @param {{ origem?: string, automacao?: boolean, dryRun?: boolean }} [opcoes]
   */
  async analisar(opcoes = {}) {
    const contexto = this.context.resolve(opcoes.origem || 'erp');
    const sinais = await coletarSinais(this.db);
    const forecast = this.forecast.gerar(sinais);
    const regras = this.rules.avaliar(sinais);
    const recommendations = this.hub.consolidar({
      regras,
      forecast,
      mibKnowledge: sinais.mib?.knowledge || null,
      contexto
    });

    const insights = this._montarInsights(sinais, forecast, regras, recommendations);

    let automacoes = { executadas: 0, acoes: [] };
    if (opcoes.automacao !== false) {
      automacoes = await this.automation.executar(regras, { dryRun: Boolean(opcoes.dryRun) });
    }

    const resultado = {
      contexto,
      sinais: {
        motores: {
          MIB: sinais.mib?.ok,
          MIIP: sinais.miip?.ok,
          MUC: sinais.muc?.ok,
          Estoque: sinais.estoque?.ok,
          Financeiro: sinais.financeiro?.ok,
          Fiscal: sinais.fiscal?.ok
        },
        coletadoEm: sinais.coletadoEm
      },
      forecast,
      regrasDisparadas: regras.length,
      recommendations,
      insights,
      automacoes,
      analisadoEm: new Date().toISOString()
    };

    this._ultimo = resultado;
    return resultado;
  }

  _montarInsights(sinais, forecast, regras, recommendations) {
    const oportunidades = recommendations.filter((r) => r.tipo === 'oportunidade');
    const riscos = recommendations.filter((r) => r.tipo === 'risco' || r.severidade === 'alta');
    const anomalias = recommendations.filter((r) => r.tipo === 'anomalia');
    const previsoes = recommendations.filter((r) => r.tipo === 'previsao');

    return {
      oportunidades: oportunidades.slice(0, 10),
      riscos: riscos.slice(0, 10),
      anomalias: anomalias.slice(0, 10),
      previsoes: previsoes.slice(0, 10),
      resumo: {
        estoqueCritico: (sinais.estoque?.criticos || []).length,
        produtosZerados: sinais.estoque?.produtosZerados || 0,
        contasVencidas: sinais.financeiro?.contasVencidas || 0,
        tendenciaVendas: forecast.vendas?.tendencia || 'estavel',
        regras: regras.length,
        mibNos: sinais.mib?.knowledge?.graph?.nos || 0
      }
    };
  }

  ultimo() {
    return this._ultimo;
  }
}

module.exports = DecisionEngine;
