/**
 * RC COMPRAS 5.4.1 — Importação financeira da NF-e (somente leitura do XML).
 *
 * Extrai pag/detPag, cobr/fat/dup e totais (vIPI, vSeg) sem alterar MIIP/Estoque/Fiscal.
 *
 * @module services/compras/ImportacaoFinanceiraNfe
 */

'use strict';

function moeda(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function asArray(valor) {
  if (valor == null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function digitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

/** SEFAZ tPag → forma_pagamento CDS */
const TPAG_PARA_FORMA = Object.freeze({
  '01': 'dinheiro',
  '02': 'cheque',
  '03': 'cartao_credito',
  '04': 'cartao_debito',
  '05': 'credito_loja',
  '10': 'vale_alimentacao',
  '11': 'vale_refeicao',
  '12': 'vale_presente',
  '13': 'vale_combustivel',
  '15': 'boleto',
  '16': 'deposito',
  '17': 'pix',
  '18': 'transferencia',
  '19': 'programa_fidelidade',
  '90': 'sem_pagamento',
  '99': 'outro'
});

const FORMA_LABEL = Object.freeze({
  dinheiro: 'Dinheiro',
  cheque: 'Cheque',
  cartao_credito: 'Cartão Crédito',
  cartao_debito: 'Cartão Débito',
  credito_loja: 'Crédito Loja',
  vale_alimentacao: 'Vale Alimentação',
  vale_refeicao: 'Vale Refeição',
  vale_presente: 'Vale Presente',
  vale_combustivel: 'Vale Combustível',
  boleto: 'Boleto',
  deposito: 'Depósito Bancário',
  pix: 'PIX',
  transferencia: 'Transferência Bancária',
  programa_fidelidade: 'Programa Fidelidade',
  sem_pagamento: 'Sem Pagamento',
  outro: 'Outros'
});

/**
 * @param {string|number} tPag
 * @returns {string}
 */
function mapearTPagParaForma(tPag) {
  const codigo = digitos(tPag).padStart(2, '0').slice(-2);
  return TPAG_PARA_FORMA[codigo] || 'outro';
}

/**
 * @param {string} forma
 * @returns {string}
 */
function rotuloFormaPagamentoCds(forma) {
  return FORMA_LABEL[String(forma || '').toLowerCase()] || FORMA_LABEL.outro;
}

/**
 * @param {Object|null|undefined} pagNode — infNFe.pag (xml2js)
 * @returns {Array<{ tPag: string, vPag: number, indPag: string|null, forma: string }>}
 */
function extrairDetPag(pagNode) {
  if (!pagNode) return [];
  const dets = asArray(pagNode.detPag);
  return dets.map((d) => {
    const tPag = digitos(d?.tPag).padStart(2, '0').slice(-2) || '99';
    return {
      tPag,
      vPag: moeda(d?.vPag),
      indPag: d?.indPag != null ? String(d.indPag) : null,
      forma: mapearTPagParaForma(tPag)
    };
  }).filter((d) => d.tPag);
}

/**
 * @param {Object|null|undefined} cobrNode — infNFe.cobr
 * @returns {{ fatura: Object|null, duplicatas: Array<{ numero: string, vencimento: string, valor: number }> }}
 */
function extrairCobranca(cobrNode) {
  if (!cobrNode) {
    return { fatura: null, duplicatas: [] };
  }

  const fat = cobrNode.fat || null;
  const fatura = fat
    ? {
      numero: fat.nFat != null ? String(fat.nFat) : '',
      valor_original: moeda(fat.vOrig),
      valor_desconto: moeda(fat.vDesc),
      valor_liquido: moeda(fat.vLiq)
    }
    : null;

  const duplicatas = asArray(cobrNode.dup).map((d, idx) => {
    const venc = String(d?.dVenc || '').trim();
    return {
      numero: d?.nDup != null ? String(d.nDup) : String(idx + 1).padStart(3, '0'),
      vencimento: venc.length >= 10 ? venc.slice(0, 10) : venc,
      valor: moeda(d?.vDup)
    };
  }).filter((d) => d.valor > 0 || d.vencimento);

  return { fatura, duplicatas };
}

/**
 * Monta payload financeiro pronto para a tela/API de compras.
 *
 * @param {Object} params
 * @param {Object} [params.pag]
 * @param {Object} [params.cobr]
 * @param {Object} [params.icmsTot]
 * @returns {Object}
 */
function montarImportacaoFinanceiraNfe({ pag, cobr, icmsTot } = {}) {
  const pagamentos = extrairDetPag(pag);
  const { fatura, duplicatas } = extrairCobranca(cobr);

  const valorIpi = moeda(icmsTot?.vIPI);
  const valorSeguro = moeda(icmsTot?.vSeg);
  const valorProdutos = moeda(icmsTot?.vProd);
  const valorDesconto = moeda(icmsTot?.vDesc);
  const valorFrete = moeda(icmsTot?.vFrete);
  const valorOutras = moeda(icmsTot?.vOutro);
  const valorTotalNota = moeda(icmsTot?.vNF);

  const formaPrincipal = pagamentos.length
    ? pagamentos.reduce((a, b) => (b.vPag >= a.vPag ? b : a)).forma
    : null;

  const indPag = pagamentos.find((p) => p.indPag != null)?.indPag;
  const temDuplicatas = duplicatas.length > 0;
  const prazoPorIndPag = String(indPag) === '1';
  const condicaoPagamento = (temDuplicatas || prazoPorIndPag) ? 'prazo' : 'avista';

  const parcelasDetalhe = duplicatas.map((d, idx) => ({
    numero: idx + 1,
    documento: d.numero,
    vencimento: d.vencimento,
    valor: d.valor,
    tipo: 'parcela'
  }));

  return {
    valor_ipi: valorIpi,
    valor_seguro: valorSeguro,
    valor_produtos: valorProdutos,
    valor_desconto: valorDesconto,
    valor_frete: valorFrete,
    valor_outras_despesas: valorOutras,
    valor_total_nota: valorTotalNota,
    pagamentos,
    forma_pagamento: formaPrincipal,
    condicao_pagamento: condicaoPagamento,
    fatura,
    duplicatas,
    parcelas: parcelasDetalhe.length || 1,
    parcelas_detalhe: parcelasDetalhe,
    data_vencimento: parcelasDetalhe[0]?.vencimento || null
  };
}

/**
 * Total esperado conforme componentes da NF-e.
 * total = produtos - desconto + frete + seguro + outras + ipi
 *
 * @param {Object} totais
 * @returns {number}
 */
function calcularTotalComponentes(totais = {}) {
  return moeda(
    moeda(totais.valor_produtos)
    - moeda(totais.valor_desconto)
    + moeda(totais.valor_frete)
    + moeda(totais.valor_seguro)
    + moeda(totais.valor_outras_despesas)
    + moeda(totais.valor_ipi)
  );
}

module.exports = {
  moeda,
  TPAG_PARA_FORMA,
  FORMA_LABEL,
  mapearTPagParaForma,
  rotuloFormaPagamentoCds,
  extrairDetPag,
  extrairCobranca,
  montarImportacaoFinanceiraNfe,
  calcularTotalComponentes
};
