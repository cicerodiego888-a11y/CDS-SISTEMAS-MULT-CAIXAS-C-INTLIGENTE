/**
 * RC5.3.1 … RC5.3.5 — Executor de Plano de Correção de Reservas.
 *
 * Consome planos gerados por ReservaReconciliationService.
 * Por padrão opera em DRY_RUN: nenhuma mutação no banco.
 *
 * RC5.3.2 — LIBERAR_RESERVA
 * RC5.3.3 — REMOVER_RESERVA (órfãs)
 * RC5.3.4 — CRIAR_RESERVA (ausentes)
 * RC5.3.5 — AJUSTAR_RESERVA (divergência de quantidade)
 *
 * @module motores/comercial/ReservaRepairService
 */
'use strict';

const {
  AcaoCorrecao,
  RiscoCorrecao
} = require('./ReservaReconciliationService');
const auditoria = require('./PedidoEstoqueAuditoria');
const { PedidoStatus } = require('../../services/pedido/enums');

/** Ações conhecidas. */
const ACOES_CONHECIDAS = Object.freeze(new Set(Object.values(AcaoCorrecao)));

function round3(n) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

function getDb(dbInjected) {
  if (dbInjected) return dbInjected;
  return require('../../database');
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function normalizarOptions(options = {}) {
  return {
    dryRun: options.dryRun !== false,
    db: options.db || null,
    contexto: options.contexto || null
  };
}

function resultado({
  sucesso,
  acao = null,
  executaria = false,
  descricao = '',
  risco = null,
  codigo = null,
  dryRun = null,
  detalhes = null
} = {}) {
  const out = {
    sucesso: Boolean(sucesso),
    acao: acao != null ? String(acao) : null,
    executaria: Boolean(executaria),
    descricao: String(descricao || ''),
    risco: risco != null ? String(risco) : null
  };
  if (codigo != null) out.codigo = String(codigo);
  if (dryRun != null) out.dry_run = Boolean(dryRun);
  if (detalhes != null) out.detalhes = Object.freeze({ ...detalhes });
  return Object.freeze(out);
}

/**
 * RC5.3.2 — libera reserva ativa de pedido CANCELADO.
 *
 * @param {{ plano: object, pedido_id?: number, reserva_id?: number, produto_id?: number, usuario_id?: number }} ctx
 * @param {{ db?: object, dryRun?: boolean }} opts
 */
async function handlerLiberarReserva(ctx = {}, opts = {}) {
  const plano = ctx.plano || {};
  const risco = plano.risco != null ? String(plano.risco) : RiscoCorrecao.BAIXO;
  const db = getDb(opts.db);

  const pedidoId = Number(ctx.pedido_id ?? ctx.pedidoId);
  const reservaId = Number(ctx.reserva_id ?? ctx.reservaId);
  const usuarioId = ctx.usuario_id != null || ctx.usuarioId != null
    ? Number(ctx.usuario_id ?? ctx.usuarioId)
    : null;

  if (!Number.isInteger(reservaId) || reservaId <= 0) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.LIBERAR_RESERVA,
      executaria: false,
      descricao: 'reserva_id inválido para LIBERAR_RESERVA.',
      risco,
      codigo: 'RESERVA_INEXISTENTE',
      dryRun: false
    });
  }

  const reserva = await dbGet(
    db,
    `SELECT id, pedido_id, produto_id, quantidade_fiscal, status
     FROM pedido_estoque_reservas WHERE id = ?`,
    [reservaId]
  );

  if (!reserva || String(reserva.status).toUpperCase() !== 'ATIVA') {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.LIBERAR_RESERVA,
      executaria: false,
      descricao: `Reserva #${reservaId} inexistente ou não está ATIVA.`,
      risco,
      codigo: 'RESERVA_INEXISTENTE',
      dryRun: false
    });
  }

  const pedidoIdEfetivo = Number.isInteger(pedidoId) && pedidoId > 0
    ? pedidoId
    : Number(reserva.pedido_id);

  const pedido = await dbGet(
    db,
    `SELECT id, status FROM pedidos WHERE id = ?`,
    [pedidoIdEfetivo]
  );

  if (!pedido) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.LIBERAR_RESERVA,
      executaria: false,
      descricao: `Pedido #${pedidoIdEfetivo} não encontrado.`,
      risco,
      codigo: 'PEDIDO_NAO_ENCONTRADO',
      dryRun: false,
      detalhes: { pedido_id: pedidoIdEfetivo, reserva_id: reservaId }
    });
  }

  if (String(pedido.status).toUpperCase() !== PedidoStatus.CANCELADO) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.LIBERAR_RESERVA,
      executaria: false,
      descricao: `Pedido #${pedidoIdEfetivo} não está CANCELADO (status=${pedido.status}).`,
      risco,
      codigo: 'PEDIDO_NAO_CANCELADO',
      dryRun: false,
      detalhes: {
        pedido_id: pedidoIdEfetivo,
        status_pedido: pedido.status,
        reserva_id: reservaId
      }
    });
  }

  const produtoId = Number(reserva.produto_id);
  const qtd = round3(reserva.quantidade_fiscal);
  const produto = await dbGet(
    db,
    `SELECT id,
            COALESCE(saldo_fiscal, 0) AS saldo_fiscal,
            COALESCE(reservado_fiscal, 0) AS reservado_fiscal,
            COALESCE(saldo_nao_fiscal, 0) AS saldo_nao_fiscal
     FROM produtos WHERE id = ?`,
    [produtoId]
  );

  if (!produto) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.LIBERAR_RESERVA,
      executaria: false,
      descricao: `Produto #${produtoId} inexistente.`,
      risco,
      codigo: 'PRODUTO_INEXISTENTE',
      dryRun: false
    });
  }

  const reservado = round3(produto.reservado_fiscal);
  // Saldo inconsistente: não há reservado suficiente para devolver a disponibilidade
  if (reservado + 1e-9 < qtd) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.LIBERAR_RESERVA,
      executaria: false,
      descricao: `Saldo inconsistente: reservado_fiscal (${reservado}) < quantidade da reserva (${qtd}).`,
      risco,
      codigo: 'SALDO_INCONSISTENTE',
      dryRun: false,
      detalhes: {
        pedido_id: pedidoIdEfetivo,
        produto_id: produtoId,
        reserva_id: reservaId,
        reservado_fiscal: reservado,
        reserva_quantidade: qtd,
        saldo_fiscal: round3(produto.saldo_fiscal)
      }
    });
  }

  const reservadoAntes = reservado;
  const reservadoDepois = round3(reservadoAntes - qtd);

  // 4–5) Liberar reserva e devolver disponibilidade fiscal (↓ reservado_fiscal)
  await dbRun(
    db,
    `UPDATE produtos
     SET reservado_fiscal = ?
     WHERE id = ?`,
    [reservadoDepois, produtoId]
  );
  await dbRun(
    db,
    `UPDATE pedido_estoque_reservas
     SET status = 'CANCELADA', atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'ATIVA'`,
    [reservaId]
  );

  // 6) Auditoria
  const auditId = await auditoria.registrar(db, {
    pedido_id: pedidoIdEfetivo,
    produto_id: produtoId,
    evento: auditoria.Evento.REPARO_LIBERAR_RESERVA || 'REPARO_LIBERAR_RESERVA',
    quantidade: qtd,
    saldo_fiscal: round3(produto.saldo_fiscal),
    saldo_nao_fiscal: round3(produto.saldo_nao_fiscal),
    disponivel_fiscal: round3(produto.saldo_fiscal - reservadoDepois),
    usuario_id: usuarioId,
    detalhes: {
      acao: AcaoCorrecao.LIBERAR_RESERVA,
      reserva_id: reservaId,
      reservado_antes: reservadoAntes,
      reservado_depois: reservadoDepois
    }
  });

  // 7) Relatório
  return resultado({
    sucesso: true,
    acao: AcaoCorrecao.LIBERAR_RESERVA,
    executaria: false,
    descricao: `Reserva #${reservaId} liberada; reservado_fiscal ${reservadoAntes} → ${reservadoDepois}.`,
    risco,
    dryRun: false,
    detalhes: {
      pedido_id: pedidoIdEfetivo,
      produto_id: produtoId,
      reserva_id: reservaId,
      quantidade_liberada: qtd,
      reservado_antes: reservadoAntes,
      reservado_depois: reservadoDepois,
      saldo_fiscal: round3(produto.saldo_fiscal),
      auditoria_id: auditId
    }
  });
}

