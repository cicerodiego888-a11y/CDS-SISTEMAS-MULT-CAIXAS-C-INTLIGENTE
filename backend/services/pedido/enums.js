/**
 * Enums — Módulo Pedido / Faturamento (Sprint 3.1 + 3.14 Orçamento)
 *
 * Orçamento e Pedido são a mesma entidade comercial.
 * A única diferença é o estado operacional.
 *
 * Fluxo oficial:
 *   ORCAMENTO → PEDIDO → AGUARDANDO_FATURAMENTO → FATURADO | CANCELADO
 *
 * ABERTO / EM_SEPARACAO permanecem por compatibilidade (legado Sprint 3.5).
 */

'use strict';

const PedidoStatus = Object.freeze({
  ORCAMENTO: 'ORCAMENTO',
  PEDIDO: 'PEDIDO',
  ABERTO: 'ABERTO',
  EM_SEPARACAO: 'EM_SEPARACAO',
  AGUARDANDO_FATURAMENTO: 'AGUARDANDO_FATURAMENTO',
  FATURADO: 'FATURADO',
  CANCELADO: 'CANCELADO'
});

const PEDIDO_STATUS = Object.freeze(Object.values(PedidoStatus));

/** Status equivalentes a “Pedido” comercial (aba Pedidos). */
const STATUS_ABA_PEDIDOS = Object.freeze([
  PedidoStatus.PEDIDO,
  PedidoStatus.ABERTO,
  PedidoStatus.EM_SEPARACAO
]);

/** Status editáveis na UI operacional. */
const STATUS_EDITAVEIS = Object.freeze([
  PedidoStatus.ORCAMENTO,
  PedidoStatus.PEDIDO,
  PedidoStatus.ABERTO,
  PedidoStatus.EM_SEPARACAO,
  PedidoStatus.AGUARDANDO_FATURAMENTO
]);

/** Podem ir para a fila de faturamento (nunca ORCAMENTO). */
const STATUS_ENVIAVEIS_FATURAMENTO = Object.freeze([
  PedidoStatus.PEDIDO,
  PedidoStatus.ABERTO,
  PedidoStatus.EM_SEPARACAO
]);

function normalizarPedidoStatus(valor) {
  const s = String(valor || '').toUpperCase().trim();
  if (PEDIDO_STATUS.includes(s)) return s;
  return null;
}

function ehStatusPedidoComercial(status) {
  return STATUS_ABA_PEDIDOS.includes(String(status || '').toUpperCase());
}

module.exports = {
  PedidoStatus,
  PEDIDO_STATUS,
  STATUS_ABA_PEDIDOS,
  STATUS_EDITAVEIS,
  STATUS_ENVIAVEIS_FATURAMENTO,
  normalizarPedidoStatus,
  ehStatusPedidoComercial
};
