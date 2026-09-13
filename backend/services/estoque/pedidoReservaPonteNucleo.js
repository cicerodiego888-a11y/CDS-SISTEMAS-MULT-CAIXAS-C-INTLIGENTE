/**
 * RC4.1.2 — Ponte Pedido ↔ Núcleo Transacional.
 *
 * Reconhece reservas ATIVAS de pedido_estoque_reservas no cálculo de
 * disponibilidade do Núcleo, e consome essas reservas ao faturar.
 *
 * NÃO altera Motor Comercial, MTS nem a API pública de criação de reserva.
 */

'use strict';

function round3(n) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

function getDb(dbInjected) {
  if (dbInjected) return dbInjected;
  return require('../../database');
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

/**
 * Mapa produto_id → quantidade_fiscal reservada ATIVA do pedido.
 * Pedido sem reserva / inválido → mapa vazio (fluxo legado).
 */
async function obterCreditoReservaPedido(pedidoId, opts = {}) {
  const id = Number(pedidoId);
  if (!Number.isInteger(id) || id <= 0) {
    return Object.freeze({ pedido_id: null, por_produto: Object.freeze({}), total: 0 });
  }

  const db = getDb(opts.db);
  let rows = [];
  try {
    rows = await dbAll(
      db,
      `SELECT produto_id, COALESCE(SUM(quantidade_fiscal), 0) AS quantidade
       FROM pedido_estoque_reservas
       WHERE pedido_id = ? AND status = 'ATIVA'
       GROUP BY produto_id`,
      [id]
    );
  } catch (_) {
    return Object.freeze({ pedido_id: id, por_produto: Object.freeze({}), total: 0 });
  }

  const porProduto = {};
  let total = 0;
  for (const row of rows) {
    const pid = Number(row.produto_id);
    const q = round3(row.quantidade);
    if (pid > 0 && q > 0) {
      porProduto[pid] = q;
      total = round3(total + q);
    }
  }

  return Object.freeze({
    pedido_id: id,
    por_produto: Object.freeze(porProduto),
    total
  });
}

/**
 * Ajusta disponibilidade fiscal creditando a reserva do próprio pedido.
 * disponivel_outros permanece (saldo - reservado); o crédito só vale para este pedido.
 */
function creditarDisponibilidadeComReservaPedido(calc, creditoProduto) {
  const credito = round3(creditoProduto || 0);
  const disponivelFiscal = round3(Number(calc?.disponivel_fiscal || 0) + credito);
  const disponivelNaoFiscal = round3(Number(calc?.disponivel_nao_fiscal || 0));
  return {
    ...calc,
    disponivel_fiscal: Math.max(0, disponivelFiscal),
    disponivel_nao_fiscal: Math.max(0, disponivelNaoFiscal),
    disponivel_total: Math.max(0, round3(disponivelFiscal + disponivelNaoFiscal)),
    credito_reserva_pedido: credito
  };
}

/**
 * Consome reservas ATIVAS do pedido após a venda (baixa física já feita pelo Núcleo).
 * - Decrementa reservado_fiscal no produto
 * - Marca pedido_estoque_reservas como CONSUMIDA
 * Idempotente: linhas já CONSUMIDA/CANCELADA são ignoradas.
 */
async function consumirReservasPedidoNaVenda(pedidoId, vendaId = null, opts = {}) {
  const id = Number(pedidoId);
  if (!Number.isInteger(id) || id <= 0) {
    return { consumidas: 0, pedido_id: null };
  }

  const db = getDb(opts.db);
  const rows = await dbAll(
    db,
    `SELECT * FROM pedido_estoque_reservas WHERE pedido_id = ? AND status = 'ATIVA'`,
    [id]
  );

  let consumidas = 0;
  for (const row of rows) {
    const q = round3(row.quantidade_fiscal);
    if (q > 0) {
      await dbRun(
        db,
        `UPDATE produtos
         SET reservado_fiscal = CASE
           WHEN COALESCE(reservado_fiscal, 0) - ? < 0 THEN 0
           ELSE COALESCE(reservado_fiscal, 0) - ?
         END,
         updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [q, q, row.produto_id]
      );
    }

    await dbRun(
      db,
      `UPDATE pedido_estoque_reservas
       SET status = 'CONSUMIDA',
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'ATIVA'`,
      [row.id]
    );
    consumidas += 1;
  }

  return {
    consumidas,
    pedido_id: id,
    venda_id: vendaId != null ? Number(vendaId) : null
  };
}

/** Callback-friendly wrappers for VendaPagamentoService */
function obterCreditoReservaPedidoCb(pedidoId, db, callback) {
  obterCreditoReservaPedido(pedidoId, { db })
    .then((r) => callback(null, r))
    .catch((err) => callback(err));
}

function consumirReservasPedidoNaVendaCb(pedidoId, vendaId, db, callback) {
  consumirReservasPedidoNaVenda(pedidoId, vendaId, { db })
    .then((r) => callback(null, r))
    .catch((err) => callback(err));
}

module.exports = {
  obterCreditoReservaPedido,
  creditarDisponibilidadeComReservaPedido,
  consumirReservasPedidoNaVenda,
  obterCreditoReservaPedidoCb,
  consumirReservasPedidoNaVendaCb,
  round3
};
