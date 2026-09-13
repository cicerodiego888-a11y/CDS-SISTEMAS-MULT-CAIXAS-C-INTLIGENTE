/**
 * RC8.4.0 / RC8.4.2 — Cliente do Motor de Unidades (espelho leve para UI).
 * Expõe window.MotorUnidadesMedidaCliente
 */
(function (global) {
  'use strict';

  function num(v, casas) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    const f = Math.pow(10, casas == null ? 4 : casas);
    return Math.round(n * f) / f;
  }

  function moeda(v) {
    return num(v, 2);
  }

  function calcularCompraEmbalagem(input) {
    input = input || {};
    const quantidadeEmbalagens = num(input.quantidadeEmbalagens || input.quantidade_embalagens, 4);
    const quantidadePorEmbalagem = num(input.quantidadePorEmbalagem || input.quantidade_por_embalagem, 4);
    const valorTotalEmbalagem = moeda(input.valorTotalEmbalagem || input.valor_total_embalagem || 0);
    const margemPercentual = num(input.margemPercentual || input.margem_lucro || 0, 2);
    const quantidadeEstoque = num(quantidadeEmbalagens * quantidadePorEmbalagem, 4);
    const custoUnitario = quantidadeEstoque > 0 ? num(valorTotalEmbalagem / quantidadeEstoque, 4) : 0;
    let precoVendaUnitario = num(input.precoVendaUnitario || input.preco_venda_sugerido, 2);
    if (!(precoVendaUnitario > 0) && custoUnitario > 0) {
      precoVendaUnitario = moeda(custoUnitario * (1 + margemPercentual / 100));
    }
    return {
      quantidadeEmbalagens: quantidadeEmbalagens,
      quantidadePorEmbalagem: quantidadePorEmbalagem,
      quantidadeEstoque: quantidadeEstoque,
      valorTotalEmbalagem: valorTotalEmbalagem,
      custoUnitario: custoUnitario,
      precoVendaUnitario: precoVendaUnitario,
      valorEmbalagemVenda: moeda(precoVendaUnitario * quantidadePorEmbalagem),
      margemPercentual: custoUnitario > 0 && precoVendaUnitario > 0
        ? num(((precoVendaUnitario - custoUnitario) / custoUnitario) * 100, 2)
        : margemPercentual
    };
  }

  function calcularFormacaoPrecoCadastro(input) {
    input = input || {};
    const compraPorEmbalagem = input.compraPorEmbalagem === true
      || Number(input.compra_por_embalagem) === 1;
    const unidadeComercial = String(input.unidadeComercial || input.unidade_comercial || 'UN').toUpperCase();
    const quantidadePorEmbalagem = compraPorEmbalagem
      ? num(input.quantidadePorEmbalagem || input.quantidade_por_embalagem, 4)
      : 1;
    let custoUnitario = num(input.custoUnitario || input.preco_compra, 4);
    const valorEmb = moeda(
      input.valorEmbalagemCompra
      || input.valor_compra_embalagem
      || input.valor_total_embalagem
      || 0
    );
    if (compraPorEmbalagem && valorEmb > 0 && quantidadePorEmbalagem > 0) {
      custoUnitario = num(valorEmb / quantidadePorEmbalagem, 4);
    }
    const margemPercentual = num(input.margemPercentual || input.lucro_percentual || 0, 2);
    let precoVendaUnitario = num(input.precoVendaUnitario || input.preco_venda, 2);
    const origem = String(input.origem || 'custo');
    if (origem === 'venda' && custoUnitario > 0 && precoVendaUnitario > 0) {
      return {
        compraPorEmbalagem: compraPorEmbalagem,
        unidadeComercial: unidadeComercial,
        quantidadePorEmbalagem: quantidadePorEmbalagem,
        custoUnitario: custoUnitario,
        precoVendaUnitario: precoVendaUnitario,
        margemPercentual: num(((precoVendaUnitario - custoUnitario) / custoUnitario) * 100, 2),
        valorEmbalagemCompra: valorEmb > 0 ? valorEmb : moeda(custoUnitario * quantidadePorEmbalagem),
        valorEmbalagemVenda: moeda(precoVendaUnitario * quantidadePorEmbalagem)
      };
    }
    if (!(precoVendaUnitario > 0) || origem === 'custo' || origem === 'margem' || origem === 'embalagem') {
      precoVendaUnitario = moeda(custoUnitario * (1 + margemPercentual / 100));
    }
    return {
      compraPorEmbalagem: compraPorEmbalagem,
      unidadeComercial: unidadeComercial,
      quantidadePorEmbalagem: quantidadePorEmbalagem,
      custoUnitario: custoUnitario,
      precoVendaUnitario: precoVendaUnitario,
      margemPercentual: margemPercentual,
      valorEmbalagemCompra: valorEmb > 0 ? valorEmb : moeda(custoUnitario * quantidadePorEmbalagem),
      valorEmbalagemVenda: moeda(precoVendaUnitario * quantidadePorEmbalagem)
    };
  }

  global.MotorUnidadesMedidaCliente = {
    calcularCompraEmbalagem: calcularCompraEmbalagem,
    calcularFormacaoPrecoCadastro: calcularFormacaoPrecoCadastro
  };
})(typeof window !== 'undefined' ? window : global);