/**
 * RC5.3.3 — remove reserva órfã (sem pedido associado).
 *
 * @param {{ plano: object, reserva_id?: number, produto_id?: number, usuario_id?: number }} ctx
 * @param {{ db?: object, dryRun?: boolean }} opts
 */
async function handlerRemoverReserva(ctx = {}, opts = {}) {
  const plano = ctx.plano || {};
  const risco = plano.risco != null ? String(plano.risco) : RiscoCorrecao.BAIXO;
  const db = getDb(opts.db);

  const reservaId = Number(ctx.reserva_id ?? ctx.reservaId);
  const usuarioId = ctx.usuario_id != null || ctx.usuarioId != null
    ? Number(ctx.usuario_id ?? ctx.usuarioId)
    : null;

  if (!Number.isInteger(reservaId) || reservaId <= 0) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.REMOVER_RESERVA,
      executaria: false,
      descricao: 'reserva_id inválido para REMOVER_RESERVA.',
      risco,
      codigo: 'RESERVA_INEXISTENTE',
      dryRun: false
    });
  }

  // 1) Localizar reserva
  const reserva = await dbGet(
    db,
    `SELECT id, pedido_id, produto_id, quantidade_fiscal, status
     FROM pedido_estoque_reservas WHERE id = ?`,
    [reservaId]
  );

  if (!reserva) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.REMOVER_RESERVA,
      executaria: false,
      descricao: `Reserva #${reservaId} inexistente.`,
      risco,
      codigo: 'RESERVA_INEXISTENTE',
      dryRun: false
    });
  }

  if (String(reserva.status).toUpperCase() !== 'ATIVA') {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.REMOVER_RESERVA,
      executaria: false,
      descricao: `Reserva #${reservaId} já cancelada/inativa (status=${reserva.status}).`,
      risco,
      codigo: 'RESERVA_JA_CANCELADA',
      dryRun: false,
      detalhes: { reserva_id: reservaId, status: reserva.status }
    });
  }

  // 2) Confirmar que NÃO existe pedido associado (órfã)
  const pedidoIdReserva = Number(reserva.pedido_id);
  if (Number.isInteger(pedidoIdReserva) && pedidoIdReserva > 0) {
    const pedido = await dbGet(
      db,
      `SELECT id, status FROM pedidos WHERE id = ?`,
      [pedidoIdReserva]
    );
    if (pedido) {
      return resultado({
        sucesso: false,
        acao: AcaoCorrecao.REMOVER_RESERVA,
        executaria: false,
        descricao: `Reserva #${reservaId} possui pedido associado #${pedido.id}; use LIBERAR_RESERVA se cancelado.`,
        risco,
        codigo: 'PEDIDO_ASSOCIADO',
        dryRun: false,
        detalhes: {
          reserva_id: reservaId,
          pedido_id: pedido.id,
          status_pedido: pedido.status
        }
      });
    }
  }

  const produtoId = Number(reserva.produto_id);
  const qtd = round3(reserva.quantidade_fiscal);
  const produto = await dbGet(
    db,
    `SELECT id,
            COALESCE(saldo_fiscal, 0) AS saldo_fiscal,
            COALESCE(reservado_fiscal, 0) AS reservado_fiscal,
            COALESCE(saldo_nao_fiscal, 0) AS saldo_nao_fiscal
     FROM produtos WHERE id = ?`,
    [produtoId]
  );

  if (!produto) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.REMOVER_RESERVA,
      executaria: false,
      descricao: `Produto #${produtoId} inexistente.`,
      risco,
      codigo: 'PRODUTO_INEXISTENTE',
      dryRun: false
    });
  }

  // 3) Validar reservado_fiscal >= quantidade
  const reservado = round3(produto.reservado_fiscal);
  if (reservado + 1e-9 < qtd) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.REMOVER_RESERVA,
      executaria: false,
      descricao: `Saldo inconsistente: reservado_fiscal (${reservado}) < quantidade da reserva (${qtd}).`,
      risco,
      codigo: 'SALDO_INCONSISTENTE',
      dryRun: false,
      detalhes: {
        pedido_id: pedidoIdReserva || null,
        produto_id: produtoId,
        reserva_id: reservaId,
        reservado_fiscal: reservado,
        reserva_quantidade: qtd,
        saldo_fiscal: round3(produto.saldo_fiscal)
      }
    });
  }

  const reservadoAntes = reservado;
  const reservadoDepois = round3(reservadoAntes - qtd);

  // 4–5) Cancelar reserva e devolver disponibilidade (↓ reservado_fiscal)
  await dbRun(
    db,
    `UPDATE produtos
     SET reservado_fiscal = ?
     WHERE id = ?`,
    [reservadoDepois, produtoId]
  );
  await dbRun(
    db,
    `UPDATE pedido_estoque_reservas
     SET status = 'CANCELADA', atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'ATIVA'`,
    [reservaId]
  );

  // 6) Auditoria
  const auditId = await auditoria.registrar(db, {
    pedido_id: Number.isInteger(pedidoIdReserva) && pedidoIdReserva > 0 ? pedidoIdReserva : null,
    produto_id: produtoId,
    evento: auditoria.Evento.REPARO_REMOVER_RESERVA,
    quantidade: qtd,
    saldo_fiscal: round3(produto.saldo_fiscal),
    saldo_nao_fiscal: round3(produto.saldo_nao_fiscal),
    disponivel_fiscal: round3(produto.saldo_fiscal - reservadoDepois),
    usuario_id: usuarioId,
    detalhes: {
      acao: AcaoCorrecao.REMOVER_RESERVA,
      reserva_id: reservaId,
      pedido_id_orfao: pedidoIdReserva || null,
      reservado_antes: reservadoAntes,
      reservado_depois: reservadoDepois
    }
  });

  // 7) Relatório
  return resultado({
    sucesso: true,
    acao: AcaoCorrecao.REMOVER_RESERVA,
    executaria: false,
    descricao: `Reserva órfã #${reservaId} removida; reservado_fiscal ${reservadoAntes} → ${reservadoDepois}.`,
    risco,
    dryRun: false,
    detalhes: {
      pedido_id: Number.isInteger(pedidoIdReserva) && pedidoIdReserva > 0 ? pedidoIdReserva : null,
      produto_id: produtoId,
      reserva_id: reservaId,
      quantidade_removida: qtd,
      reservado_antes: reservadoAntes,
      reservado_depois: reservadoDepois,
      saldo_fiscal: round3(produto.saldo_fiscal),
      auditoria_id: auditId
    }
  });
}

