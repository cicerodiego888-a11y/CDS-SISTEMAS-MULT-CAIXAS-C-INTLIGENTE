/**
 * PedidoService — criação e consulta de pedidos (base do Faturamento).
 * Sprint 3.1: não conclui venda.
 * RC3.16.1: confirmação fiscal via Motor Comercial antes de entrar na fila.
 */

'use strict';

const configService = require('../configuracaoService');
const { PedidoStatus } = require('./enums');
const repo = require('./PedidoRepository');
const VendaFinanceiroService = require('../vendas/VendaFinanceiroService');
const MotorComercial = require('../../motores/comercial');

const { agoraLocalBrasil } = VendaFinanceiroService;

function assertModuloHabilitado() {
  if (!configService.recursoHabilitado('faturamento')) {
    const err = new Error('Módulo Faturamento desabilitado.');
    err.statusCode = 404;
    err.codigo = 'MODULO_FATURAMENTO_DESABILITADO';
    throw err;
  }
}

function normalizarItens(itensBrutos) {
  if (!Array.isArray(itensBrutos) || itensBrutos.length === 0) {
    const err = new Error('Informe ao menos um item no pedido.');
    err.statusCode = 400;
    throw err;
  }
  return itensBrutos.map((raw, idx) => {
    const produtoId = Number(raw.produto_id);
    const quantidade = Number(raw.quantidade);
    const preco = Number(raw.preco_unitario);
    const desconto = Number(raw.desconto_percentual || 0);
    const subtotal = raw.subtotal != null
      ? Number(raw.subtotal)
      : Number((quantidade * preco * (1 - desconto / 100)).toFixed(2));
    if (!Number.isInteger(produtoId) || produtoId <= 0) {
      const err = new Error(`Item ${idx + 1}: produto_id inválido.`);
      err.statusCode = 400;
      throw err;
    }
    if (!(quantidade > 0) || !(preco >= 0) || !(subtotal >= 0)) {
      const err = new Error(`Item ${idx + 1}: quantidade/preço/subtotal inválidos.`);
      err.statusCode = 400;
      throw err;
    }
    return {
      produto_id: produtoId,
      quantidade,
      preco_unitario: preco,
      desconto_percentual: desconto,
      subtotal,
      tipo_venda: raw.tipo_venda || 'PESO'
    };
  });
}

async function listarFilaFaturamento() {
  assertModuloHabilitado();
  const itens = await repo.listarAguardandoFaturamento();
  return { success: true, itens };
}

async function obterPedido(pedidoId) {
  assertModuloHabilitado();
  const id = Number(pedidoId);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('Pedido inválido.');
    err.statusCode = 400;
    throw err;
  }
  const pedido = await repo.obterPorId(id);
  if (!pedido) {
    const err = new Error('Pedido não encontrado.');
    err.statusCode = 404;
    throw err;
  }
  return { success: true, pedido };
}

async function criarPedido(body = {}, operadorId = null) {
  assertModuloHabilitado();
  const itens = normalizarItens(body.itens);
  const totalCalculado = Number(itens.reduce((s, i) => s + Number(i.subtotal || 0), 0).toFixed(2));
  const total = body.total != null ? Number(body.total) : totalCalculado;
  if (!(total > 0)) {
    const err = new Error('Total do pedido inválido.');
    err.statusCode = 400;
    throw err;
  }

  const supervisorToken = body.supervisor_token || body.supervisorToken || null;

  const analise = await MotorComercial.analisarDisponibilidadeFiscal(itens, {
    usuarioId: operadorId
  });
  if (analise.bloqueado) {
    const err = new Error('Saldo insuficiente para atender o pedido.');
    err.statusCode = 409;
    err.codigo = 'SALDO_INSUFICIENTE';
    err.consultas = analise.consultas;
    err.plano = analise.plano;
    throw err;
  }
  if (analise.requerAutorizacao && !supervisorToken) {
    const err = new Error(
      'Saldo fiscal insuficiente. É necessária autorização do supervisor para transferir do saldo não fiscal.'
    );
    err.statusCode = 409;
    err.codigo = 'REQUER_AUTORIZACAO_SUPERVISOR';
    err.requer_autorizacao = true;
    err.plano = analise.plano.filter((p) => p.acao === 'TRANSFERIR_E_RESERVAR');
    err.consultas = analise.consultas;
    throw err;
  }

  const agora = agoraLocalBrasil();
  const dataPedido = String(body.data_pedido || agora).slice(0, 10);
  const codigo = String(body.codigo || `PED-${Date.now()}`).trim();

  const pedidoId = await repo.criarPedido({
    codigo,
    dataPedido,
    clienteId: body.cliente_id != null ? Number(body.cliente_id) : null,
    total,
    desconto: Number(body.desconto || 0),
    status: PedidoStatus.AGUARDANDO_FATURAMENTO,
    representanteId: body.representante_id != null ? Number(body.representante_id) : null,
    representanteNome: body.representante_nome != null
      ? String(body.representante_nome).trim()
      : null,
    observacao: body.observacao || null,
    operadorId,
    itens
  });

  try {
    const pedido = await repo.obterPorId(pedidoId);
    await MotorComercial.confirmarPedidoFiscal({
      pedidoId,
      itens: pedido.itens || itens,
      supervisorToken,
      usuarioId: operadorId,
      motivo: `Confirmação fiscal fila Expedição ${codigo}`
    });
  } catch (err) {
    try {
      await MotorComercial.liberarReservasDoPedido(pedidoId);
    } catch (_) { /* ignore */ }
    try {
      await repo.atualizarStatus(pedidoId, PedidoStatus.CANCELADO, [
        PedidoStatus.AGUARDANDO_FATURAMENTO
      ]);
    } catch (_) { /* ignore */ }
    if (!err.statusCode) err.statusCode = 409;
    if (!err.codigo && err.code) err.codigo = err.code;
    throw err;
  }

  const pedido = await repo.obterPorId(pedidoId);
  return { success: true, pedido };
}

module.exports = {
  listarFilaFaturamento,
  obterPedido,
  criarPedido,
  assertModuloHabilitado
};
