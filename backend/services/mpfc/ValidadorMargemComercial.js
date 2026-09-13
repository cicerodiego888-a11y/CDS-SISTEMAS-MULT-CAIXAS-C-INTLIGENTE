/**
 * RC8.2 — Validador de margem mínima (domínio comercial exclusivo).
 * Motor F×NF NÃO deve chamar este módulo.
 */
'use strict';

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Preço mínimo de venda = custo × (1 + margem%/100).
 * @param {number} custo
 * @param {number} margemPercentual
 */
function precoMinimoPelaMargem(custo, margemPercentual) {
  const c = Number(custo || 0);
  const m = Number(margemPercentual || 0);
  if (!(c > 0)) return 0;
  return round2(c * (1 + m / 100));
}

/**
 * Valida itens da venda contra PoliticaFiscalComercialV1.
 * Comportamento existente: o CDS não bloqueava margem no PDV.
 * Por isso, se nuncaVenderAbaixoDaMargem === false → no-op (sucesso).
 * Se true → bloqueia itens abaixo do mínimo (regra explícita da política).
 *
 * @param {Array} itens — { produto_id, preco_unitario, quantidade, ... }
 * @param {object} produtosPorId — mapa id → produto (preco_compra)
 * @param {object} politica — PoliticaFiscalComercialV1
 * @returns {{ sucesso: boolean, error?: string, itensViolados?: Array }}
 */
function validarMargemMinimaComercial(itens = [], produtosPorId = {}, politica = {}) {
  if (!politica || !politica.nuncaVenderAbaixoDaMargem) {
    return {
      sucesso: true,
      aplicada: false,
      motivo: 'Politica.nuncaVenderAbaixoDaMargem=false (compatibilidade)'
    };
  }

  const margem = Number(politica.margemMinimaSobreOCusto || 0);
  const violados = [];

  for (const item of (Array.isArray(itens) ? itens : [])) {
    const produtoId = item.produto_id || item.produtoId;
    const produto = produtosPorId[produtoId] || {};
    const custo = Number(
      produto.preco_compra != null
        ? produto.preco_compra
        : (item.preco_compra != null ? item.preco_compra : 0)
    );
    if (!(custo > 0)) continue;

    const precoUnit = Number(item.preco_unitario != null ? item.preco_unitario : item.preco || 0);
    const minimo = precoMinimoPelaMargem(custo, margem);
    if (precoUnit + 0.009 < minimo) {
      violados.push({
        produto_id: produtoId,
        nome: produto.nome || item.nome || String(produtoId),
        preco_unitario: precoUnit,
        preco_compra: custo,
        preco_minimo: minimo,
        margem_minima: margem
      });
    }
  }

  if (violados.length === 0) {
    return { sucesso: true, aplicada: true, itensViolados: [] };
  }

  const primeiro = violados[0];
  return {
    sucesso: false,
    aplicada: true,
    itensViolados: violados,
    error:
      `Venda abaixo da margem mínima comercial (${margem}%). ` +
      `Produto "${primeiro.nome}": preço R$ ${primeiro.preco_unitario.toFixed(2)} ` +
      `< mínimo R$ ${primeiro.preco_minimo.toFixed(2)}.`
  };
}

module.exports = {
  precoMinimoPelaMargem,
  validarMargemMinimaComercial
};
