/**
 * RC7.10.4 — Fonte única de totais fiscais (NFC-e 65 e NF-e 55).
 * MODELO_BRUTO × MODELO_LIQUIDO — nunca misturar / nunca duplicar desconto.
 */
'use strict';

const MODELO_BRUTO = 'MODELO_BRUTO';
const MODELO_LIQUIDO = 'MODELO_LIQUIDO';

function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

/** Alias oficial: 2 casas decimais (moeda). */
const arredondarMoeda = round2;

function toCentavos(valor) {
  return Math.round(arredondarMoeda(valor) * 100);
}

function somarMoeda(valores) {
  const cents = (Array.isArray(valores) ? valores : []).reduce((s, v) => s + toCentavos(v), 0);
  return cents / 100;
}

/**
 * IPI devolvido do item: arredonda o item primeiro.
 * percentualDevolucao = qDev / qOrig; vIPIDevol = arredondar(vIPIOriginal * perc).
 */
function calcularIpiDevolucaoItem({
  quantidadeOriginal,
  quantidadeDevolvida,
  vIPIOriginal
} = {}) {
  const qOrig = Number(quantidadeOriginal);
  const qDev = Number(quantidadeDevolvida);
  const vOrig = Number(vIPIOriginal);
  if (!(qDev > 0) || !(vOrig > 0)) {
    return {
      percentualDevolucao: 0,
      pDevol: 0,
      vIPIDevol: 0,
      vIPIOriginal: arredondarMoeda(vOrig > 0 ? vOrig : 0)
    };
  }
  const percentualDevolucao = qOrig > 0 ? qDev / qOrig : 1;
  return {
    percentualDevolucao,
    pDevol: arredondarMoeda(percentualDevolucao * 100),
    vIPIDevol: arredondarMoeda(vOrig * percentualDevolucao),
    vIPIOriginal: arredondarMoeda(vOrig)
  };
}

function formatNumber(value, decimals = 2) {
  return Number(value || 0).toFixed(decimals);
}

function obterValorFiscalItem(item = {}) {
  if (item.valor_fiscal != null && item.valor_fiscal !== '') {
    return Number(item.valor_fiscal || 0);
  }
  const q = Number(item.quantidade_fiscal != null ? item.quantidade_fiscal : item.quantidade || 0);
  const p = Number(item.preco_unitario || 0);
  if (q > 0 && p > 0) return round2(q * p);
  return Number(item.subtotal || 0);
}

/**
 * Decisão determinística (RC7.10.4):
 * 1) Sem desconto → LIQUIDO
 * 2) Itens já líquidos (vProd ≈ referência líquida) → LIQUIDO (nunca reaplicar)
 * 3) Itens brutos (vProd − desconto ≈ referência) → BRUTO
 * 4) Ambíguo → LIQUIDO (seguro pós-RC7.10.1, evita cStat 610)
 *
 * Nunca marca dois modelos ao mesmo tempo: LIQUIDO tem prioridade absoluta
 * quando itens já estão no valor líquido (elimina fronteira R$ 0,01).
 */
function determinarModeloDeTotais({ itens = [], venda = {} } = {}) {
  const lista = Array.isArray(itens) ? itens : [];
  const vProd = round2(lista.reduce((soma, item) => soma + obterValorFiscalItem(item), 0));
  const desconto = round2(Number(venda.desconto != null ? venda.desconto : (venda.desconto_total || 0)));
  const totalVenda = round2(
    Number(
      venda.total != null
        ? venda.total
        : (venda.valor_fiscal != null ? venda.valor_fiscal : vProd)
    )
  );
  const referenciaLiquidaFiscal = round2(
    Number(venda.valor_fiscal != null ? venda.valor_fiscal : totalVenda)
  );
  const frete = round2(Number(venda.frete || venda.vFrete || 0));
  const seguro = round2(Number(venda.seguro || venda.vSeg || 0));
  const outro = round2(Number(venda.outro || venda.vOutro || 0));
  const ipi = round2(Number(venda.ipi || venda.vIPI || 0));
  const st = round2(Number(venda.st || venda.vST || 0));

  const base = {
    vProd,
    vFrete: frete,
    vSeg: seguro,
    vOutro: outro,
    vIPI: ipi,
    vST: st,
    descontoInformado: desconto,
    totalVenda,
    referenciaLiquidaFiscal
  };

  if (desconto <= 0) {
    return {
      ...base,
      modelo: MODELO_LIQUIDO,
      vDesc: 0,
      vNF: round2(vProd + frete + seguro + outro + ipi + st)
    };
  }

  // Tolerância estrita (< 0,01) evita empate na fronteira de 1 centavo.
  const EPS = 0.009;
  const liquidoSeItensBrutos = round2(vProd - desconto + frete + seguro + outro + ipi + st);
  const itensJaLiquidos = Math.abs(vProd - referenciaLiquidaFiscal) < EPS;
  const itensAindaBrutos =
    Math.abs(liquidoSeItensBrutos - referenciaLiquidaFiscal) < EPS
    || Math.abs(vProd - round2(referenciaLiquidaFiscal + desconto)) < EPS;

  // Prioridade absoluta: líquido já aplicado (RC7.10.1) → nunca BRUTO
  if (itensJaLiquidos) {
    return {
      ...base,
      modelo: MODELO_LIQUIDO,
      vDesc: 0,
      vNF: round2(vProd + frete + seguro + outro + ipi + st)
    };
  }

  if (itensAindaBrutos) {
    const vDesc = Math.min(desconto, vProd);
    return {
      ...base,
      modelo: MODELO_BRUTO,
      vDesc,
      vNF: round2(vProd - vDesc + frete + seguro + outro + ipi + st)
    };
  }

  return {
    ...base,
    modelo: MODELO_LIQUIDO,
    vDesc: 0,
    vNF: round2(vProd + frete + seguro + outro + ipi + st)
  };
}