/**
 * RC5.3.4 — cria reserva fiscal ausente para Pedido ativo.
 *
 * @param {{ plano: object, pedido_id?: number, produto_id?: number, pedido_quantidade?: number, quantidade?: number, usuario_id?: number }} ctx
 * @param {{ db?: object, dryRun?: boolean }} opts
 */
async function handlerCriarReserva(ctx = {}, opts = {}) {
  const plano = ctx.plano || {};
  const risco = plano.risco != null ? String(plano.risco) : RiscoCorrecao.MEDIO;
  const db = getDb(opts.db);

  const pedidoId = Number(ctx.pedido_id ?? ctx.pedidoId);
  const produtoId = Number(ctx.produto_id ?? ctx.produtoId);
  const usuarioId = ctx.usuario_id != null || ctx.usuarioId != null
    ? Number(ctx.usuario_id ?? ctx.usuarioId)
    : null;

  if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.CRIAR_RESERVA,
      executaria: false,
      descricao: 'pedido_id inválido para CRIAR_RESERVA.',
      risco,
      codigo: 'PEDIDO_NAO_ENCONTRADO',
      dryRun: false
    });
  }

  // 1) Localizar Pedido
  const pedido = await dbGet(
    db,
    `SELECT id, status FROM pedidos WHERE id = ?`,
    [pedidoId]
  );

  if (!pedido) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.CRIAR_RESERVA,
      executaria: false,
      descricao: `Pedido #${pedidoId} não encontrado.`,
      risco,
      codigo: 'PEDIDO_NAO_ENCONTRADO',
      dryRun: false
    });
  }

  // 2) Pedido ATIVO (não cancelado)
  if (String(pedido.status).toUpperCase() === PedidoStatus.CANCELADO) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.CRIAR_RESERVA,
      executaria: false,
      descricao: `Pedido #${pedidoId} está CANCELADO; não criar reserva.`,
      risco,
      codigo: 'PEDIDO_CANCELADO',
      dryRun: false,
      detalhes: { pedido_id: pedidoId, status_pedido: pedido.status }
    });
  }

  if (!Number.isInteger(produtoId) || produtoId <= 0) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.CRIAR_RESERVA,
      executaria: false,
      descricao: 'produto_id inválido para CRIAR_RESERVA.',
      risco,
      codigo: 'PRODUTO_INEXISTENTE',
      dryRun: false
    });
  }

  // Quantidade: contexto explícito ou soma dos itens do pedido para o produto
  let quantidade = ctx.pedido_quantidade != null || ctx.quantidade != null
    ? round3(ctx.pedido_quantidade ?? ctx.quantidade)
    : null;

  if (quantidade == null) {
    const item = await dbGet(
      db,
      `SELECT COALESCE(SUM(quantidade), 0) AS q
       FROM pedidos_itens WHERE pedido_id = ? AND produto_id = ?`,
      [pedidoId, produtoId]
    );
    quantidade = round3(item?.q || 0);
  }

  if (!(quantidade > 0)) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.CRIAR_RESERVA,
      executaria: false,
      descricao: `Quantidade inválida para reserva (${quantidade}).`,
      risco,
      codigo: 'QUANTIDADE_INVALIDA',
      dryRun: false,
      detalhes: { pedido_id: pedidoId, produto_id: produtoId, quantidade }
    });
  }

  // Reserva já existente (ATIVA) para pedido+produto
  const reservaExistente = await dbGet(
    db,
    `SELECT id, quantidade_fiscal, status
     FROM pedido_estoque_reservas
     WHERE pedido_id = ? AND produto_id = ? AND status = 'ATIVA'
     LIMIT 1`,
    [pedidoId, produtoId]
  );

  if (reservaExistente) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.CRIAR_RESERVA,
      executaria: false,
      descricao: `Já existe reserva ativa #${reservaExistente.id} para pedido #${pedidoId} / produto #${produtoId}.`,
      risco,
      codigo: 'RESERVA_JA_EXISTENTE',
      dryRun: false,
      detalhes: {
        pedido_id: pedidoId,
        produto_id: produtoId,
        reserva_id: reservaExistente.id,
        reserva_quantidade: round3(reservaExistente.quantidade_fiscal)
      }
    });
  }

  const produto = await dbGet(
    db,
    `SELECT id,
            COALESCE(saldo_fiscal, 0) AS saldo_fiscal,
            COALESCE(reservado_fiscal, 0) AS reservado_fiscal,
            COALESCE(saldo_nao_fiscal, 0) AS saldo_nao_fiscal
     FROM produtos WHERE id = ?`,
    [produtoId]
  );

  if (!produto) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.CRIAR_RESERVA,
      executaria: false,
      descricao: `Produto #${produtoId} inexistente.`,
      risco,
      codigo: 'PRODUTO_INEXISTENTE',
      dryRun: false,
      detalhes: { pedido_id: pedidoId, produto_id: produtoId }
    });
  }

  const saldoFiscal = round3(produto.saldo_fiscal);
  const reservadoAntes = round3(produto.reservado_fiscal);
  const disponivel = round3(saldoFiscal - reservadoAntes);

  if (disponivel + 1e-9 < quantidade) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.CRIAR_RESERVA,
      executaria: false,
      descricao: `Saldo fiscal insuficiente: disponível ${disponivel}, necessário ${quantidade}.`,
      risco,
      codigo: 'SALDO_INSUFICIENTE',
      dryRun: false,
      detalhes: {
        pedido_id: pedidoId,
        produto_id: produtoId,
        saldo_fiscal: saldoFiscal,
        reservado_fiscal: reservadoAntes,
        disponivel_fiscal: disponivel,
        quantidade
      }
    });
  }

  const reservadoDepois = round3(reservadoAntes + quantidade);

  // 3–4) Criar reserva e atualizar reservado_fiscal
  await dbRun(
    db,
    `UPDATE produtos
     SET reservado_fiscal = ?
     WHERE id = ?`,
    [reservadoDepois, produtoId]
  );

  const ins = await dbRun(
    db,
    `INSERT INTO pedido_estoque_reservas (
      pedido_id, produto_id, quantidade_fiscal, status, criado_em
    ) VALUES (?, ?, ?, 'ATIVA', CURRENT_TIMESTAMP)`,
    [pedidoId, produtoId, quantidade]
  );

  const reservaId = ins.lastID;

  // 5) Auditoria
  const auditId = await auditoria.registrar(db, {
    pedido_id: pedidoId,
    produto_id: produtoId,
    evento: auditoria.Evento.REPARO_CRIAR_RESERVA,
    quantidade,
    saldo_fiscal: saldoFiscal,
    saldo_nao_fiscal: round3(produto.saldo_nao_fiscal),
    disponivel_fiscal: round3(saldoFiscal - reservadoDepois),
    usuario_id: usuarioId,
    detalhes: {
      acao: AcaoCorrecao.CRIAR_RESERVA,
      reserva_id: reservaId,
      reservado_antes: reservadoAntes,
      reservado_depois: reservadoDepois
    }
  });

  // 6) Relatório
  return resultado({
    sucesso: true,
    acao: AcaoCorrecao.CRIAR_RESERVA,
    executaria: false,
    descricao: `Reserva #${reservaId} criada (qtd=${quantidade}); reservado_fiscal ${reservadoAntes} → ${reservadoDepois}.`,
    risco,
    dryRun: false,
    detalhes: {
      pedido_id: pedidoId,
      produto_id: produtoId,
      reserva_id: reservaId,
      quantidade_criada: quantidade,
      reservado_antes: reservadoAntes,
      reservado_depois: reservadoDepois,
      saldo_fiscal: saldoFiscal,
      status_pedido: pedido.status,
      auditoria_id: auditId
    }
  });
}

