/**
 * nfeXmlMapper — Mapeamento infNFe (xml2js) → NfeParseadaDTO.
 *
 * Sem lógica de negócio, persistência ou integrações externas.
 * RC8.5.1 — campos fiscais/embalagem ampliados.
 * RC COMPRAS 5.4.1 — financeiro (pag/cobr/vIPI).
 *
 * @module shared/nfe/mappers/nfeXmlMapper
 */

const moment = require('moment');
const NfeParseadaDTO = require('../contracts/NfeParseadaDTO');
const NfeItemParseadoDTO = require('../contracts/NfeItemParseadoDTO');
const { extrairTributosItemNfe } = require('./extrairTributosItemNfe');
const {
  montarImportacaoFinanceiraNfe
} = require('../../../services/compras/ImportacaoFinanceiraNfe');

/**
 * @param {*} valor
 * @returns {number}
 */
function parseNumero(valor) {
  return parseFloat(valor || 0);
}

/**
 * @param {Object} infNFe
 * @returns {NfeParseadaDTO}
 */
function mapearInfNFe(infNFe) {
  const ide = infNFe.ide;
  const emit = infNFe.emit;
  const det = Array.isArray(infNFe.det) ? infNFe.det : [infNFe.det].filter(Boolean);
  const total = infNFe.total?.ICMSTot;
  const infAdic = infNFe.infAdic;

  const chaveAcesso = infNFe.$?.Id?.replace('NFe', '') || '';

  const itens = det.map((d) => {
    const prod = d.prod || {};
    const trib = extrairTributosItemNfe(d.imposto || {});
    const precoUnitario = parseNumero(prod.vUnCom);

    return NfeItemParseadoDTO.create({
      produto_nome: prod.xProd || '',
      codigo_fornecedor: prod.cProd || '',
      codigo_barras: prod.cEAN || prod.cEANTrib || '',
      gtin: prod.cEAN || prod.cEANTrib || '',
      ncm: prod.NCM || '',
      cest: prod.CEST || '',
      cfop: prod.CFOP || '',
      unidade: prod.uCom || 'UN',
      unidade_tributavel: prod.uTrib || '',
      quantidade: parseNumero(prod.qCom),
      quantidade_tributavel: parseNumero(prod.qTrib),
      preco_unitario: precoUnitario,
      preco_unitario_trib: parseNumero(prod.vUnTrib),
      subtotal: parseNumero(prod.vProd),
      // CORREÇÃO-NF-MARGEM-01 — sem default comercial artificial (30%).
      // Margem vem do cadastro do produto quando houver vínculo.
      margem_lucro: null,
      preco_venda_sugerido: null,
      csosn: trib.csosn,
      cst: trib.cst,
      cst_pis: trib.cst_pis,
      cst_cofins: trib.cst_cofins,
      cst_ipi: trib.cst_ipi,
      origem: trib.origem,
      inf_ad_prod: d.infAdProd || prod.infAdProd || '',
      peso_liquido: parseNumero(prod.pesoL),
      peso_bruto: parseNumero(prod.pesoB)
    });
  });

  // RC COMPRAS 5.4.1 — financeiro do XML (pag / cobr / vIPI)
  const financeiro = montarImportacaoFinanceiraNfe({
    pag: infNFe.pag,
    cobr: infNFe.cobr,
    icmsTot: total
  });

  return NfeParseadaDTO.create({
    chave_acesso: chaveAcesso,
    numero_nf: ide?.nNF || '',
    serie_nf: ide?.serie || '',
    modelo_nf: ide?.mod || '55',
    data_emissao: ide?.dhEmi ? moment(ide.dhEmi).format('YYYY-MM-DD') : '',
    data_entrada: ide?.dhSaiEnt ? moment(ide.dhSaiEnt).format('YYYY-MM-DD') : '',
    fornecedor: emit?.xNome || '',
    fornecedor_cnpj: emit?.CNPJ || '',
    fornecedor_rua: emit?.enderEmit?.xLgr || '',
    fornecedor_numero: emit?.enderEmit?.nro || '',
    fornecedor_bairro: emit?.enderEmit?.xBairro || '',
    fornecedor_cidade: emit?.enderEmit?.xMun || '',
    fornecedor_uf: emit?.enderEmit?.UF || '',
    fornecedor_cep: emit?.enderEmit?.CEP || '',
    fornecedor_endereco: [
      emit?.enderEmit?.xLgr,
      emit?.enderEmit?.nro,
      emit?.enderEmit?.xBairro,
      emit?.enderEmit?.xMun,
      emit?.enderEmit?.UF,
      emit?.enderEmit?.CEP
    ].filter(Boolean).join(', '),
    valor_produtos: financeiro.valor_produtos || parseNumero(total?.vProd),
    valor_desconto: financeiro.valor_desconto || parseNumero(total?.vDesc),
    valor_frete: financeiro.valor_frete || parseNumero(total?.vFrete),
    valor_seguro: financeiro.valor_seguro,
    valor_outras_despesas: financeiro.valor_outras_despesas || parseNumero(total?.vOutro),
    valor_ipi: financeiro.valor_ipi,
    valor_total_nota: financeiro.valor_total_nota || parseNumero(total?.vNF),
    observacao: infAdic?.infCpl || '',
    forma_pagamento: financeiro.forma_pagamento,
    condicao_pagamento: financeiro.condicao_pagamento,
    pagamentos: financeiro.pagamentos,
    duplicatas: financeiro.duplicatas,
    fatura: financeiro.fatura,
    parcelas: financeiro.parcelas,
    parcelas_detalhe: financeiro.parcelas_detalhe,
    data_vencimento: financeiro.data_vencimento,
    itens
  });
}

module.exports = {
  mapearInfNFe,
  parseNumero
};