/**
 * Fórmula oficial do MOC (grupo W ICMSTot):
 * vNF = vProd − vDesc − vICMSDeson + vST + vFCPST + vFCPSTRet
 *       + vFrete + vSeg + vOutro + vII + vIPI + vIPIDevol
 * PIS e COFINS NÃO entram no vNF (apenas informativos no ICMSTot).
 */
function calcularVNFSefaz(totais = {}) {
  const vProd = round2(totais.vProd || 0);
  const vDesc = round2(totais.vDesc || 0);
  const vICMSDeson = round2(totais.vICMSDeson || 0);
  const vST = round2(totais.vST || 0);
  const vFCPST = round2(totais.vFCPST || 0);
  const vFCPSTRet = round2(totais.vFCPSTRet || 0);
  const vFrete = round2(totais.vFrete || 0);
  const vSeg = round2(totais.vSeg || 0);
  const vOutro = round2(totais.vOutro || 0);
  const vII = round2(totais.vII || 0);
  const vIPI = round2(totais.vIPI || 0);
  const vIPIDevol = round2(totais.vIPIDevol || 0);
  return round2(
    vProd - vDesc - vICMSDeson
    + vST + vFCPST + vFCPSTRet
    + vFrete + vSeg + vOutro
    + vII + vIPI + vIPIDevol
  );
}

function validarIdentidadeICMSTot(totais = {}) {
  const vProd = round2(totais.vProd || 0);
  const vDesc = round2(totais.vDesc || 0);
  const vFrete = round2(totais.vFrete || 0);
  const vSeg = round2(totais.vSeg || 0);
  const vOutro = round2(totais.vOutro || 0);
  const vIPI = round2(totais.vIPI || 0);
  const vST = round2(totais.vST || 0);
  const vII = round2(totais.vII || 0);
  const vIPIDevol = round2(totais.vIPIDevol || 0);
  const vNF = round2(totais.vNF || 0);
  const esperado = calcularVNFSefaz(totais);

  if (Math.abs(esperado - vNF) > 0.01) {
    const erro = new Error(
      `ICMSTot inconsistente: vNF=${formatNumber(vNF, 2)} diverge de ` +
      `vProd(${formatNumber(vProd, 2)}) - vDesc(${formatNumber(vDesc, 2)}) ` +
      `+ extras = ${formatNumber(esperado, 2)}.`
    );
    erro.code = 'ICMSTOT_INCONSISTENTE';
    erro.detalhes = {
      vProd,
      vDesc,
      vFrete,
      vSeg,
      vOutro,
      vIPI,
      vST,
      vNF,
      vNF_esperado: esperado,
      modelo: totais.modelo || null
    };
    throw erro;
  }

  return true;
}

module.exports = {
  MODELO_BRUTO,
  MODELO_LIQUIDO,
  round2,
  arredondarMoeda,
  toCentavos,
  somarMoeda,
  calcularIpiDevolucaoItem,
  formatNumber,
  obterValorFiscalItem,
  determinarModeloDeTotais,
  calcularVNFSefaz,
  validarIdentidadeICMSTot
};
