/**
 * RC7.10.1 — Valor Fiscal Líquido (fonte oficial única)
 *
 * Rateio comercial (desconto/acréscimo) sobre totais F×NF brutos do Motor.
 * Critério idêntico ao PDV (fator = totalLiquido / subtotalBruto + ajuste de centavos).
 *
 * O Motor F×NF continua calculando quantidade × preço (bruto).
 * Esta camada converte bruto → líquido antes do MIDP / Orquestrador.
 *
 * NÃO altera Parser, MIIP, Manifestação, DistDFe ou Compras.
 */

'use strict';

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Rateio proporcional oficial F×NF (mesmo algoritmo do PDV).
 *
 * @param {object} entrada
 * @param {number} entrada.valorFiscalBruto
 * @param {number} entrada.valorNaoFiscalBruto
 * @param {number} [entrada.desconto=0]
 * @param {number} [entrada.acrescimo=0]
 */
function ratearAjusteComercialFxNF(entrada = {}) {
  const valorFiscalBruto = round2(entrada.valorFiscalBruto || 0);
  const valorNaoFiscalBruto = round2(entrada.valorNaoFiscalBruto || 0);
  const subtotalBruto = round2(valorFiscalBruto + valorNaoFiscalBruto);
  const desconto = Math.max(0, round2(entrada.desconto || 0));
  const acrescimo = Math.max(0, round2(entrada.acrescimo || 0));
  const totalLiquido = Math.max(0, round2(subtotalBruto - desconto + acrescimo));

  if (
    subtotalBruto <= 0
    || (desconto <= 0 && acrescimo <= 0)
    || Math.abs(totalLiquido - subtotalBruto) < 0.005
  ) {
    return {
      valorFiscalBruto,
      valorNaoFiscalBruto,
      valorFiscalLiquido: valorFiscalBruto,
      valorNaoFiscalLiquido: valorNaoFiscalBruto,
      descontoFiscalRateado: 0,
      descontoNaoFiscalRateado: 0,
      acrescimoFiscalRateado: 0,
      acrescimoNaoFiscalRateado: 0,
      desconto,
      acrescimo,
      subtotalBruto,
      totalLiquido: subtotalBruto,
      fator: 1,
      ajustado: false
    };
  }

  // Algoritmo único (PDV): fator proporcional + reconciliação de centavos
  const fator = totalLiquido / subtotalBruto;
  let valorFiscalLiquido = round2(valorFiscalBruto * fator);
  let valorNaoFiscalLiquido = round2(valorNaoFiscalBruto * fator);
  const diff = round2(totalLiquido - valorFiscalLiquido - valorNaoFiscalLiquido);

  if (diff !== 0) {
    if (valorFiscalLiquido >= valorNaoFiscalLiquido) {
      valorFiscalLiquido = round2(valorFiscalLiquido + diff);
    } else {
      valorNaoFiscalLiquido = round2(valorNaoFiscalLiquido + diff);
    }
  }

  // Componentes da identidade oficial (derivados do resultado do fator)
  const deltaFiscal = round2(valorFiscalLiquido - valorFiscalBruto);
  const deltaNaoFiscal = round2(valorNaoFiscalLiquido - valorNaoFiscalBruto);

  const descontoFiscalRateado = deltaFiscal < 0 ? round2(-deltaFiscal) : 0;
  const descontoNaoFiscalRateado = deltaNaoFiscal < 0 ? round2(-deltaNaoFiscal) : 0;
  const acrescimoFiscalRateado = deltaFiscal > 0 ? deltaFiscal : 0;
  const acrescimoNaoFiscalRateado = deltaNaoFiscal > 0 ? deltaNaoFiscal : 0;

  return {
    valorFiscalBruto,
    valorNaoFiscalBruto,
    valorFiscalLiquido,
    valorNaoFiscalLiquido,
    descontoFiscalRateado,
    descontoNaoFiscalRateado,
    acrescimoFiscalRateado,
    acrescimoNaoFiscalRateado,
    desconto,
    acrescimo,
    subtotalBruto,
    totalLiquido,
    fator,
    ajustado: true
  };
}

/**
 * Função oficial — única fonte do valor fiscal líquido.
 *
 * valorFiscalLiquido = valorFiscalBruto - descontoFiscalRateado + acrescimoFiscalRateado
 */
function calcularValorFiscalLiquido(entrada = {}) {
  const rateio = ratearAjusteComercialFxNF(entrada);

  const valorFiscalLiquido = round2(
    rateio.valorFiscalBruto - rateio.descontoFiscalRateado + rateio.acrescimoFiscalRateado
  );

  // Com reconciliação de centavos, o rateio já é a fonte; identidade deve coincidir.
  const liquidoOficial = rateio.valorFiscalLiquido;
  if (Math.abs(valorFiscalLiquido - liquidoOficial) > 0.009) {
    // Mantém identidade explícita alinhada ao rateio oficial
  }

  return {
    ...rateio,
    valorFiscalLiquido: liquidoOficial,
    valorFiscalEfetivo: liquidoOficial,
    valorNaoFiscal: rateio.valorNaoFiscalLiquido
  };
}

/**
 * Aplica o fator líquido nos valores monetários dos itens (quantidades intactas).
 */
function aplicarValorFiscalLiquidoNosItens(itens = [], rateio = {}) {
  const lista = Array.isArray(itens) ? itens : [];
  if (!rateio || rateio.ajustado === false || Number(rateio.fator) === 1) {
    return lista.map((i) => ({ ...i }));
  }

  const fator = Number(rateio.fator);
  const out = lista.map((item) => ({
    ...item,
    valor_fiscal: round2(Number(item.valor_fiscal || 0) * fator),
    valor_nao_fiscal: round2(Number(item.valor_nao_fiscal || 0) * fator)
  }));

  const somaF = round2(out.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0));
  const somaNF = round2(out.reduce((s, i) => s + Number(i.valor_nao_fiscal || 0), 0));
  const diffF = round2(Number(rateio.valorFiscalLiquido || 0) - somaF);
  const diffNF = round2(Number(rateio.valorNaoFiscalLiquido || 0) - somaNF);

  if (diffF !== 0) {
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (Number(out[i].valor_fiscal || 0) > 0 || i === 0) {
        out[i].valor_fiscal = round2(Number(out[i].valor_fiscal || 0) + diffF);
        break;
      }
    }
  }

  if (diffNF !== 0) {
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (Number(out[i].valor_nao_fiscal || 0) > 0 || i === 0) {
        out[i].valor_nao_fiscal = round2(Number(out[i].valor_nao_fiscal || 0) + diffNF);
        break;
      }
    }
  }

  return out;
}

/**
 * Escala valorFiscalMaximo pelo mesmo fator comercial (contrato MIDP).
 */
function calcularValorFiscalMaximoLiquido(valorFiscalMaximoBruto, rateio = {}) {
  const bruto = round2(valorFiscalMaximoBruto || 0);
  if (!rateio || rateio.ajustado === false || Number(rateio.fator) === 1) {
    return bruto;
  }
  return round2(bruto * Number(rateio.fator));
}

module.exports = {
  round2,
  ratearAjusteComercialFxNF,
  calcularValorFiscalLiquido,
  aplicarValorFiscalLiquidoNosItens,
  calcularValorFiscalMaximoLiquido
};
