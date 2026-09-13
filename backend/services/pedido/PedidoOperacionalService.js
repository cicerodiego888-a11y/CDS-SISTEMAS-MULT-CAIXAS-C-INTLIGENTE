/**
 * PedidoOperacionalService — Sprint 3.5 + 3.14 (Orçamento) + RC3.16.1
 * Operações da UI comercial (listar/editar/cancelar/duplicar/enviar/converter).
 * NÃO altera FaturamentoService / Núcleo.
 *
 * RC3.16.1: validação/reserva fiscal via Motor Comercial (nunca F×NF/MTS direto).
 * Orçamento e Pedido compartilham a mesma entidade (tabela pedidos).
 * Conversão ORCAMENTO → PEDIDO altera status após confirmação fiscal.
 */

'use strict';

const configService = require('../configuracaoService');
const {
  PedidoStatus,
  STATUS_ENVIAVEIS_FATURAMENTO,
  normalizarPedidoStatus
} = require('./enums');
const repo = require('./PedidoRepository');
const VendaFinanceiroService = require('../vendas/VendaFinanceiroService');
const MotorComercial = require('../../motores/comercial');

const { agoraLocalBrasil } = VendaFinanceiroService;

function assertModuloHabilitado() {
  if (!configService.recursoHabilitado('faturamento')) {
    const err = new Error('O módulo Pedidos/Faturamento não está habilitado para esta empresa.');
    err.statusCode = 403;
    err.codigo = 'MODULO_NAO_LICENCIADO';
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
      const err = new Error(`Item ${idx + 1}: produto inválido.`);
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
      tipo_venda: raw.tipo_venda || 'PESO',
      id: raw.id != null ? Number(raw.id) : undefined
    };
  });
}

function montarCabecalho(body = {}) {
  const itens = normalizarItens(body.itens);
  const somaItens = Number(itens.reduce((s, i) => s + Number(i.subtotal || 0), 0).toFixed(2));
  const desconto = Number(body.desconto || 0);
  const frete = Number(body.frete || 0);
  const total = body.total != null
    ? Number(body.total)
    : Number((somaItens - desconto + frete).toFixed(2));
  if (!(total >= 0) || !(somaItens > 0)) {
    const err = new Error('Total do pedido inválido.');
    err.statusCode = 400;
    throw err;
  }
  return {
    itens,
    desconto,
    frete,
    total,
    clienteId: body.cliente_id != null && body.cliente_id !== '' ? Number(body.cliente_id) : null,
    representanteId: body.representante_id != null ? Number(body.representante_id) : null,
    representanteNome: body.representante_nome != null ? String(body.representante_nome).trim() : null,
    observacao: body.observacao || null,
    supervisorToken: body.supervisor_token || body.supervisorToken || null
  };
}

/** Resolve status inicial: UI pode enviar status ou tipo (orcamento|pedido). */
function resolverStatusInicial(body = {}) {
  const tipo = String(body.tipo || body.tipo_documento || '').toLowerCase().trim();
  if (tipo === 'orcamento' || tipo === 'orçamento') {
    return PedidoStatus.ORCAMENTO;
  }
  if (tipo === 'pedido') {
    return PedidoStatus.PEDIDO;
  }
  const status = normalizarPedidoStatus(body.status);
  if (status) return status;
  return PedidoStatus.PEDIDO;
}

function statusExigeConfirmacaoFiscal(status) {
  return [
    PedidoStatus.PEDIDO,
    PedidoStatus.ABERTO,
    PedidoStatus.EM_SEPARACAO,
    PedidoStatus.AGUARDANDO_FATURAMENTO
  ].includes(status);
}

/**
 * Confirma estoque fiscal via Motor Comercial (única ponte).
 * Pedido NÃO conhece F×NF nem MTS.
 */
async function confirmarEstoqueViaMotorComercial({
  pedidoId,
  itens,
  supervisorToken,
  usuarioId,
  motivo
}) {
  try {
    return await MotorComercial.confirmarPedidoFiscal({
      pedidoId,
      itens,
      supervisorToken,
      usuarioId,
      motivo
    });
  } catch (err) {
    if (!err.statusCode) err.statusCode = 409;
    if (!err.codigo && err.code) err.codigo = err.code;
    throw err;
  }
}

async function listar(filtros = {}) {
  assertModuloHabilitado();
  const itens = await repo.listarPedidos(filtros);
  return { success: true, itens };
}

