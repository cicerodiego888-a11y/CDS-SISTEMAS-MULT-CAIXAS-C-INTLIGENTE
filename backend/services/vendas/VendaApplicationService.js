/**
 * VendaApplicationService — Porta oficial de aplicação do Núcleo Transacional da Venda.
 *
 * Sprint 2.0: fachada pura de entrada.
 * Sprint 2.2: reconhece VendaOrigin / VendaContext / VendaContract.
 *
 * Política de porta:
 * - origem PDV → delega integralmente a VendaPagamentoService (comportamento atual)
 * - origem FATURAMENTO → delega ao núcleo sem exigir caixa (Sprint 3.1)
 * - demais origens → reconhece sem concluir
 *
 * Proibido neste módulo:
 * - regras do Motor Fiscal × Não Fiscal
 * - estoque, pagamentos, persistência, emissão
 *
 * Fluxo oficial:
 *   Controller → VendaApplicationService(contract, context) → VendaPagamentoService
 *
 * @module services/vendas/VendaApplicationService
 */

'use strict';

const VendaPagamentoService = require('./VendaPagamentoService');
const { criarVendaContract } = require('./VendaContract');
const { criarVendaContext } = require('./VendaContext');
const {
  VendaOrigin,
  origemPodeConcluirVenda,
  resolverVendaOrigin
} = require('./VendaOrigin');

/**
 * Resposta arquitetural para origens ainda não habilitadas a concluir venda.
 * @param {import('express').Response} res
 * @param {import('./VendaContext').VendaContext} context
 * @param {import('./VendaContract').VendaContract} contract
 */
function responderOrigemReconhecidaSemConclusao(res, context, contract) {
  return res.status(200).json({
    success: true,
    reconhecida: true,
    origem: context.origem,
    venda_concluida: false,
    exige_caixa: false,
    mensagem:
      'Origem reconhecida pelo Núcleo Transacional. ' +
      'Conclusão de venda para esta origem ainda não habilitada (Sprint 2.2 — preparação multi-origem).',
    contract: {
      total: contract.total,
      itens: Array.isArray(contract.itens) ? contract.itens.length : 0,
      tipo_venda: contract.tipo_venda
    }
  });
}

/**
 * Porta oficial: recebe contrato + contexto e aplica política de origem.
 * PDV / FATURAMENTO → delegação integral ao núcleo. Demais → reconhecimento sem conclusão.
 *
 * @param {import('./VendaContract').VendaContract} contract
 * @param {import('./VendaContext').VendaContext} context
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {*}
 */
function criarVendaComContexto(contract, context, req, res) {
  const ctx = context && context.origem
    ? context
    : criarVendaContext(req);
  const ctr = contract && contract.payload
    ? contract
    : criarVendaContract(req);

  req.vendaContract = ctr;
  req.vendaContext = ctx;

  if (!origemPodeConcluirVenda(ctx.origem)) {
    return responderOrigemReconhecidaSemConclusao(res, ctx, ctr);
  }

  return VendaPagamentoService.criarVenda(req, res);
}

/**
 * Adapter HTTP — monta VendaContract + VendaContext e entra na porta oficial.
 * Compatível com a assinatura Sprint 2.0 `(req, res)`.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {*}
 */
function criarVenda(req, res) {
  const contract = criarVendaContract(req);
  const context = criarVendaContext(req);
  return criarVendaComContexto(contract, context, req, res);
}

module.exports = {
  criarVenda,
  criarVendaComContexto,
  VendaOrigin,
  resolverVendaOrigin
};
