'use strict';

/**
 * Business Monitor RC1.0 — monitor contínuo (plugin oficial).
 * Sem SQL; consome CIP/CIA/MIB/MIIP.
 */

const {
  BUSINESS_MONITOR_VERSION,
  BUSINESS_MONITOR_CODIGO,
  BUSINESS_MONITOR_STATUS
} = require('./version');
const { EventStore } = require('./EventStore');
const { detectarTudo } = require('./detectors');
const { cipAnalyze } = require('../core/cipHelper');

const store = new EventStore(800);
let lastAnalyzeAt = null;

function createPlugin() {
  let ready = false;
  let timer = null;

  return {
    async load() {
      ready = true;
      // ciclo leve em background (não derruba processo)
      if (!timer) {
        timer = setInterval(() => {
          /* tick passivo — analyze sob demanda / API */
        }, 60000);
        if (typeof timer.unref === 'function') timer.unref();
      }
      return { ok: true, codigo: BUSINESS_MONITOR_CODIGO };
    },

    async unload() {
      ready = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    async health() {
      return {
        ok: ready,
        codigo: BUSINESS_MONITOR_CODIGO,
        versao: BUSINESS_MONITOR_VERSION,
        status: BUSINESS_MONITOR_STATUS,
        sqlDireto: false,
        lastAnalyzeAt,
        stats: store.stats()
      };
    },

    /**
     * Varredura completa — gera eventos.
     */
    async analyze(args = {}, ctx = {}) {
      const full = await cipAnalyze(ctx.db, 'business-monitor');
      const detected = detectarTudo(full);
      const criados = [];
      for (const d of detected) {
        criados.push(store.push({
          ...d,
          origem: 'business-monitor'
        }));
      }
      lastAnalyzeAt = new Date().toISOString();

      // pulse MIB/MIIP (status, sem SQL de negócio)
      let mib = null;
      let miip = null;
      try {
        const { obterSearchService } = require('../../motores/mib');
        const svc = obterSearchService(ctx.db);
        if (!svc._pronto && typeof svc.iniciar === 'function') await svc.iniciar();
        mib = { ok: true, stats: typeof svc.statistics === 'function' ? svc.statistics() : {} };
      } catch (err) {
        mib = { ok: false, erro: err.message };
      }
      try {
        const { getMiipService } = require('../../motores/miip/getMiipService');
        const s = getMiipService();
        miip = { ok: true, habilitado: typeof s.estaHabilitado === 'function' ? s.estaHabilitado() : null };
      } catch (err) {
        miip = { ok: false, erro: err.message };
      }

      return {
        codigo: BUSINESS_MONITOR_CODIGO,
        analisadoEm: lastAnalyzeAt,
        detectados: detected.length,
        eventos: criados,
        stats: store.stats(),
        motores: { cip: true, mib, miip, cia: true },
        force: Boolean(args.force)
      };
    },

    async events(args = {}) {
      return {
        items: store.list({
          status: args.status,
          prioridade: args.prioridade,
          monitor: args.monitor,
          limite: args.limite
        }),
        stats: store.stats()
      };
    },

    async alerts(args = {}) {
      return {
        items: store.list({
          apenasAlertas: true,
          status: args.status || 'aberto',
          limite: args.limite || 50
        }),
        stats: store.stats()
      };
    },

    async opportunities(args = {}) {
      return {
        items: store.list({
          apenasOportunidades: true,
          status: args.status || 'aberto',
          limite: args.limite || 50
        }),
        stats: store.stats()
      };
    },

    /**
     * Ações: ignorar | resolver | tarefa | abrir | cia
     */
    async resolve(args = {}, ctx = {}) {
      const id = args.id || args.event_id;
      const acao = String(args.acao || 'resolver').toLowerCase();
      if (!id) return { ok: false, error: 'id obrigatório' };

      if (acao === 'cia' || acao === 'analise_cia') {
        const ev = store.get(id);
        if (!ev) return { ok: false, error: 'evento não encontrado' };
        const { obterCia } = require('../../motores/cia');
        const pergunta = args.mensagem
          || `Analise este alerta do Business Monitor: ${ev.mensagem}. Impacto: ${ev.impacto}. Sugestão atual: ${ev.sugestao}`;
        const chat = await obterCia(ctx.db).chat({
          mensagem: pergunta,
          origem: 'business-monitor',
          sessao_id: `bm-${ctx.user?.id || 'anon'}`
        }, ctx.user || {});
        store.resolve(id, 'tarefa', 'Análise CIA solicitada');
        return { ok: true, acao: 'cia', evento: store.get(id), cia: chat };
      }

      const ev = store.resolve(id, acao, args.nota);
      if (!ev) return { ok: false, error: 'evento não encontrado' };
      return {
        ok: true,
        acao,
        evento: ev,
        abrir: acao === 'abrir' ? { modulo: ev.modulo } : null
      };
    },

    async ask(args = {}, ctx = {}) {
      const { obterCia } = require('../../motores/cia');
      return obterCia(ctx.db).chat({
        mensagem: args.mensagem || 'Quais riscos o negócio tem agora?',
        origem: 'business-monitor'
      }, ctx.user || {});
    },

    /**
     * Payload do dashboard (timeline, mapas, histórico).
     */
    async dashboard(args = {}, ctx = {}) {
      if (args.refresh !== false) {
        await this.analyze({ force: true }, ctx);
      }
      const abertos = store.list({ status: 'aberto', limite: 200 });
      const historico = store.list({ limite: 100 });
      const riscos = abertos.filter((e) => e.prioridade === 'CRITICO' || e.prioridade === 'ALTO');
      const oportunidades = abertos.filter((e) => e.tipo === 'oportunidade');
      const timeline = historico.slice(0, 40);
      const mapaRiscos = agrupar(riscos, 'monitor');
      const mapaOportunidades = agrupar(oportunidades, 'monitor');

      return {
        codigo: BUSINESS_MONITOR_CODIGO,
        versao: BUSINESS_MONITOR_VERSION,
        geradoEm: new Date().toISOString(),
        stats: store.stats(),
        lastAnalyzeAt,
        timeline,
        mapaRiscos,
        mapaOportunidades,
        eventos: abertos,
        alertas: riscos,
        oportunidades,
        historico
      };
    }
  };
}

function agrupar(items, key) {
  const map = {};
  for (const i of items) {
    const k = i[key] || 'geral';
    if (!map[k]) map[k] = [];
    map[k].push(i);
  }
  return Object.entries(map).map(([k, v]) => ({ chave: k, qtd: v.length, items: v }));
}

module.exports = createPlugin;
module.exports._storeForTest = store;