async function obter(pedidoId) {
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

async function criar(body = {}, operadorId = null) {
  assertModuloHabilitado();
  const cab = montarCabecalho(body);
  const status = resolverStatusInicial(body);
  if ([PedidoStatus.FATURADO, PedidoStatus.CANCELADO].includes(status)) {
    const err = new Error('Status inicial inválido.');
    err.statusCode = 400;
    throw err;
  }
  const agora = agoraLocalBrasil();
  const dataPedido = String(body.data_pedido || agora).slice(0, 10);
  const prefixo = status === PedidoStatus.ORCAMENTO ? 'ORC' : 'PED';
  const codigo = String(body.codigo || `${prefixo}-${Date.now()}`).trim();

  // Orçamento: sem validação/reserva fiscal (ainda não confirmado)
  if (status === PedidoStatus.ORCAMENTO) {
    const pedidoId = await repo.criarPedido({
      codigo,
      dataPedido,
      clienteId: cab.clienteId,
      total: cab.total,
      desconto: cab.desconto,
      frete: cab.frete,
      status,
      representanteId: cab.representanteId,
      representanteNome: cab.representanteNome,
      observacao: cab.observacao,
      operadorId,
      itens: cab.itens
    });
    return obter(pedidoId);
  }

  // Pré-análise: se exige supervisor e não há token, não cria o pedido
  if (statusExigeConfirmacaoFiscal(status)) {
    const analise = await MotorComercial.analisarDisponibilidadeFiscal(cab.itens, {
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
    if (analise.requerAutorizacao && !cab.supervisorToken) {
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
  }

  const pedidoId = await repo.criarPedido({
    codigo,
    dataPedido,
    clienteId: cab.clienteId,
    total: cab.total,
    desconto: cab.desconto,
    frete: cab.frete,
    status,
    representanteId: cab.representanteId,
    representanteNome: cab.representanteNome,
    observacao: cab.observacao,
    operadorId,
    itens: cab.itens
  });

  try {
    if (statusExigeConfirmacaoFiscal(status)) {
      const pedido = await repo.obterPorId(pedidoId);
      await confirmarEstoqueViaMotorComercial({
        pedidoId,
        itens: pedido.itens || cab.itens,
        supervisorToken: cab.supervisorToken,
        usuarioId: operadorId,
        motivo: `Confirmação fiscal pedido ${codigo}`
      });
    }
  } catch (err) {
    try {
      await MotorComercial.liberarReservasDoPedido(pedidoId);
    } catch (_) { /* ignore */ }
    try {
      await repo.atualizarStatus(pedidoId, PedidoStatus.CANCELADO, [status]);
    } catch (_) { /* ignore */ }
    throw err;
  }

  return obter(pedidoId);
}

async function atualizar(pedidoId, body = {}) {
  assertModuloHabilitado();
  const id = Number(pedidoId);
  const existente = await repo.obterPorId(id);
  if (!existente) {
    const err = new Error('Pedido não encontrado.');
    err.statusCode = 404;
    throw err;
  }
  if ([PedidoStatus.FATURADO, PedidoStatus.CANCELADO].includes(existente.status)) {
    const err = new Error('Pedido faturado ou cancelado não pode ser editado.');
    err.statusCode = 400;
    throw err;
  }
  const cab = montarCabecalho(body);

  if (statusExigeConfirmacaoFiscal(existente.status)) {
    const analise = await MotorComercial.analisarDisponibilidadeFiscal(cab.itens, {
      pedidoId: id
    });
    if (analise.bloqueado) {
      const err = new Error('Saldo insuficiente para atender o pedido.');
      err.statusCode = 409;
      err.codigo = 'SALDO_INSUFICIENTE';
      err.consultas = analise.consultas;
      err.plano = analise.plano;
      throw err;
    }
    if (analise.requerAutorizacao && !cab.supervisorToken) {
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
  }

  await repo.substituirPedido({
    pedidoId: id,
    clienteId: cab.clienteId,
    total: cab.total,
    desconto: cab.desconto,
    frete: cab.frete,
    representanteId: cab.representanteId,
    representanteNome: cab.representanteNome,
    observacao: cab.observacao,
    itens: cab.itens
  });

  if (statusExigeConfirmacaoFiscal(existente.status)) {
    const pedido = await repo.obterPorId(id);
    await confirmarEstoqueViaMotorComercial({
      pedidoId: id,
      itens: pedido.itens || cab.itens,
      supervisorToken: cab.supervisorToken,
      usuarioId: null,
      motivo: `Reconfirmação fiscal pedido ${existente.codigo}`
    });
  }

  return obter(id);
}

async function cancelar(pedidoId) {
  assertModuloHabilitado();
  const id = Number(pedidoId);
  const existente = await repo.obterPorId(id);
  if (!existente) {
    const err = new Error('Pedido não encontrado.');
    err.statusCode = 404;
    throw err;
  }
  if (existente.status === PedidoStatus.FATURADO) {
    const err = new Error('Pedido faturado não pode ser cancelado por esta tela.');
    err.statusCode = 400;
    throw err;
  }
  if (existente.status === PedidoStatus.CANCELADO) {
    return { success: true, pedido: existente };
  }

  await MotorComercial.liberarReservasDoPedido(id);

  const ok = await repo.atualizarStatus(id, PedidoStatus.CANCELADO, [
    PedidoStatus.ORCAMENTO,
    PedidoStatus.PEDIDO,
    PedidoStatus.ABERTO,
    PedidoStatus.EM_SEPARACAO,
    PedidoStatus.AGUARDANDO_FATURAMENTO
  ]);
  if (!ok) {
    const err = new Error('Não foi possível cancelar o pedido.');
    err.statusCode = 400;
    throw err;
  }
  return obter(id);
}

/** Exclusão física — somente Orçamento. */
async function excluir(pedidoId) {
  assertModuloHabilitado();
  const id = Number(pedidoId);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('Pedido inválido.');
    err.statusCode = 400;
    throw err;
  }
  await repo.excluirOrcamento(id);
  return { success: true, excluido: true, id };
}

async function duplicar(pedidoId, operadorId = null) {
  assertModuloHabilitado();
  const { pedido } = await obter(pedidoId);
  const statusCopia = pedido.status === PedidoStatus.ORCAMENTO
    ? PedidoStatus.ORCAMENTO
    : PedidoStatus.PEDIDO;
  return criar({
    cliente_id: pedido.cliente_id,
    representante_id: pedido.representante_id,
    representante_nome: pedido.representante_nome,
    observacao: pedido.observacao ? `Cópia de ${pedido.codigo}: ${pedido.observacao}` : `Cópia de ${pedido.codigo}`,
    desconto: pedido.desconto,
    frete: pedido.frete,
    status: statusCopia,
    itens: (pedido.itens || []).map((i) => ({
      produto_id: i.produto_id,
      quantidade: i.quantidade,
      preco_unitario: i.preco_unitario,
      desconto_percentual: i.desconto_percentual,
      subtotal: i.subtotal,
      tipo_venda: i.tipo_venda
    }))
  }, operadorId);
}

/**
 * Converte Orçamento em Pedido — confirma estoque fiscal via Motor Comercial.
 */
async function converterParaPedido(pedidoId, body = {}, operadorId = null) {
  assertModuloHabilitado();
  const id = Number(pedidoId);
  const existente = await repo.obterPorId(id);
  if (!existente) {
    const err = new Error('Pedido não encontrado.');
    err.statusCode = 404;
    throw err;
  }
  if (existente.status === PedidoStatus.PEDIDO) {
    return { success: true, pedido: existente, ja_convertido: true };
  }
  if (existente.status !== PedidoStatus.ORCAMENTO) {
    const err = new Error('Somente orçamentos podem ser convertidos em pedido.');
    err.statusCode = 400;
    throw err;
  }

  const supervisorToken = body.supervisor_token || body.supervisorToken || null;
  await confirmarEstoqueViaMotorComercial({
    pedidoId: id,
    itens: existente.itens || [],
    supervisorToken,
    usuarioId: operadorId,
    motivo: `Conversão orçamento→pedido ${existente.codigo}`
  });

  const ok = await repo.atualizarStatus(id, PedidoStatus.PEDIDO, [PedidoStatus.ORCAMENTO]);
  if (!ok) {
    await MotorComercial.liberarReservasDoPedido(id);
    const err = new Error('Falha ao converter orçamento em pedido.');
    err.statusCode = 400;
    throw err;
  }
  return obter(id);
}

/** Envia para a fila do Faturamento (não fatura). Orçamento nunca entra na fila. */
async function enviarParaFaturamento(pedidoId, body = {}, operadorId = null) {
  assertModuloHabilitado();
  const id = Number(pedidoId);
  const existente = await repo.obterPorId(id);
  if (!existente) {
    const err = new Error('Pedido não encontrado.');
    err.statusCode = 404;
    throw err;
  }
  if (existente.status === PedidoStatus.ORCAMENTO) {
    const err = new Error('Orçamento não pode ser faturado. Converta em Pedido primeiro.');
    err.statusCode = 400;
    err.codigo = 'ORCAMENTO_NAO_FATURAVEL';
    throw err;
  }
  if (existente.status === PedidoStatus.AGUARDANDO_FATURAMENTO) {
    return { success: true, pedido: existente, ja_enviado: true };
  }
  if (!STATUS_ENVIAVEIS_FATURAMENTO.includes(existente.status)) {
    const err = new Error('Somente pedidos comerciais podem ser enviados ao faturamento.');
    err.statusCode = 400;
    throw err;
  }
  if (!(existente.itens || []).length) {
    const err = new Error('Pedido sem itens.');
    err.statusCode = 400;
    throw err;
  }

  // Reforço: garante reserva fiscal antes da Expedição
  const supervisorToken = body.supervisor_token || body.supervisorToken || null;
  await confirmarEstoqueViaMotorComercial({
    pedidoId: id,
    itens: existente.itens,
    supervisorToken,
    usuarioId: operadorId,
    motivo: `Envio Expedição pedido ${existente.codigo}`
  });

  const ok = await repo.atualizarStatus(
    id,
    PedidoStatus.AGUARDANDO_FATURAMENTO,
    [...STATUS_ENVIAVEIS_FATURAMENTO]
  );
  if (!ok) {
    const err = new Error('Falha ao enviar para faturamento.');
    err.statusCode = 400;
    throw err;
  }
  return obter(id);
}

module.exports = {
  listar,
  obter,
  criar,
  atualizar,
  cancelar,
  excluir,
  duplicar,
  converterParaPedido,
  enviarParaFaturamento
};
