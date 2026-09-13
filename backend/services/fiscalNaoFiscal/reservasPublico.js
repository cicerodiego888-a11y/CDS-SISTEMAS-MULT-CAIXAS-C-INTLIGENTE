/**
 * Interface Pública de Reservas — Motor Fiscal × Não Fiscal.
 * RC3.16.1: reservas fiscais de Pedido. MTS NÃO cria reservas.
 *
 * @module services/fiscalNaoFiscal/reservasPublico
 */
'use strict';

const { calcularEstoqueProduto } = require('../estoque/EstoqueDisponivelService');
const {
  produtoControlaEstoque,
  SALDO_VIRTUAL_SEM_CONTROLE
} = require('../estoque/produtoControlaEstoque');

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

/** sqlite3 não expõe inTransaction; nested BEGIN falha com esta mensagem. */
const RE_TX_JA_ATIVA = /cannot start a transaction within a transaction/i;

/**
 * RC5.1.2 — executa work reutilizando TX ativa, ou com BEGIN IMMEDIATE própria.
 * @param {object} db
 * @param {() => Promise<*>} work
 */
async function executarComTxOuReutilizar(db, work) {
  let propria = false;
  try {
    await dbRun(db, 'BEGIN IMMEDIATE');
    propria = true;
  } catch (err) {
    if (!RE_TX_JA_ATIVA.test(String(err && err.message || ''))) {
      throw err;
    }
  }

  try {
    const result = await work();
    if (propria) {
      await dbRun(db, 'COMMIT');
    }
    return result;
  } catch (err) {
    if (propria) {
      try {
        await dbRun(db, 'ROLLBACK');
      } catch (_) { /* ignore */ }
    }
    throw err;
  }
}

const SQL_RESERVAS_PEDIDO = `
CREATE TABLE IF NOT EXISTS pedido_estoque_reservas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL,
  pedido_item_id INTEGER,
  produto_id INTEGER NOT NULL,
  quantidade_fiscal REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ATIVA',
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME
)
`;

async function garantirSchemaReservas(db) {
  await dbRun(db, SQL_RESERVAS_PEDIDO);
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_pedido_reservas_pedido_status
    ON pedido_estoque_reservas(pedido_id, status)`);
  await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_pedido_reservas_produto_status
    ON pedido_estoque_reservas(produto_id, status)`);
}

/**
 * Consulta disponibilidade líquida (saldo − reservado).
 */
async function consultarDisponibilidade(produtoId, opts = {}) {
  const id = Number(produtoId);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('Produto inválido.');
    err.code = 'PRODUTO_INVALIDO';
    throw err;
  }

  const db = getDb(opts.db);
  await garantirSchemaReservas(db);

  const row = await dbGet(
    db,
    `SELECT id,
            COALESCE(saldo_fiscal, 0) AS saldo_fiscal,
            COALESCE(saldo_nao_fiscal, 0) AS saldo_nao_fiscal,
            COALESCE(reservado_fiscal, 0) AS reservado_fiscal,
            COALESCE(reservado_nao_fiscal, 0) AS reservado_nao_fiscal,
            COALESCE(controla_estoque, 1) AS controla_estoque,
            estoque_atual
     FROM produtos WHERE id = ?`,
    [id]
  );

  if (!row) {
    const err = new Error('Produto não encontrado.');
    err.code = 'PRODUTO_NAO_ENCONTRADO';
    throw err;
  }

  if (!produtoControlaEstoque(row)) {
    return Object.freeze({
      produto_id: id,
      existe: true,
      controla_estoque: 0,
      estoque_fisico: Number(row.estoque_atual || 0),
      saldo_fiscal: Number(row.saldo_fiscal || 0),
      saldo_nao_fiscal: Number(row.saldo_nao_fiscal || 0),
      reservado_fiscal: 0,
      reservado_nao_fiscal: 0,
      disponivel_fiscal: SALDO_VIRTUAL_SEM_CONTROLE,
      disponivel_nao_fiscal: SALDO_VIRTUAL_SEM_CONTROLE,
      disponivel_total: SALDO_VIRTUAL_SEM_CONTROLE * 2
    });
  }

  const calc = calcularEstoqueProduto(row);
  return Object.freeze({
    produto_id: id,
    existe: true,
    controla_estoque: 1,
    ...calc
  });
}

/**
 * Disponibilidade líquida, descontando reservas de OUTROS pedidos.
 * Se `pedidoId` for informado, as reservas ATIVAS desse pedido voltam a contar
 * como disponíveis (reativação / edição / reenvio).
 */
