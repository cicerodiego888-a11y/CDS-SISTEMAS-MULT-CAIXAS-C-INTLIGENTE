'use strict';

const DecisionEngine = require('./core/DecisionEngine');
const { ContextEngine } = require('./core/ContextEngine');
const { CIP_VERSION, CIP_STATUS, CIP_CODIGO } = require('./version');

/** @type {CipService|null} */
let singleton = null;

/**
 * CIP — CDS Intelligence Platform (facade).
 * Interpreta sinais dos motores; não substitui MIB/MIIP/MUC.
 */
class CipService {
  /**
   * @param {import('sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this.decision = new DecisionEngine(db);
    this.context = new ContextEngine();
    this._cacheInsights = null;
    this._cacheAt = 0;
  }

  static getInstance(db) {
    if (!singleton) singleton = new CipService(db);
    else if (db && singleton.db !== db) singleton = new CipService(db);
    return singleton;
  }

  static resetInstance() {
    singleton = null;
  }

  info() {
    return {
      versao: CIP_VERSION,
      status: CIP_STATUS,
      codigo: CIP_CODIGO,
      papeis: {
        MIB: 'busca + conhecimento',
        MIIP: 'identificação de produtos',
        MUC: 'conversão de unidades',
        CIP: 'inteligência / decisão / previsão / automação'
      }
    };
  }

  async analyze(opcoes = {}) {
    const result = await this.decision.analisar(opcoes);
    this._cacheInsights = result;
    this._cacheAt = Date.now();
    return result;
  }

  async rebuild(opcoes = {}) {
    // rebuild = reanalisar + limpar cache; opcionalmente dispara rebuild do grafo MIB
    if (opcoes.mibGraph) {
      try {
        const { obterKnowledge } = require('../mib');
        await obterKnowledge(this.db).rebuild({ leve: Boolean(opcoes.leve) });
      } catch (_) { /* MIB opcional */ }
    }
    return this.analyze({ ...opcoes, automacao: opcoes.automacao !== false });
  }

  async insights(opcoes = {}) {
    const maxAge = Number(opcoes.maxAgeMs) || 60000;
    if (this._cacheInsights && Date.now() - this._cacheAt < maxAge && !opcoes.force) {
      return {
        ...this._cacheInsights.insights,
        contexto: this._cacheInsights.contexto,
        forecastResumo: {
          tendenciaVendas: this._cacheInsights.forecast?.vendas?.tendencia,
          fluxo: this._cacheInsights.forecast?.fluxoCaixa
        },
        cached: true,
        analisadoEm: this._cacheInsights.analisadoEm
      };
    }
    const full = await this.analyze({ origem: opcoes.origem, dryRun: true, automacao: false });
    return {
      ...full.insights,
      contexto: full.contexto,
      forecastResumo: {
        tendenciaVendas: full.forecast?.vendas?.tendencia,
        fluxo: full.forecast?.fluxoCaixa
      },
      cached: false,
      analisadoEm: full.analisadoEm
    };
  }

  async recommendations(opcoes = {}) {
    const full = this.decision.ultimo() || await this.analyze({
      origem: opcoes.origem,
      dryRun: true,
      automacao: false
    });
    return {
      contexto: full.contexto,
      items: full.recommendations || [],
      analisadoEm: full.analisadoEm
    };
  }

  async forecast(opcoes = {}) {
    const full = this.decision.ultimo() || await this.analyze({
      origem: opcoes.origem,
      dryRun: true,
      automacao: false
    });
    return {
      ...full.forecast,
      analisadoEm: full.analisadoEm
    };
  }

  contextos() {
    return this.context.listar();
  }

  async automacoes(limite) {
    return this.decision.automation.listar(limite);
  }
}

module.exports = CipService;
