/**
 * RCM-ATACADO-02 — Motor de precisão decimal para desconto/atacado.
 * Regra: nunca arredondar preço unitário antes de multiplicar pela quantidade.
 * @module services/vendas/MotorPrecoAtacado
 */
'use strict';

const CASAS_INTERNAS = 6;

function arredondarInterno(valor, casas = CASAS_INTERNAS) {
  const n = Number(valor || 0);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

function arredondarMoeda(valor) {
  return arredondarInterno(valor, 2);
}

function formatarPrecoExibicao(precoInterno) {
  return arredondarMoeda(precoInterno);
}

/**
 * Ordem oficial: subtotal bruto → desconto → total.
 * @param {{ precoOriginal: number, quantidade: number, percentualDesconto: number }} params
 */
function calcularLinhaDescontoPercentual({ precoOriginal, quantidade, percentualDesconto }) {
  const preco = arredondarInterno(precoOriginal);
  const qtd = arredondarInterno(quantidade, 3);
  const pct = arredondarInterno(percentualDesconto, 4);

  const subtotalBruto = arredondarInterno(preco * qtd);
  const valorDesconto = arredondarInterno(subtotalBruto * (pct / 100));
  const totalInterno = arredondarInterno(subtotalBruto - valorDesconto);
  const precoUnitarioInterno = qtd > 0 ? arredondarInterno(totalInterno / qtd) : preco;

  return {
    precoOriginal: preco,
    quantidade: qtd,
    percentualDesconto: pct,
    subtotalBruto,
    valorDesconto,
    totalInterno,
    total: arredondarMoeda(totalInterno),
    precoUnitarioInterno,
    precoUnitarioExibicao: formatarPrecoExibicao(precoUnitarioInterno)
  };
}

/**
 * Desconto em valor (R$) sobre o subtotal bruto.
 * @param {{ precoOriginal: number, quantidade: number, valorDesconto: number }} params
 */
function calcularLinhaDescontoValor({ precoOriginal, quantidade, valorDesconto }) {
  const preco = arredondarInterno(precoOriginal);
  const qtd = arredondarInterno(quantidade, 3);
  const subtotalBruto = arredondarInterno(preco * qtd);
  const desc = Math.min(
    Math.max(0, arredondarInterno(valorDesconto)),
    subtotalBruto
  );
  const pct = subtotalBruto > 0
    ? arredondarInterno((desc / subtotalBruto) * 100, 4)
    : 0;
  return calcularLinhaDescontoPercentual({
    precoOriginal: preco,
    quantidade: qtd,
    percentualDesconto: pct
  });
}

/**
 * @param {{ precoOriginal: number, quantidade: number, precoUnitarioInformado: number }} params
 */
function calcularLinhaPrecoUnitarioInformado({ precoOriginal, quantidade, precoUnitarioInformado }) {
  const preco = arredondarInterno(precoOriginal);
  const qtd = arredondarInterno(quantidade, 3);
  const precoInformado = arredondarInterno(precoUnitarioInformado);
  const subtotalBruto = arredondarInterno(preco * qtd);
  const totalInterno = arredondarInterno(precoInformado * qtd);
  const pct = preco > 0 ? arredondarInterno((1 - precoInformado / preco) * 100, 4) : 0;

  return {
    precoOriginal: preco,
    quantidade: qtd,
    percentualDesconto: pct,
    subtotalBruto,
    valorDesconto: arredondarInterno(subtotalBruto - totalInterno),
    totalInterno,
    total: arredondarMoeda(totalInterno),
    precoUnitarioInterno: precoInformado,
    precoUnitarioExibicao: formatarPrecoExibicao(precoInformado)
  };
}

/**
 * Faixa de atacado (preço absoluto por unidade).
 */
function calcularLinhaAtacadoFaixa({ precoVenda, precoAtacado, quantidade }) {
  const precoBase = arredondarInterno(precoVenda);
  const precoAtac = arredondarInterno(precoAtacado);
  const qtd = arredondarInterno(quantidade, 3);

  if (precoAtac <= 0 || precoAtac >= precoBase) {
    const linha = calcularLinhaPrecoUnitarioInformado({
      precoOriginal: precoBase,
      quantidade: qtd,
      precoUnitarioInformado: precoBase
    });
    return { ...linha, descontoAtacado: 0, isAtacado: false };
  }

  const linha = calcularLinhaPrecoUnitarioInformado({
    precoOriginal: precoBase,
    quantidade: qtd,
    precoUnitarioInformado: precoAtac
  });
  const descontoAtacado = arredondarMoeda(arredondarInterno((precoBase - precoAtac) * qtd));

  return {
    ...linha,
    descontoAtacado,
    isAtacado: true
  };
}

function calcularSubtotalItem({ precoUnitarioInterno, quantidade }) {
  const preco = arredondarInterno(precoUnitarioInterno);
  const qtd = arredondarInterno(quantidade, 3);
  const totalInterno = arredondarInterno(preco * qtd);
  return {
    totalInterno,
    total: arredondarMoeda(totalInterno)
  };
}

module.exports = {
  CASAS_INTERNAS,
  arredondarInterno,
  arredondarMoeda,
  formatarPrecoExibicao,
  calcularLinhaDescontoPercentual,
  calcularLinhaDescontoValor,
  calcularLinhaPrecoUnitarioInformado,
  calcularLinhaAtacadoFaixa,
  calcularSubtotalItem
};
