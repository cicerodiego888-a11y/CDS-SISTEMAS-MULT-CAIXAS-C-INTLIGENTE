'use strict';

const IntentEngine = require('./IntentEngine');
const INTENTS = IntentEngine.INTENTS;

/**
 * Planner — gera plano de execução antes de chamar tools.
 */
class Planner {
  /**
   * @param {object} classificacao — saída IntentEngine
   * @param {object} [memoria]
   */
  planejar(classificacao, memoria = {}) {
    const intent = classificacao.intent;
    const ent = { ...(memoria.ultimasEntidades || {}), ...(classificacao.entidades || {}) };

    // referência anafórica: "os cinco primeiros"
    if (memoria.ultimaLista?.length && /primeiro|estes|esses|lista/i.test(JSON.stringify(ent))) {
      ent.refs = memoria.ultimaLista.slice(0, ent.limite || 5);
    }

    const planos = {
      [INTENTS.STOCK_OUT]: [
        { tool: 'cip.insights', args: { origem: 'cia' }, porque: 'Obter estoque crítico/zerados via CIP' }
      ],
      [INTENTS.INADIMPLENTES]: [
        { tool: 'cip.insights', args: { origem: 'financeiro' }, porque: 'Riscos financeiros via CIP' },
        { tool: 'cip.recommend', args: { origem: 'financeiro' }, porque: 'Recomendações financeiras' }
      ],
      [INTENTS.FORECAST]: [
        { tool: 'cip.forecast', args: { origem: 'cia' }, porque: 'Previsões CIP' }
      ],
      [INTENTS.INSIGHTS]: [
        { tool: 'cip.analyze', args: { origem: 'cia' }, porque: 'Análise consolidada CIP' }
      ],
      [INTENTS.RECOMMEND]: [
        { tool: 'mib.search', args: { entity: 'produto', query: ent.query || '', limite: 3 }, porque: 'Localizar produto base (MIB)' },
        { tool: 'mib.recommend', args: { query: ent.query || '', limite: 5 }, porque: 'Recomendações Knowledge Graph' },
        { tool: 'cip.recommend', args: { origem: 'cia' }, porque: 'Complementar com CIP' }
      ],
      [INTENTS.IDENTIFY_PRODUCT]: [
        { tool: 'miip.identify', args: { gtin: ent.gtin, query: ent.query, nome: ent.query }, porque: 'Identificar via MIIP' },
        { tool: 'miip.enrich', args: { gtin: ent.gtin, query: ent.query, nome: ent.query }, porque: 'Enriquecer via MIB Knowledge' }
      ],
      [INTENTS.REGISTER_PRODUCT]: [
        { tool: 'miip.identify', args: { gtin: ent.gtin, nome: ent.query }, porque: 'Consultar MIIP' },
        { tool: 'miip.enrich', args: { gtin: ent.gtin, nome: ent.query }, porque: 'Consultar MIB Knowledge' },
        { tool: 'cip.recommend', args: {}, porque: 'Consultar CIP' },
        {
          tool: 'action.prepare_critical',
          args: {
            acao: 'register_product',
            resumo: `Preparar cadastro de produto${ent.gtin ? ` GTIN ${ent.gtin}` : ''}`
          },
          porque: 'Cadastro exige confirmação'
        }
      ],
      [INTENTS.SEARCH_PRODUCT]: [
        {
          tool: 'mib.search',
          args: { entity: 'produto', query: ent.query || '', limite: ent.limite || 10 },
          porque: 'Busca produtos via MIB SearchService'
        }
      ],
      [INTENTS.SEARCH_CLIENT]: [
        {
          tool: 'mib.search',
          args: { entity: 'cliente', query: ent.query || '', limite: ent.limite || 10 },
          porque: 'Busca clientes via MIB SearchService'
        }
      ],
      [INTENTS.CLOSE_CAIXA]: [
        {
          tool: 'action.prepare_critical',
          args: { acao: 'close_caixa', resumo: 'Fechar caixa do operador' },
          porque: 'Fechamento de caixa é ação crítica'
        }
      ],
      [INTENTS.GENERATE_ORDER]: [
        { tool: 'cip.insights', args: { origem: 'compras' }, porque: 'Sugestões de compra via CIP' },
        {
          tool: 'action.prepare_critical',
          args: { acao: 'generate_order', resumo: 'Gerar pedido de compra' },
          porque: 'Pedido exige confirmação'
        }
      ],
      [INTENTS.EMIT_NFE]: [
        {
          tool: 'action.prepare_critical',
          args: { acao: 'emit_nfe', resumo: 'Emitir NF-e' },
          porque: 'Emissão fiscal é crítica'
        }
      ],
      [INTENTS.DELETE_PRODUCT]: [
        {
          tool: 'action.prepare_critical',
          args: { acao: 'delete_product', resumo: 'Excluir produto' },
          porque: 'Exclusão exige confirmação'
        }
      ],
      [INTENTS.DELETE_CLIENT]: [
        {
          tool: 'action.prepare_critical',
          args: { acao: 'delete_client', resumo: 'Excluir cliente' },
          porque: 'Exclusão exige confirmação'
        }
      ],
      [INTENTS.CANCEL_NFE]: [
        {
          tool: 'action.prepare_critical',
          args: { acao: 'cancel_nfe', resumo: 'Cancelar NF-e' },
          porque: 'Cancelamento fiscal é crítico'
        }
      ],
      [INTENTS.HELP]: [],
      [INTENTS.UNKNOWN]: [
        { tool: 'mib.search', args: { entity: 'produto', query: ent.query || '', limite: 5 }, porque: 'Tentativa de busca genérica' }
      ]
    };

    const steps = planos[intent] || planos[INTENTS.UNKNOWN];
    return {
      intent,
      critica: Boolean(classificacao.critica),
      permissao: classificacao.permissao,
      entidades: ent,
      steps,
      requerConfirmacao: Boolean(classificacao.critica) || steps.some((s) => s.tool === 'action.prepare_critical')
    };
  }
}

module.exports = Planner;