/**
 * RC5.3.5 — ajusta quantidade da reserva ATIVA para coincidir com o Pedido.
 *
 * @param {{ plano: object, pedido_id?: number, produto_id?: number, reserva_id?: number, pedido_quantidade?: number, reserva_quantidade?: number, usuario_id?: number }} ctx
 * @param {{ db?: object, dryRun?: boolean }} opts
 */
async function handlerAjustarReserva(ctx = {}, opts = {}) {
  const plano = ctx.plano || {};
  const risco = plano.risco != null ? String(plano.risco) : RiscoCorrecao.MEDIO;
  const db = getDb(opts.db);

  const pedidoId = Number(ctx.pedido_id ?? ctx.pedidoId);
  const produtoIdCtx = Number(ctx.produto_id ?? ctx.produtoId);
  const reservaIdCtx = Number(ctx.reserva_id ?? ctx.reservaId);
  const usuarioId = ctx.usuario_id != null || ctx.usuarioId != null
    ? Number(ctx.usuario_id ?? ctx.usuarioId)
    : null;

  if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.AJUSTAR_RESERVA,
      executaria: false,
      descricao: 'pedido_id inválido para AJUSTAR_RESERVA.',
      risco,
      codigo: 'PEDIDO_NAO_ENCONTRADO',
      dryRun: false
    });
  }

  // 1) Localizar Pedido
  const pedido = await dbGet(
    db,
    `SELECT id, status FROM pedidos WHERE id = ?`,
    [pedidoId]
  );

  if (!pedido) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.AJUSTAR_RESERVA,
      executaria: false,
      descricao: `Pedido #${pedidoId} não encontrado.`,
      risco,
      codigo: 'PEDIDO_NAO_ENCONTRADO',
      dryRun: false
    });
  }

  if (String(pedido.status).toUpperCase() === PedidoStatus.CANCELADO) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.AJUSTAR_RESERVA,
      executaria: false,
      descricao: `Pedido #${pedidoId} está CANCELADO; não ajustar reserva.`,
      risco,
      codigo: 'PEDIDO_CANCELADO',
      dryRun: false,
      detalhes: { pedido_id: pedidoId, status_pedido: pedido.status }
    });
  }

  // 2) Localizar Reserva ATIVA
  let reserva = null;
  if (Number.isInteger(reservaIdCtx) && reservaIdCtx > 0) {
    reserva = await dbGet(
      db,
      `SELECT id, pedido_id, produto_id, quantidade_fiscal, status
       FROM pedido_estoque_reservas WHERE id = ?`,
      [reservaIdCtx]
    );
  } else if (Number.isInteger(produtoIdCtx) && produtoIdCtx > 0) {
    reserva = await dbGet(
      db,
      `SELECT id, pedido_id, produto_id, quantidade_fiscal, status
       FROM pedido_estoque_reservas
       WHERE pedido_id = ? AND produto_id = ? AND status = 'ATIVA'
       LIMIT 1`,
      [pedidoId, produtoIdCtx]
    );
  }

  if (!reserva || String(reserva.status).toUpperCase() !== 'ATIVA') {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.AJUSTAR_RESERVA,
      executaria: false,
      descricao: 'Reserva ATIVA inexistente para ajuste.',
      risco,
      codigo: 'RESERVA_INEXISTENTE',
      dryRun: false,
      detalhes: {
        pedido_id: pedidoId,
        produto_id: produtoIdCtx || null,
        reserva_id: reservaIdCtx || null
      }
    });
  }

  const reservaId = Number(reserva.id);
  const produtoId = Number(reserva.produto_id);

  // Quantidade do pedido
  let pedidoQtd = ctx.pedido_quantidade != null
    ? round3(ctx.pedido_quantidade)
    : null;
  if (pedidoQtd == null) {
    const item = await dbGet(
      db,
      `SELECT COALESCE(SUM(quantidade), 0) AS q
       FROM pedidos_itens WHERE pedido_id = ? AND produto_id = ?`,
      [pedidoId, produtoId]
    );
    pedidoQtd = round3(item?.q || 0);
  }

  if (!(pedidoQtd > 0)) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.AJUSTAR_RESERVA,
      executaria: false,
      descricao: `Quantidade do pedido inválida (${pedidoQtd}).`,
      risco,
      codigo: 'QUANTIDADE_INVALIDA',
      dryRun: false,
      detalhes: { pedido_id: pedidoId, produto_id: produtoId, pedido_quantidade: pedidoQtd }
    });
  }

  const reservaQtd = round3(reserva.quantidade_fiscal);
  const diferenca = round3(pedidoQtd - reservaQtd);

  const produto = await dbGet(
    db,
    `SELECT id,
            COALESCE(saldo_fiscal, 0) AS saldo_fiscal,
            COALESCE(reservado_fiscal, 0) AS reservado_fiscal,
            COALESCE(saldo_nao_fiscal, 0) AS saldo_nao_fiscal
     FROM produtos WHERE id = ?`,
    [produtoId]
  );

  if (!produto) {
    return resultado({
      sucesso: false,
      acao: AcaoCorrecao.AJUSTAR_RESERVA,
      executaria: false,
      descricao: `Produto #${produtoId} inexistente.`,
      risco,
      codigo: 'PRODUTO_INEXISTENTE',
      dryRun: false,
      detalhes: { pedido_id: pedidoId, produto_id: produtoId, reserva_id: reservaId }
    });
  }

  const saldoFiscal = round3(produto.saldo_fiscal);
  const reservadoAntes = round3(produto.reservado_fiscal);

  // Sem alterações
  if (Math.abs(diferenca) <= 1e-9) {
    return resultado({
      sucesso: true,
      acao: AcaoCorrecao.AJUSTAR_RESERVA,
      executaria: false,
      descricao: `Reserva #${reservaId} já está alinhada (qtd=${reservaQtd}).`,
      risco,
      codigo: 'SEM_ALTERACOES',
      dryRun: false,
      detalhes: {
        pedido_id: pedidoId,
        produto_id: produtoId,
        reserva_id: reservaId,
        pedido_quantidade: pedidoQtd,
        reserva_quantidade: reservaQtd,
        diferenca: 0,
        reservado_fiscal: reservadoAntes,
        saldo_fiscal: saldoFiscal
      }
    });
  }

  let reservadoDepois;
  if (diferenca > 0) {
    // Aumento: precisa de disponível suficiente
    const disponivel = round3(saldoFiscal - reservadoAntes);
    if (disponivel + 1e-9 < diferenca) {
      return resultado({
        sucesso: false,
        acao: AcaoCorrecao.AJUSTAR_RESERVA,
        executaria: false,
        descricao: `Saldo insuficiente para aumentar reserva: disponível ${disponivel}, aumento ${diferenca}.`,
        risco,
        codigo: 'SALDO_INSUFICIENTE',
        dryRun: false,
        detalhes: {
          pedido_id: pedidoId,
          produto_id: produtoId,
          reserva_id: reservaId,
          disponivel_fiscal: disponivel,
          diferenca,
          pedido_quantidade: pedidoQtd,
          reserva_quantidade: reservaQtd
        }
      });
    }
    reservadoDepois = round3(reservadoAntes + diferenca);
  } else {
    // Redução: reservado deve cobrir a diferença absoluta
    const reducao = round3(-diferenca);
    if (reservadoAntes + 1e-9 < reducao) {
      return resultado({
        sucesso: false,
        acao: AcaoCorrecao.AJUSTAR_RESERVA,
        executaria: false,
        descricao: `Saldo inconsistente ao reduzir: reservado_fiscal (${reservadoAntes}) < redução (${reducao}).`,
        risco,
        codigo: 'SALDO_INCONSISTENTE',
        dryRun: false,
        detalhes: {
          pedido_id: pedidoId,
          produto_id: produtoId,
          reserva_id: reservaId,
          reservado_fiscal: reservadoAntes,
          diferenca
        }
      });
    }
    reservadoDepois = round3(reservadoAntes - reducao);
  }

  await dbRun(
    db,
    `UPDATE produtos SET reservado_fiscal = ? WHERE id = ?`,
    [reservadoDepois, produtoId]
  );
  await dbRun(
    db,
    `UPDATE pedido_estoque_reservas
     SET quantidade_fiscal = ?, atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'ATIVA'`,
    [pedidoQtd, reservaId]
  );

  const auditId = await auditoria.registrar(db, {
    pedido_id: pedidoId,
    produto_id: produtoId,
    evento: auditoria.Evento.REPARO_AJUSTAR_RESERVA,
    quantidade: pedidoQtd,
    saldo_fiscal: saldoFiscal,
    saldo_nao_fiscal: round3(produto.saldo_nao_fiscal),
    disponivel_fiscal: round3(saldoFiscal - reservadoDepois),
    usuario_id: usuarioId,
    detalhes: {
      acao: AcaoCorrecao.AJUSTAR_RESERVA,
      reserva_id: reservaId,
      reserva_quantidade_antes: reservaQtd,
      reserva_quantidade_depois: pedidoQtd,
      diferenca,
      reservado_antes: reservadoAntes,
      reservado_depois: reservadoDepois
    }
  });

  return resultado({
    sucesso: true,
    acao: AcaoCorrecao.AJUSTAR_RESERVA,
    executaria: false,
    descricao: diferenca > 0
      ? `Reserva #${reservaId} aumentada ${reservaQtd} → ${pedidoQtd}.`
      : `Reserva #${reservaId} reduzida ${reservaQtd} → ${pedidoQtd}.`,
    risco,
    dryRun: false,
    detalhes: {
      pedido_id: pedidoId,
      produto_id: produtoId,
      reserva_id: reservaId,
      pedido_quantidade: pedidoQtd,
      reserva_quantidade_antes: reservaQtd,
      reserva_quantidade_depois: pedidoQtd,
      diferenca,
      reservado_antes: reservadoAntes,
      reservado_depois: reservadoDepois,
      saldo_fiscal: saldoFiscal,
      status_pedido: pedido.status,
      auditoria_id: auditId
    }
  });
}

