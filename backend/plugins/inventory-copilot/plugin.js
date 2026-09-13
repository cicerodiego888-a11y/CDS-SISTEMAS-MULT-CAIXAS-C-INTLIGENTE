'use strict';

const { cipAnalyze, cipRecommend, matchIntent } = require('../core/cipHelper');

const PATTERNS = {
  ruptura: [/ruptura|sem estoque|zerad|estoque zero|produtos em ruptura/i],
  parados: [/parado|sem giro|encalh|produtos parados/i],
  sugestao_compra: [/sugest[aã]o de compra|comprar|reposi[cç][aã]o|pedido de compra/i],
  vencendo: [/vencendo|validade|vencimento|a vencer/i]
};

function createPlugin() {
  let ready = false;
  return {
    async load() { ready = true; return { ok: true }; },
    async unload() { ready = false; },
    async health() { return { ok: ready, motor: 'CIP', consultas: true }; },
    async ask({ mensagem } = {}, ctx = {}) {
      const intent = matchIntent(mensagem, PATTERNS);
      const full = await cipAnalyze(ctx.db, 'inventory-copilot');
      const estoque = full.sinais?.estoque || {};
      const forecast = full.forecast || {};
      const recs = (await cipRecommend(ctx.db, 'inventory-copilot')).items || full.recommendations || [];

      if (intent === 'ruptura') {
        const criticos = estoque.criticos || [];
        return {
          intent,
          resposta: `Produtos em ruptura/críticos (CIP): ${criticos.length}. Zerados: ${estoque.produtosZerados || 0}.`,
          fonte: 'CIP',
          dados: { criticos: criticos.slice(0, 20), zerados: estoque.produtosZerados || 0 }
        };
      }
      if (intent === 'parados') {
        const parados = recs.filter((r) => /parado|giro|estoque/i.test(String(r.titulo || r.tipo || ''))).slice(0, 15);
        return {
          intent,
          resposta: `Alertas de produtos parados via CIP: ${parados.length}.`,
          fonte: 'CIP',
          dados: { itens: parados }
        };
      }
      if (intent === 'sugestao_compra') {
        const compra = [
          ...(forecast.estoque || []).slice(0, 10),
          ...recs.filter((r) => /compra|reposi|estoque/i.test(String(r.titulo || r.tipo || ''))).slice(0, 10)
        ];
        return {
          intent,
          resposta: `Sugestões de reposição (CIP, somente consulta): ${compra.length} sinal(is).`,
          fonte: 'CIP',
          dados: { sugestoes: compra }
        };
      }
      if (intent === 'vencendo') {
        return {
          intent,
          resposta: 'Validade/vencimento não é consolidado pelo CIP neste ciclo. Use o módulo de Estoque/Lotes para produtos vencendo. CIP segue monitorando ruptura e reposição.',
          fonte: 'CIP',
          dados: { suporte: 'parcial', alternativa: 'modulo_estoque' }
        };
      }
      return {
        intent: 'help',
        resposta: 'Copiloto Estoque — "Produtos em ruptura", "Produtos parados", "Sugestão de compra", "Produtos vencendo".',
        fonte: 'CIP'
      };
    }
  };
}

module.exports = createPlugin;
