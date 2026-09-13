/**
 * RC4.1.2 — Ponte reserva do pedido ↔ Núcleo Transacional
 *
 * Cobre crédito de disponibilidade + consumo de reserva, sem alterar
 * Motor Comercial / F×NF / regras de criação de reserva.
 */
'use strict';

const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();

const MotorComercial = require('../../backend/motores/comercial');
const { calcularEstoqueProduto } = require('../../backend/services/estoque/EstoqueDisponivelService');
const {
  obterCreditoReservaPedido,
  creditarDisponibilidadeComReservaPedido,
  consumirReservasPedidoNaVenda
} = require('../../backend/services/estoque/pedidoReservaPonteNucleo');
const { montarPayloadVendaDoPedido } = require('../../backend/services/faturamento/FaturamentoService');

function openDb(file = ':memory:') {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function closeDb(db) {
  return new Promise((resolve) => {
    try {
      db.close(() => resolve());
    } catch (_) {
      resolve();
    }
  });
}

async function setupDb(opts = {}) {
  const db = await openDb();
  await run(
    db,
    `CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT,
      saldo_fiscal REAL DEFAULT 0,
      saldo_nao_fiscal REAL DEFAULT 0,
      reservado_fiscal REAL DEFAULT 0,
      reservado_nao_fiscal REAL DEFAULT 0,
      estoque_atual REAL DEFAULT 0,
      updated_at DATETIME
    )`
  );
  await run(
    db,
    `CREATE TABLE movimentos_transferencia_saldos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      origem TEXT NOT NULL,
      destino TEXT NOT NULL,
      quantidade REAL NOT NULL,
      saldo_origem_antes REAL NOT NULL,
      saldo_origem_depois REAL NOT NULL,
      saldo_destino_antes REAL NOT NULL,
      saldo_destino_depois REAL NOT NULL,
      motivo TEXT,
      usuario_id INTEGER,
      data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
      resultado TEXT NOT NULL
    )`
  );
  await run(
    db,
    `CREATE TABLE pedido_estoque_reservas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_id INTEGER NOT NULL,
      pedido_item_id INTEGER,
      produto_id INTEGER NOT NULL,
      quantidade_fiscal REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ATIVA',
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME
    )`
  );
  await run(
    db,
    `CREATE TABLE auditoria_pedido_estoque_fiscal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_id INTEGER,
      produto_id INTEGER,
      evento TEXT NOT NULL,
      quantidade REAL,
      saldo_fiscal REAL,
      saldo_nao_fiscal REAL,
      disponivel_fiscal REAL,
      disponivel_nao_fiscal REAL,
      detalhes TEXT,
      usuario_id INTEGER,
      supervisor_id INTEGER,
      data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  const sf = opts.saldo_fiscal != null ? opts.saldo_fiscal : 10;
  const snf = opts.saldo_nao_fiscal != null ? opts.saldo_nao_fiscal : 0;
  const p = await run(
    db,
    `INSERT INTO produtos (nome, saldo_fiscal, saldo_nao_fiscal, reservado_fiscal, reservado_nao_fiscal, estoque_atual)
     VALUES ('Produto RC412', ?, ?, 0, 0, ?)`,
    [sf, snf, sf + snf]
  );
  return { db, produtoId: p.lastID };
}

/** Simula o cálculo do Núcleo antes de distribuir (com crédito da ponte). */
async function disponivelParaPedido(db, produtoId, pedidoId) {
  const produto = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  const calcBase = calcularEstoqueProduto(produto);
  const credito = await obterCreditoReservaPedido(pedidoId, { db });
  const calc = creditarDisponibilidadeComReservaPedido(
    calcBase,
    credito.por_produto[produtoId] || 0
  );
  return { produto, calcBase, credito, calc };
}

/** Simula baixa fiscal do Núcleo + consumo da reserva. */
async function simularFaturamentoPedido(db, produtoId, pedidoId, quantidade, vendaId) {
  await run(
    db,
    `UPDATE produtos
     SET saldo_fiscal = saldo_fiscal - ?,
         estoque_atual = estoque_atual - ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [quantidade, quantidade, produtoId]
  );
  return consumirReservasPedidoNaVenda(pedidoId, vendaId, { db });
}

async function cenario1_pedidoIgualSaldoAutorizado() {
  const { db, produtoId } = await setupDb({ saldo_fiscal: 10 });
  await MotorComercial.confirmarPedidoFiscal(
    { pedidoId: 101, itens: [{ produto_id: produtoId, quantidade: 10 }], usuarioId: 1 },
    { db }
  );

  const semCredito = await disponivelParaPedido(db, produtoId, null);
  assert.strictEqual(semCredito.calcBase.disponivel_fiscal, 0, 'sem ponte = falso insuficiente');

  const comCredito = await disponivelParaPedido(db, produtoId, 101);
  assert.strictEqual(comCredito.calc.disponivel_fiscal, 10, 'com ponte = autorizado');
  assert.strictEqual(comCredito.calc.credito_reserva_pedido, 10);

  await simularFaturamentoPedido(db, produtoId, 101, 10, 9001);
  const prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.saldo_fiscal, 0);
  assert.strictEqual(prod.reservado_fiscal, 0);
  assert.strictEqual(prod.estoque_atual, 0);

  const reservas = await all(db, 'SELECT status FROM pedido_estoque_reservas WHERE pedido_id = 101');
  assert.ok(reservas.every((r) => r.status === 'CONSUMIDA'));
  await closeDb(db);
}

