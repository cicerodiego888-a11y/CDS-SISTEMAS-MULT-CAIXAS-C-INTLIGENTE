'use strict';

/**
 * Search Context — prioriza entidade conforme módulo de origem.
 * Não altera o hot-path do SearchService: apenas enriquece a requisição.
 */
const CONTEXTO_PRIORIDADE = Object.freeze({
  pdv: ['produto'],
  vendas: ['produto', 'cliente'],
  compras: ['fornecedor', 'produto'],
  expedicao: ['produto'],
  faturamento: ['produto', 'cliente'],
  financeiro: ['financeiro', 'cliente'],
  fiscal: ['fiscal', 'produto'],
  miip: ['produto', 'marca', 'categoria'],
  cadastro: ['produto', 'categoria', 'marca'],
  erp: ['produto', 'cliente', 'fornecedor']
});

function resolverOrigem(origem) {
  const o = String(origem || '').toLowerCase();
  if (o.includes('pdv')) return 'pdv';
  if (o.includes('compra')) return 'compras';
  if (o.includes('exped') || o.includes('fatur')) return 'expedicao';
  if (o.includes('financ')) return 'financeiro';
  if (o.includes('fiscal') || o.includes('nfe')) return 'fiscal';
  if (o.includes('miip')) return 'miip';
  if (o.includes('venda')) return 'vendas';
  if (o.includes('cadastro') || o.includes('produto')) return 'cadastro';
  return 'erp';
}

/**
 * @param {{ entity?: string, origem?: string, query?: string }} req
 * @returns {{ entity: string, entidades: string[], contexto: string, boost?: object }}
 */
function aplicarContexto(req = {}) {
  const contexto = resolverOrigem(req.origem);
  const prioridade = CONTEXTO_PRIORIDADE[contexto] || CONTEXTO_PRIORIDADE.erp;
  let entity = String(req.entity || '').toLowerCase().trim();

  // se entity genérica/ausente, usa prioridade do contexto
  if (!entity || entity === 'auto' || entity === 'global') {
    entity = prioridade[0];
  }

  // compras: se pediu produto mas query parece CNPJ, prioriza fornecedor
  const q = String(req.query || '');
  const digitos = q.replace(/\D/g, '');
  if (contexto === 'compras' && digitos.length >= 11 && (!req.entity || req.entity === 'auto')) {
    entity = 'fornecedor';
  }

  return {
    entity,
    entidades: prioridade,
    contexto,
    boost: {
      priorizarFornecedor: contexto === 'compras',
      priorizarProduto: contexto === 'pdv' || contexto === 'expedicao',
      priorizarCliente: contexto === 'vendas' || contexto === 'financeiro'
    }
  };
}

module.exports = { aplicarContexto, resolverOrigem, CONTEXTO_PRIORIDADE };