/**
 * Registry de handlers.
 * RC5.3.5 — LIBERAR + REMOVER + CRIAR + AJUSTAR.
 */
const handlers = {
  [AcaoCorrecao.CRIAR_RESERVA]: handlerCriarReserva,
  [AcaoCorrecao.AJUSTAR_RESERVA]: handlerAjustarReserva,
  [AcaoCorrecao.LIBERAR_RESERVA]: handlerLiberarReserva,
  [AcaoCorrecao.REMOVER_RESERVA]: handlerRemoverReserva,
  [AcaoCorrecao.ANALISE_MANUAL]: null
};

/**
 * Executa (ou simula) um plano de correção.
 *
 * @param {{ acao: string, descricao?: string, risco?: string, executavel?: boolean }} plano
 * @param {{ dryRun?: boolean, db?: object, contexto?: object }} [options]
 * @returns {Promise<object>}
 */
async function executarPlano(plano, options = {}) {
  const opts = normalizarOptions(options);

  if (plano == null || typeof plano !== 'object') {
    return resultado({
      sucesso: false,
      acao: null,
      executaria: false,
      descricao: 'Plano de correção ausente ou inválido.',
      risco: null,
      codigo: 'PLANO_DESCONHECIDO',
      dryRun: opts.dryRun
    });
  }

  const acao = plano.acao != null ? String(plano.acao).trim() : '';
  if (!acao || !ACOES_CONHECIDAS.has(acao)) {
    return resultado({
      sucesso: false,
      acao: acao || null,
      executaria: false,
      descricao: acao
        ? `Plano com ação desconhecida: ${acao}.`
        : 'Plano sem ação definida.',
      risco: plano.risco != null ? String(plano.risco) : null,
      codigo: 'PLANO_DESCONHECIDO',
      dryRun: opts.dryRun
    });
  }

  const descricao = plano.descricao != null
    ? String(plano.descricao)
    : `Ação ${acao}`;
  const risco = plano.risco != null ? String(plano.risco) : null;

  // DRY_RUN — não muta banco
  if (opts.dryRun) {
    return resultado({
      sucesso: true,
      acao,
      executaria: true,
      descricao,
      risco,
      dryRun: true
    });
  }

  const handler = handlers[acao];
  if (typeof handler !== 'function') {
    return resultado({
      sucesso: false,
      acao,
      executaria: false,
      descricao: `Ação ${acao} ainda não implementada.`,
      risco,
      codigo: 'ACAO_NAO_IMPLEMENTADA',
      dryRun: false
    });
  }

  const contexto = opts.contexto && typeof opts.contexto === 'object'
    ? opts.contexto
    : {};

  return handler({ plano, ...contexto }, opts);
}

function acaoImplementada(acao) {
  return typeof handlers[String(acao)] === 'function';
}

module.exports = {
  executarPlano,
  acaoImplementada,
  handlerLiberarReserva,
  handlerRemoverReserva,
  handlerCriarReserva,
  handlerAjustarReserva,
  AcaoCorrecao,
  RiscoCorrecao,
  ACOES_CONHECIDAS,
  handlers
};
