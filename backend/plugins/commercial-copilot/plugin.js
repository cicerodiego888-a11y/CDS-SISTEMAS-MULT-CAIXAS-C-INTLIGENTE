'use strict';

const { cipAnalyze, cipRecommend, matchIntent } = require('../core/cipHelper');

const PATTERNS = {
  top_vendedor: [/vendedor.*(mais|top)|quem vendeu mais|melhor vendedor/i],
  top_cliente: [/cliente.*(mais|compra)|quem mais compra|melhor cliente/i],
  produto_queda: [/produto.*(caiu|queda)|caiu nas vendas|queda de venda/i],
  sem_giro: [/sem giro|parado.*venda|produtos? sem giro|sem rotatividade/i]
};

function createPlugin() {
  let ready = false;

  return {
    async load() {
      ready = true;
      return { ok: true };
    },
    async unload() {
      ready = false;
    },
    async health() {
      return { ok: ready, motor: 'CIP', modo: 'somente_leitura' };
    },
    async ask({ mensagem } = {}, ctx = {}) {
      const intent = matchIntent(mensagem, PATTERNS);
      const full = await cipAnalyze(ctx.db, 'commercial-copilot');
      const sinais = full.sinais || {};
      const recs = full.recommendations || [];
      const vendas = sinais.vendas || {};
      const forecast = full.forecast || {};

      if (intent === 'top_vendedor') {
        return {
          intent,
          resposta: 'O CIP não expõe ranking de vendedores neste nível. Use o módulo de Relatórios/Vendas para o detalhe por operador. Tendência de vendas CIP: '
            + (forecast.vendas?.tendencia || 'indisponível') + '.',
          fonte: 'CIP',
          dados: { tendencia: forecast.vendas?.tendencia || null, serie30d: (vendas.serie30d || []).slice(-7) }
        };
      }
      if (intent === 'top_cliente') {
        const oport = recs.filter((r) => /cliente|crm|oportunidade/i.test(JSON.stringify(r))).slice(0, 5);
        return {
          intent,
          resposta: oport.length
            ? `Oportunidades CIP relacionadas a clientes (${oport.length}). Detalhe de "cliente que mais compra" permanece no CRM/Relatórios.`
            : 'Sem ranking de clientes no CIP. Consulte CRM/Relatórios para o cliente com maior volume.',
          fonte: 'CIP',
          dados: { recomendacoes: oport }
        };
      }
      if (intent === 'produto_queda') {
        const queda = (forecast.estoque || []).filter((e) => e.alerta || e.risco).slice(0, 10);
        const itens = recs.filter((r) => /queda|venda|produto/i.test(String(r.titulo || r.tipo || ''))).slice(0, 8);
        return {
          intent,
          resposta: itens.length || queda.length
            ? `Sinais CIP de pressão comercial/estoque: ${itens.length + queda.length} item(ns).`
            : 'CIP não detectou queda explícita de produtos neste ciclo.',
          fonte: 'CIP',
          dados: { recomendacoes: itens, estoque: queda }
        };
      }
      if (intent === 'sem_giro') {
        const criticos = (sinais.estoque?.criticos || []).slice(0, 15);
        const semGiro = recs.filter((r) => /giro|parado|estoque/i.test(String(r.titulo || r.tipo || r.id || ''))).slice(0, 10);
        return {
          intent,
          resposta: `Produtos com alerta de giro/estoque via CIP: ${Math.max(criticos.length, semGiro.length)}.`,
          fonte: 'CIP',
          dados: { criticos, recomendacoes: semGiro }
        };
      }
      return {
        intent: 'help',
        resposta: 'Copiloto Comercial — pergunte: "Qual vendedor vendeu mais?", "Qual cliente mais compra?", "Qual produto caiu nas vendas?", "Quais produtos estão sem giro?"',
        fonte: 'CIP'
      };
    }
  };
}

module.exports = createPlugin;
