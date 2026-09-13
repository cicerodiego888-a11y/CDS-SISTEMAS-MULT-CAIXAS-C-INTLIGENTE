'use strict';

const { cipAnalyze, cipForecast, matchIntent } = require('../core/cipHelper');

const PATTERNS = {
  inadimplentes: [/inadimpl|vencid|atrasad|quem deve/i],
  fluxo: [/fluxo de caixa|fluxo|caixa previsto/i],
  receitas: [/receita/i],
  despesas: [/despesa|pagamento|conta.?pagar/i],
  saldo: [/saldo previsto|saldo|previs[aã]o financeira/i]
};

function createPlugin() {
  let ready = false;
  return {
    async load() { ready = true; return { ok: true }; },
    async unload() { ready = false; },
    async health() {
      return { ok: ready, motor: 'CIP', alteraLancamentos: false };
    },
    async ask({ mensagem } = {}, ctx = {}) {
      const intent = matchIntent(mensagem, PATTERNS);
      const full = await cipAnalyze(ctx.db, 'financial-copilot');
      const fin = full.sinais?.financeiro || {};
      const forecast = await cipForecast(ctx.db, 'financial-copilot');
      const fluxo = forecast.fluxoCaixa || full.forecast?.fluxoCaixa || {};

      if (intent === 'inadimplentes') {
        return {
          intent,
          resposta: `Inadimplência (CIP): ${fin.contasVencidas || 0} conta(s), valor R$ ${Number(fin.valorVencido || 0).toFixed(2)}. A vencer 7d: ${fin.contasAVencer7d || 0}.`,
          fonte: 'CIP',
          dados: {
            contasVencidas: fin.contasVencidas || 0,
            valorVencido: fin.valorVencido || 0,
            aVencer7d: fin.contasAVencer7d || 0
          }
        };
      }
      if (intent === 'fluxo' || intent === 'saldo') {
        return {
          intent,
          resposta: `Fluxo/saldo previsto (CIP): alerta=${fluxo.alerta || 'ok'}; tendência=${fluxo.tendencia || 'n/d'}.`,
          fonte: 'CIP',
          dados: { fluxo }
        };
      }
      if (intent === 'receitas') {
        return {
          intent,
          resposta: `Receitas a receber (CIP): vencido R$ ${Number(fin.valorVencido || 0).toFixed(2)}; a vencer 7d R$ ${Number(fin.valorAVencer7d || 0).toFixed(2)}. Sem alteração de lançamentos.`,
          fonte: 'CIP',
          dados: { valorVencido: fin.valorVencido, valorAVencer7d: fin.valorAVencer7d }
        };
      }
      if (intent === 'despesas') {
        return {
          intent,
          resposta: 'Despesas detalhadas permanecem no módulo Financeiro. CIP indica pressão de caixa quando aplicável — sem lançar ou estornar.',
          fonte: 'CIP',
          dados: { fluxo, pressao: fluxo.alerta === 'pressao_caixa' }
        };
      }
      return {
        intent: 'help',
        resposta: 'Copiloto Financeiro — "Inadimplentes", "Fluxo de caixa", "Receitas", "Despesas", "Saldo previsto". Nunca altera lançamentos.',
        fonte: 'CIP'
      };
    }
  };
}

module.exports = createPlugin;