async function cenario2_doisPedidosExpedirA() {
  const { db, produtoId } = await setupDb({ saldo_fiscal: 10 });
  await MotorComercial.confirmarPedidoFiscal(
    { pedidoId: 201, itens: [{ produto_id: produtoId, quantidade: 5 }], usuarioId: 1 },
    { db }
  );
  await MotorComercial.confirmarPedidoFiscal(
    { pedidoId: 202, itens: [{ produto_id: produtoId, quantidade: 5 }], usuarioId: 1 },
    { db }
  );

  const dispA = await disponivelParaPedido(db, produtoId, 201);
  assert.strictEqual(dispA.calc.disponivel_fiscal, 5);

  await simularFaturamentoPedido(db, produtoId, 201, 5, 9002);

  const prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.saldo_fiscal, 5);
  assert.strictEqual(prod.reservado_fiscal, 5);

  const resA = await all(db, `SELECT status FROM pedido_estoque_reservas WHERE pedido_id = 201`);
  const resB = await all(db, `SELECT status, quantidade_fiscal FROM pedido_estoque_reservas WHERE pedido_id = 202`);
  assert.ok(resA.every((r) => r.status === 'CONSUMIDA'));
  assert.ok(resB.every((r) => r.status === 'ATIVA'));
  assert.strictEqual(Number(resB[0].quantidade_fiscal), 5);

  const dispB = await disponivelParaPedido(db, produtoId, 202);
  assert.strictEqual(dispB.calc.disponivel_fiscal, 5);
  await closeDb(db);
}

async function cenario3_pedidoBBloqueado() {
  const { db, produtoId } = await setupDb({ saldo_fiscal: 10 });
  await MotorComercial.confirmarPedidoFiscal(
    { pedidoId: 301, itens: [{ produto_id: produtoId, quantidade: 10 }], usuarioId: 1 },
    { db }
  );

  await assert.rejects(
    () =>
      MotorComercial.confirmarPedidoFiscal(
        { pedidoId: 302, itens: [{ produto_id: produtoId, quantidade: 1 }], usuarioId: 1 },
        { db }
      ),
    (err) => {
      const c = err.codigo || err.code;
      return c === 'SALDO_INSUFICIENTE' || /insuficiente/i.test(String(err.message || ''));
    }
  );

  const dispA = await disponivelParaPedido(db, produtoId, 301);
  assert.strictEqual(dispA.calc.disponivel_fiscal, 10);

  const dispB = await disponivelParaPedido(db, produtoId, 302);
  assert.strictEqual(dispB.calc.disponivel_fiscal, 0);
  assert.strictEqual(dispB.credito.total, 0);
  await closeDb(db);
}

async function cenario4_cancelarDevolveReserva() {
  const { db, produtoId } = await setupDb({ saldo_fiscal: 10 });
  await MotorComercial.confirmarPedidoFiscal(
    { pedidoId: 401, itens: [{ produto_id: produtoId, quantidade: 10 }], usuarioId: 1 },
    { db }
  );

  await MotorComercial.liberarReservasDoPedido(401, { db });

  const prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.reservado_fiscal, 0);
  assert.strictEqual(prod.saldo_fiscal, 10);

  const reservas = await all(db, 'SELECT status FROM pedido_estoque_reservas WHERE pedido_id = 401');
  assert.ok(reservas.every((r) => r.status !== 'ATIVA'));

  const disp = await disponivelParaPedido(db, produtoId, 401);
  assert.strictEqual(disp.credito.total, 0);
  assert.strictEqual(disp.calc.disponivel_fiscal, 10);
  await closeDb(db);
}

async function cenario5_legadoSemReserva() {
  const { db, produtoId } = await setupDb({ saldo_fiscal: 10 });
  // Sem confirmarPedidoFiscal — fluxo legado
  const disp = await disponivelParaPedido(db, produtoId, 501);
  assert.strictEqual(disp.credito.total, 0);
  assert.strictEqual(disp.calc.disponivel_fiscal, 10);
  assert.strictEqual(disp.calc.credito_reserva_pedido, 0);

  const consumo = await consumirReservasPedidoNaVenda(501, 1, { db });
  assert.strictEqual(consumo.consumidas, 0);

  const prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.saldo_fiscal, 10);
  assert.strictEqual(prod.reservado_fiscal, 0);
  await closeDb(db);
}

async function etapa1_pedidoIdNoPayload() {
  const payload = montarPayloadVendaDoPedido(
    {
      id: 77,
      cliente_id: 1,
      total: 100,
      desconto: 0,
      itens: [{ produto_id: 1, quantidade: 1, preco_unitario: 100, subtotal: 100 }]
    },
    { forma_pagamento: 'dinheiro', valor_recebido: 100 },
    {}
  );
  assert.strictEqual(payload.pedido_id, 77);
}

async function run() {
  await etapa1_pedidoIdNoPayload();
  await cenario1_pedidoIgualSaldoAutorizado();
  await cenario2_doisPedidosExpedirA();
  await cenario3_pedidoBBloqueado();
  await cenario4_cancelarDevolveReserva();
  await cenario5_legadoSemReserva();
  console.log('RC4.1.2 OK — 5 cenários + pedido_id no payload');
}

run().catch((err) => {
  console.error('RC4.1.2 FALHOU:', err);
  process.exit(1);
});
