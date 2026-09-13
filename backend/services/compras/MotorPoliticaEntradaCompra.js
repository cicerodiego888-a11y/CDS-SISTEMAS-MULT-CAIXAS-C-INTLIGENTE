/**
 * RC9.0 / RC9.1 — Orquestração da política de entrada no Motor de Compras.
 * RC9.1 — classificarEntrada(xml|payload) sugere tipo com confiança e motivo.
 */

'use strict';

const {
  normalizarTipoEntrada,
  resolverPolitica,
  isEntradaSimplificada
} = require('./PoliticaEntradaCompra');
const { classificarEntrada } = require('./ClassificadorEntradaCompra');

/**
 * @param {Object} compra — dados da compra (tipo_entrada, nota_fiscal_avulsa, itens…)
 */
function classificarFluxoCompra(compra = {}) {
  const tipoEntrada = normalizarTipoEntrada(compra.tipo_entrada);
  const politica = resolverPolitica(tipoEntrada);
  const isNotaAvulsa = Number(compra.nota_fiscal_avulsa) === 1;
  const entradaSimplificada = politica.executarItensOperacionais === false || isNotaAvulsa;

  return {
    tipoEntrada,
    politica,
    isNotaAvulsa,
    entradaSimplificada,
    deveProcessarItens: !entradaSimplificada,
    deveExecutarEstoque: politica.executarEstoque && !isNotaAvulsa,
    deveExecutarFinanceiro: politica.executarFinanceiro,
    deveVincularCentral: politica.executarCentral
  };
}

/**
 * Valida payload de criação conforme política.
 * @returns {{ ok: boolean, error?: string }}
 */
function validarCriacaoCompra(body = {}) {
  const fluxo = classificarFluxoCompra(body);
  const itens = Array.isArray(body.itens) ? body.itens : [];
  const total = Number(body.total);

  if (!Number.isFinite(total) || total <= 0) {
    return { ok: false, error: 'Total da compra inválido.' };
  }

  if (fluxo.entradaSimplificada) {
    return { ok: true, fluxo };
  }

  if (!itens.length) {
    return { ok: false, error: 'Informe ao menos um item para a compra.' };
  }

  return { ok: true, fluxo };
}

module.exports = {
  classificarFluxoCompra,
  validarCriacaoCompra,
  isEntradaSimplificada,
  classificarEntrada
};
