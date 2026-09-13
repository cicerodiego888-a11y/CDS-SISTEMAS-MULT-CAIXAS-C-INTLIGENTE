/**
 * FORMACAO-PRECO-MARGEM-06 — Helpers de margem/lucro reais do preço atual.
 * Camada informativa (não altera persistência). Sem simulação de margem desejada.
 * Uso browser: window.FormacaoPrecoMargem
 * Uso Node (testes): module.exports
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.FormacaoPrecoMargem = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PLACEHOLDER = '—';

  function arredondar2(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return NaN;
    return Math.round(n * 100) / 100;
  }

  /**
   * Lucro bruto por unidade: L = P − C
   * Aceita preço abaixo do custo (lucro negativo).
   */
  function calcularLucroBruto(custo, preco) {
    const c = Number(custo);
    const p = Number(preco);
    if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
    if (p === 0) return 0;
    return arredondar2(p - c);
  }

  /**
   * Margem bruta real sobre o preço de venda atual:
   * M = ((P − C) / P) × 100
   * - preço <= 0 → null (sem divisão por zero)
   * - custo = 0 e preço > 0 → 100%
   * - preço < custo → margem negativa
   */
  function calcularMargemBruta(custo, preco) {
    const c = Number(custo);
    const p = Number(preco);
    if (!Number.isFinite(c) || !Number.isFinite(p) || p <= 0) return null;
    return arredondar2(((p - c) / p) * 100);
  }

  /** Alias histórico (sprint 04/05) — mesma regra da margem real. */
  function calcularMargemBrutaPorPreco(custo, preco) {
    return calcularMargemBruta(custo, preco);
  }

  function formatarPercentualPreview(valor) {
    if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) {
      return PLACEHOLDER;
    }
    return `${arredondar2(valor).toFixed(2).replace('.', ',')}%`;
  }

  /**
   * V1.1.8 — markup derivado do preço persistido.
   * markup = ((precoVenda − precoCompra) / precoCompra) × 100
   */
  function derivarMarkupPercentual(custo, preco) {
    const c = Number(custo);
    const p = Number(preco);
    if (!(c > 0) || !Number.isFinite(p)) return null;
    return arredondar2(((p - c) / c) * 100);
  }

  /** preço = custo + (custo × markup / 100) */
  function calcularPrecoVendaPorMarkup(custo, markup) {
    const c = Number(custo);
    const m = Number(markup);
    if (!(c > 0) || !Number.isFinite(m)) return null;
    return arredondar2(c + (c * m / 100));
  }

  /**
   * Formação do cadastro: preco_venda persistido é oficial no INIT.
   * INIT/embalagem: preserva preço e deriva markup.
   * compra/lucro: recalcula preço.
   * venda: recalcula markup.
   */
  function resolverFormacaoPrecoCadastro(input = {}) {
    const origem = String(input.origem || 'init');
    const precoCompra = Number(input.precoCompra) || 0;
    const precoVenda = Number(input.precoVenda) || 0;
    const lucroInformado = input.lucroInformado === true;
    const lucroValor = Number(input.lucroValor);

    if (origem === 'init' || origem === 'embalagem') {
      const markup = (precoCompra > 0 && precoVenda > 0)
        ? derivarMarkupPercentual(precoCompra, precoVenda)
        : (lucroInformado && Number.isFinite(lucroValor) ? arredondar2(lucroValor) : null);
      return {
        precoCompra,
        precoVenda,
        lucroPercentual: markup
      };
    }

    if (origem === 'venda') {
      const markup = (precoCompra > 0 && precoVenda > 0)
        ? derivarMarkupPercentual(precoCompra, precoVenda)
        : (lucroInformado && Number.isFinite(lucroValor) ? arredondar2(lucroValor) : null);
      return {
        precoCompra,
        precoVenda,
        lucroPercentual: markup
      };
    }

    if (origem === 'compra' || origem === 'lucro') {
      const lucro = lucroInformado && Number.isFinite(lucroValor) ? lucroValor : 0;
      const novoPreco = precoCompra > 0
        ? calcularPrecoVendaPorMarkup(precoCompra, lucro)
        : precoVenda;
      return {
        precoCompra,
        precoVenda: novoPreco == null ? precoVenda : novoPreco,
        lucroPercentual: arredondar2(lucro)
      };
    }

    return {
      precoCompra,
      precoVenda,
      lucroPercentual: lucroInformado && Number.isFinite(lucroValor) ? arredondar2(lucroValor) : null
    };
  }

  return Object.freeze({
    PLACEHOLDER,
    arredondar2,
    calcularLucroBruto,
    calcularMargemBruta,
    calcularMargemBrutaPorPreco,
    formatarPercentualPreview,
    derivarMarkupPercentual,
    calcularPrecoVendaPorMarkup,
    resolverFormacaoPrecoCadastro
  });
}));