async function consultarDisponibilidadeParaPedido(produtoId, pedidoId, opts = {}) {
  const disp = await consultarDisponibilidade(produtoId, opts);
  const pid = Number(pedidoId);
  if (!Number.isInteger(pid) || pid <= 0) return disp;

  const db = getDb(opts.db);
  await garantirSchemaReservas(db);
  const row = await dbGet(
    db,
    `SELECT COALESCE(SUM(quantidade_fiscal), 0) AS q
     FROM pedido_estoque_reservas
     WHERE pedido_id = ? AND produto_id = ? AND status = 'ATIVA'`,
    [pid, Number(produtoId)]
  );
  const propria = round3(row?.q || 0);
  if (propria <= 0) return disp;

  return Object.freeze({
    ...disp,
    reservado_fiscal: Math.max(0, round3(disp.reservado_fiscal - propria)),
    disponivel_fiscal: round3(disp.disponivel_fiscal + propria),
    disponivel_total: round3(disp.disponivel_total + propria)
  });
}
async function criarReservaFiscal(params = {}, opts = {}) {
  const pedidoId = Number(params.pedidoId || params.pedido_id);
  const produtoId = Number(params.produtoId || params.produto_id);
  const quantidade = round3(params.quantidade || params.quantidade_fiscal);
  const pedidoItemId = params.pedidoItemId != null || params.pedido_item_id != null
    ? Number(params.pedidoItemId ?? params.pedido_item_id)
    : null;

  if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
    const err = new Error('Pedido inválido para reserva.');
    err.code = 'PEDIDO_INVALIDO';
    throw err;
  }
  if (!(quantidade > 0)) {
    const err = new Error('Quantidade de reserva inválida.');
    err.code = 'QUANTIDADE_INVALIDA';
    throw err;
  }

  const db = getDb(opts.db);
  await garantirSchemaReservas(db);

  const disp = await consultarDisponibilidade(produtoId, { db });
  if (!produtoControlaEstoque(disp)) {
    return Object.freeze({
      id: null,
      pedido_id: pedidoId,
      produto_id: produtoId,
      quantidade_fiscal: quantidade,
      status: 'IGNORADA',
      controla_estoque: 0
    });
  }

  if (disp.disponivel_fiscal + 1e-9 < quantidade) {
    const err = new Error('Saldo fiscal insuficiente para reserva.');
    err.code = 'SALDO_INSUFICIENTE';
    err.saldo_disponivel = disp.disponivel_fiscal;
    throw err;
  }

  // RC5.1.2 — UPDATE + INSERT atômicos (reutiliza TX do Pedido se já houver)
  const ins = await executarComTxOuReutilizar(db, async () => {
    await dbRun(
      db,
      `UPDATE produtos
     SET reservado_fiscal = COALESCE(reservado_fiscal, 0) + ?
     WHERE id = ?`,
      [quantidade, produtoId]
    );

    return dbRun(
      db,
      `INSERT INTO pedido_estoque_reservas (
      pedido_id, pedido_item_id, produto_id, quantidade_fiscal, status, criado_em
    ) VALUES (?, ?, ?, ?, 'ATIVA', CURRENT_TIMESTAMP)`,
      [pedidoId, pedidoItemId, produtoId, quantidade]
    );
  });

  return Object.freeze({
    id: ins.lastID,
    pedido_id: pedidoId,
    produto_id: produtoId,
    quantidade_fiscal: quantidade,
    status: 'ATIVA'
  });
}

/**
 * Libera reservas ativas de um pedido.
 */
async function liberarReservasPedido(pedidoId, opts = {}) {
  const id = Number(pedidoId);
  const db = getDb(opts.db);
  await garantirSchemaReservas(db);

  const rows = await dbAll(
    db,
    `SELECT * FROM pedido_estoque_reservas WHERE pedido_id = ? AND status = 'ATIVA'`,
    [id]
  );

  for (const row of rows) {
    const q = round3(row.quantidade_fiscal);
    await dbRun(
      db,
      `UPDATE produtos
       SET reservado_fiscal = CASE
         WHEN COALESCE(reservado_fiscal, 0) - ? < 0 THEN 0
         ELSE COALESCE(reservado_fiscal, 0) - ?
       END
       WHERE id = ?`,
      [q, q, row.produto_id]
    );
    await dbRun(
      db,
      `UPDATE pedido_estoque_reservas
       SET status = 'CANCELADA', atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [row.id]
    );
  }

  return { liberadas: rows.length };
}

module.exports = {
  SQL_RESERVAS_PEDIDO,
  garantirSchemaReservas,
  consultarDisponibilidade,
  consultarDisponibilidadeParaPedido,
  criarReservaFiscal,
  liberarReservasPedido
};
