'use strict';

const TIPOS_OPERACIONAIS = Object.freeze({
  COMERCIAL: 'COMERCIAL',
  INSUMO: 'INSUMO'
});

function normalizarTipoOperacional(valor, fallback = TIPOS_OPERACIONAIS.COMERCIAL) {
  const raw = String(valor == null ? fallback : valor).trim().toUpperCase();
  if (raw === TIPOS_OPERACIONAIS.INSUMO) return TIPOS_OPERACIONAIS.INSUMO;
  if (raw === TIPOS_OPERACIONAIS.COMERCIAL || raw === 'PRODUTO' || raw === 'VENDA') {
    return TIPOS_OPERACIONAIS.COMERCIAL;
  }
  return fallback;
}

function isProdutoInsumo(produto) {
  return normalizarTipoOperacional(produto && produto.tipo_operacional) === TIPOS_OPERACIONAIS.INSUMO;
}

function validarProdutosParaVenda(produtos = []) {
  const itens = Array.isArray(produtos) ? produtos : [];
  const insumos = itens.filter((produto) => isProdutoInsumo(produto));
  if (!insumos.length) {
    return { ok: true, insumos: [] };
  }

  const nomes = insumos
    .map((produto) => (produto && produto.nome) ? String(produto.nome).trim() : 'Produto sem nome')
    .filter(Boolean);

  return {
    ok: false,
    insumos,
    error: `Insumos não podem ser vendidos no PDV: ${nomes.join(', ')}`
  };
}

module.exports = {
  TIPOS_OPERACIONAIS,
  normalizarTipoOperacional,
  isProdutoInsumo,
  validarProdutosParaVenda
};
