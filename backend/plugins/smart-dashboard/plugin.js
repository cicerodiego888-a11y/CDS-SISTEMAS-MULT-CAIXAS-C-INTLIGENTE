'use strict';

/**
 * CDS Smart Dashboard RC1.0 — plugin oficial.
 * Sem SQL; consome CIA → CIP → MIB → MIIP.
 */

const {
  SMART_DASHBOARD_VERSION,
  SMART_DASHBOARD_CODIGO,
  SMART_DASHBOARD_STATUS
} = require('./version');
const {
  DEFAULT_LAYOUT,
  montarSituacao,
  montarAlertas,
  montarOportunidades,
  montarPrevisoes,
  montarAcoes,
  montarOperacional,
  montarInsights,
  montarExecutivo
} = require('./cards');
const { cipAnalyze } = require('../core/cipHelper');

/** @type {Map<string, object>} layouts por usuário (memória — sem schema) */
const layouts = new Map();

function layoutKey(user) {
  return String(user?.id || user?.usuario_id || 'anon');
}

function createPlugin() {
  let ready = false;
  let manager = null;

  async function mibPulse(db) {
    try {
      const { obterSearchService } = require('../../motores/mib');
      const svc = obterSearchService(db);
      if (!svc._pronto && typeof svc.iniciar === 'function') await svc.iniciar();
      const st = typeof svc.statistics === 'function' ? svc.statistics() : {};
      return { ok: true, motor: 'MIB', tempoMedio: st.tempoMedio, providers: st.providersAtivos };
    } catch (err) {
      return { ok: false, motor: 'MIB', erro: err.message };
    }
  }

  async function miipPulse() {
    try {
      const { getMiipService } = require('../../motores/miip/getMiipService');
      const miip = getMiipService();
      const habilitado = typeof miip.estaHabilitado === 'function' ? miip.estaHabilitado() : null;
      return { ok: true, habilitado };
    } catch (err) {
      return { ok: false, erro: err.message };
    }
  }

  async function ciaPulse(db) {
    try {
      const { obterCia } = require('../../motores/cia');
      return obterCia(db).status();
    } catch (err) {
      return { ok: false, erro: err.message };
    }
  }

  return {
    async load(ctx = {}) {
      manager = ctx.manager || null;
      ready = true;
      return { ok: true, codigo: SMART_DASHBOARD_CODIGO };
    },

    async unload() {
      ready = false;
      manager = null;
    },

    async health() {
      return {
        ok: ready,
        codigo: SMART_DASHBOARD_CODIGO,
        versao: SMART_DASHBOARD_VERSION,
        status: SMART_DASHBOARD_STATUS,
        sqlDireto: false,
        motores: ['CIA', 'CIP', 'MIB', 'MIIP']
      };
    },

    /**
     * Painel completo (cards 1–8 + layout).
     */
    async dashboard(args = {}, ctx = {}) {
      const db = ctx.db;
      const user = ctx.user || {};
      const full = await cipAnalyze(db, 'smart-dashboard');
      const [mib, miip, cia] = await Promise.all([
        mibPulse(db),
        miipPulse(),
        ciaPulse(db)
      ]);

      let pluginsDash = { plugins: [], logs: { erros: 0 }, codigo: null };
      try {
        if (manager) pluginsDash = manager.dashboard();
      } catch (_) { /* ignore */ }

      // enriquece sinal MIB no pacote (somente leitura de motor)
      if (full.sinais) {
        full.sinais.mib = { ...(full.sinais.mib || {}), pulse: mib, ok: mib.ok };
      }

      const layout = this._getLayout(user);
      const cards = {
        situacao: montarSituacao(full),
        alertas: montarAlertas(full),
        oportunidades: montarOportunidades(full),
        ia: {
          id: 'ia',
          titulo: 'IA Responde',
          placeholder: 'Pergunte ao CDS',
          exemplos: ['Como estão minhas vendas?', 'Produtos sem estoque', 'Quem está inadimplente?'],
          motor: 'CIA'
        },
        previsoes: montarPrevisoes(full),
        acoes: montarAcoes(user),
        operacional: montarOperacional(full, pluginsDash, cia, miip),
        insights: montarInsights(full)
      };

      const ordered = layout.order
        .filter((id) => !layout.hidden.includes(id))
        .map((id) => cards[id])
        .filter(Boolean);

      return {
        codigo: SMART_DASHBOARD_CODIGO,
        versao: SMART_DASHBOARD_VERSION,
        geradoEm: new Date().toISOString(),
        fontes: ['CIP', 'CIA', 'MIB', 'MIIP'],
        layout,
        cards,
        ordered,
        mib,
        miip,
        cia
      };
    },

    /**
     * Card 10 — visão executiva.
     */
    async executive(_args = {}, ctx = {}) {
      const full = await cipAnalyze(ctx.db, 'smart-dashboard-exec');
      return {
        codigo: SMART_DASHBOARD_CODIGO,
        modo: 'executivo',
        ...montarExecutivo(full),
        geradoEm: new Date().toISOString()
      };
    },

    /**
     * Card 4 — pergunta ao CIA.
     */
    async ask(args = {}, ctx = {}) {
      const { obterCia } = require('../../motores/cia');
      const cia = obterCia(ctx.db);
      const result = await cia.chat({
        mensagem: args.mensagem || args.message || args.text || 'Como estão minhas vendas?',
        origem: args.origem || 'smart-dashboard',
        sessao_id: args.sessao_id || `sd-${layoutKey(ctx.user)}`
      }, ctx.user || {});
      return {
        motor: 'CIA',
        ...result
      };
    },

    /**
     * Card 9 — personalização (memória por usuário).
     */
    async layout(args = {}, ctx = {}) {
      const user = ctx.user || {};
      const key = layoutKey(user);
      if (args.reset) {
        layouts.delete(key);
        return { ok: true, layout: { ...DEFAULT_LAYOUT } };
      }
      if (args.layout && typeof args.layout === 'object') {
        const atual = this._getLayout(user);
        const next = {
          order: Array.isArray(args.layout.order) ? args.layout.order : atual.order,
          hidden: Array.isArray(args.layout.hidden) ? args.layout.hidden : atual.hidden,
          pinned: Array.isArray(args.layout.pinned) ? args.layout.pinned : atual.pinned,
          modo: args.layout.modo === 'executivo' ? 'executivo' : (args.layout.modo || atual.modo)
        };
        layouts.set(key, next);
        return { ok: true, salvo: true, layout: next };
      }
      return { ok: true, layout: this._getLayout(user) };
    },

    _getLayout(user) {
      const key = layoutKey(user);
      const saved = layouts.get(key);
      if (!saved) return { ...DEFAULT_LAYOUT, order: [...DEFAULT_LAYOUT.order], hidden: [], pinned: [...DEFAULT_LAYOUT.pinned] };
      return {
        order: [...(saved.order || DEFAULT_LAYOUT.order)],
        hidden: [...(saved.hidden || [])],
        pinned: [...(saved.pinned || [])],
        modo: saved.modo || 'padrao'
      };
    }
  };
}

module.exports = createPlugin;
module.exports._layoutsForTest = layouts;
module.exports.DEFAULT_LAYOUT = DEFAULT_LAYOUT;
