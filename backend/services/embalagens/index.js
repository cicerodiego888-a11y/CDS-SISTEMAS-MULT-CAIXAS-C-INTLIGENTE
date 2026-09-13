/**
 * RC8.5.2 — Facade MIE (análise + aprendizado).
 * @module services/embalagens
 */

'use strict';

const MotorMIE = require('./MotorInteligenteEmbalagens');
const MiePadroes = require('./MiePadroes');
const MieAprendizado = require('./MieAprendizadoRepository');

/**
 * Analisa item XML com aprendizado opcional do fornecedor.
 * @param {Object} item
 * @param {Object} [opts]
 * @param {*} [opts.db]
 * @param {string} [opts.fornecedorCnpj]
 */
async function analisarItemXml(item = {}, opts = {}) {
  let aprendizado = null;
  const cnpj = opts.fornecedorCnpj || item.fornecedor_cnpj || item.fornecedorCnpj;
  if (opts.db && cnpj) {
    try {
      const undHint = MiePadroes.extrairUnidadeDoTexto(
        item.produto_nome || item.xProd || ''
      ).unidade || MiePadroes.normalizarUCom(item.unidade || item.uCom);
      aprendizado = await MieAprendizado.buscarMelhorAprendizado(opts.db, cnpj, undHint);
      if (!aprendizado) {
        aprendizado = await MieAprendizado.buscarMelhorAprendizado(opts.db, cnpj, null);
      }
    } catch (_e) {
      aprendizado = null;
    }
  }

  return MotorMIE.analisar({
    xProd: item.produto_nome || item.xProd || item.descricao,
    infAdProd: item.inf_ad_prod || item.infAdProd || item.descricao_complementar,
    uCom: item.unidade || item.uCom,
    uTrib: item.unidade_tributavel || item.uTrib,
    cProd: item.codigo_fornecedor || item.cProd,
    marca: item.marca,
    quantidade: item.quantidade,
    precoUnitario: item.preco_unitario || item.valor_unitario,
    subtotal: item.subtotal || item.valor_total,
    aprendizado
  });
}

module.exports = {
  ...MotorMIE,
  ...MiePadroes,
  analisarItemXml,
  registrarAprendizado: MieAprendizado.registrarAprendizado,
  garantirTabelaAprendizado: MieAprendizado.garantirTabela,
  montarPadraoChave: MieAprendizado.montarPadraoChave
};
