'use strict';

/**
 * Context Engine — prioriza objetivos conforme módulo operacional.
 */
const CONTEXTS = Object.freeze({
  pdv: {
    id: 'pdv',
    prioridade: 'velocidade',
    pesos: { estoque: 0.4, recomendacao: 0.3, risco: 0.1, fornecedor: 0.05, relacionamento: 0.15 }
  },
  compras: {
    id: 'compras',
    prioridade: 'fornecedores',
    pesos: { estoque: 0.35, recomendacao: 0.2, risco: 0.15, fornecedor: 0.25, relacionamento: 0.05 }
  },
  financeiro: {
    id: 'financeiro',
    prioridade: 'risco',
    pesos: { estoque: 0.1, recomendacao: 0.15, risco: 0.5, fornecedor: 0.1, relacionamento: 0.15 }
  },
  crm: {
    id: 'crm',
    prioridade: 'relacionamento',
    pesos: { estoque: 0.05, recomendacao: 0.25, risco: 0.2, fornecedor: 0.05, relacionamento: 0.45 }
  },
  vendas: {
    id: 'vendas',
    prioridade: 'oportunidade',
    pesos: { estoque: 0.25, recomendacao: 0.35, risco: 0.15, fornecedor: 0.05, relacionamento: 0.2 }
  },
  fiscal: {
    id: 'fiscal',
    prioridade: 'conformidade',
    pesos: { estoque: 0.1, recomendacao: 0.15, risco: 0.4, fornecedor: 0.1, relacionamento: 0.05 }
  },
  erp: {
    id: 'erp',
    prioridade: 'equilibrio',
    pesos: { estoque: 0.25, recomendacao: 0.25, risco: 0.25, fornecedor: 0.15, relacionamento: 0.1 }
  }
});

function resolverContexto(origem) {
  const o = String(origem || '').toLowerCase();
  if (o.includes('pdv')) return CONTEXTS.pdv;
  if (o.includes('compra')) return CONTEXTS.compras;
  if (o.includes('financ') || o.includes('caixa')) return CONTEXTS.financeiro;
  if (o.includes('crm') || o.includes('cliente')) return CONTEXTS.crm;
  if (o.includes('venda') || o.includes('exped')) return CONTEXTS.vendas;
  if (o.includes('fiscal') || o.includes('nfe')) return CONTEXTS.fiscal;
  return CONTEXTS.erp;
}

class ContextEngine {
  resolve(origem) {
    return resolverContexto(origem);
  }

  listar() {
    return Object.values(CONTEXTS);
  }
}

module.exports = { ContextEngine, resolverContexto, CONTEXTS };
