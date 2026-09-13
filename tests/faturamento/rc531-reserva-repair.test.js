/**
 * RC5.3.1 … RC5.3.5 — Executor de Plano de Correção.
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const {
  executarPlano,
  acaoImplementada,
  AcaoCorrecao,
  RiscoCorrecao,
  ACOES_CONHECIDAS
} = require('../../backend/motores/comercial/ReservaRepairService');
const {
  montarPlanoCorrecao,
  TipoInconsistencia
} = require('../../backend/motores/comercial/ReservaReconciliationService');
const { PedidoStatus } = require('../../backend/services/pedido/enums');

function openDb(file) {
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
    try { db.close(() => resolve()); } catch (_) { resolve(); }
  });
}

async function setupDb() {
  const file = path.join(os.tmpdir(), `rc532-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const db = await openDb(file);

  await run(db, `
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT,
      saldo_fiscal REAL DEFAULT 0,
      saldo_nao_fiscal REAL DEFAULT 0,
      reservado_fiscal REAL DEFAULT 0,
      reservado_nao_fiscal REAL DEFAULT 0,
      controla_estoque INTEGER DEFAULT 1,
      estoque_atual REAL DEFAULT 0
    )
  `);
  await run(db, `
    CREATE TABLE pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT,
      data_pedido DATE,
      total REAL DEFAULT 0,
      status TEXT NOT NULL,
      operador_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(db, `
    CREATE TABLE pedidos_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade REAL NOT NULL,
      preco_unitario REAL DEFAULT 0,
      subtotal REAL DEFAULT 0
    )
  `);
  await run(db, `
    CREATE TABLE pedido_estoque_reservas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_id INTEGER NOT NULL,
      pedido_item_id INTEGER,
      produto_id INTEGER NOT NULL,
      quantidade_fiscal REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ATIVA',
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME
    )
  `);
  await run(db, `
    CREATE TABLE auditoria_pedido_estoque_fiscal (
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
    )
  `);

  return { db, file };
}

async function seedCanceladoComReserva(db, opts = {}) {
  const sf = opts.saldo_fiscal != null ? opts.saldo_fiscal : 40;
  const rf = opts.reservado_fiscal != null ? opts.reservado_fiscal : 8;
  const qtd = opts.quantidade != null ? opts.quantidade : 8;
  const status = opts.status || PedidoStatus.CANCELADO;

  const prod = await run(
    db,
    `INSERT INTO produtos (nome, saldo_fiscal, reservado_fiscal, estoque_atual)
     VALUES ('P', ?, ?, ?)`,
    [sf, rf, sf]
  );
  const produtoId = prod.lastID;
  const ped = await run(
    db,
    `INSERT INTO pedidos (codigo, data_pedido, total, status) VALUES ('X', date('now'), 0, ?)`,
    [status]
  );
  const pedidoId = ped.lastID;
  await run(
    db,
    `INSERT INTO pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario, subtotal)
     VALUES (?, ?, ?, 1, ?)`,
    [pedidoId, produtoId, qtd, qtd]
  );
  const res = await run(
    db,
    `INSERT INTO pedido_estoque_reservas (pedido_id, produto_id, quantidade_fiscal, status)
     VALUES (?, ?, ?, 'ATIVA')`,
    [pedidoId, produtoId, qtd]
  );
  return { produtoId, pedidoId, reservaId: res.lastID, quantidade: qtd };
}

async function testDryRunPadrao() {
  const plano = montarPlanoCorrecao(TipoInconsistencia.PEDIDO_SEM_RESERVA);
  const r = await executarPlano(plano);
  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.dry_run, true);
  assert.strictEqual(r.executaria, true);
}

async function testDryRunTodasAcoes() {
  for (const acao of ACOES_CONHECIDAS) {
    const r = await executarPlano(
      { acao, descricao: acao, risco: RiscoCorrecao.BAIXO },
      { dryRun: true }
    );
    assert.strictEqual(r.sucesso, true, acao);
    assert.strictEqual(r.dry_run, true, acao);
  }
  assert.strictEqual(acaoImplementada(AcaoCorrecao.LIBERAR_RESERVA), true);
  assert.strictEqual(acaoImplementada(AcaoCorrecao.REMOVER_RESERVA), true);
  assert.strictEqual(acaoImplementada(AcaoCorrecao.CRIAR_RESERVA), true);
  assert.strictEqual(acaoImplementada(AcaoCorrecao.AJUSTAR_RESERVA), true);
  assert.strictEqual(acaoImplementada(AcaoCorrecao.ANALISE_MANUAL), false);
}

async function testPlanoDesconhecido() {
  const r = await executarPlano({ acao: 'XYZ' }, { dryRun: true });
  assert.strictEqual(r.codigo, 'PLANO_DESCONHECIDO');
  assert.strictEqual(r.sucesso, false);
}

async function testAcaoNaoImplementada() {
  const r = await executarPlano(
    { acao: AcaoCorrecao.ANALISE_MANUAL, descricao: 'x', risco: 'ALTO' },
    { dryRun: false }
  );
  assert.strictEqual(r.codigo, 'ACAO_NAO_IMPLEMENTADA');
  assert.strictEqual(r.sucesso, false);
}

async function seedPedidoComReserva(db, opts = {}) {
  const sf = opts.saldo_fiscal != null ? opts.saldo_fiscal : 100;
  const rf = opts.reservado_fiscal != null ? opts.reservado_fiscal : (opts.reserva_qtd != null ? opts.reserva_qtd : 10);
  const pedidoQtd = opts.pedido_qtd != null ? opts.pedido_qtd : 10;
  const reservaQtd = opts.reserva_qtd != null ? opts.reserva_qtd : 10;
  const status = opts.status || PedidoStatus.AGUARDANDO_FATURAMENTO;

  const prod = await run(
    db,
    `INSERT INTO produtos (nome, saldo_fiscal, reservado_fiscal, estoque_atual)
     VALUES ('Ajustar', ?, ?, ?)`,
    [sf, rf, sf]
  );
  const produtoId = prod.lastID;
  const ped = await run(
    db,
    `INSERT INTO pedidos (codigo, data_pedido, total, status) VALUES ('A', date('now'), 0, ?)`,
    [status]
  );
  const pedidoId = ped.lastID;
  await run(
    db,
    `INSERT INTO pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario, subtotal)
     VALUES (?, ?, ?, 1, ?)`,
    [pedidoId, produtoId, pedidoQtd, pedidoQtd]
  );
  const res = await run(
    db,
    `INSERT INTO pedido_estoque_reservas (pedido_id, produto_id, quantidade_fiscal, status)
     VALUES (?, ?, ?, 'ATIVA')`,
    [pedidoId, produtoId, reservaQtd]
  );
  return {
    pedidoId,
    produtoId,
    reservaId: res.lastID,
    pedido_qtd: pedidoQtd,
    reserva_qtd: reservaQtd
  };
}

async function seedPedidoSemReserva(db, opts = {}) {
  const sf = opts.saldo_fiscal != null ? opts.saldo_fiscal : 50;
  const rf = opts.reservado_fiscal != null ? opts.reservado_fiscal : 0;
  const qtd = opts.quantidade != null ? opts.quantidade : 10;
  const status = opts.status || PedidoStatus.AGUARDANDO_FATURAMENTO;
  const comProduto = opts.comProduto !== false;

  let produtoId = opts.produto_id != null ? opts.produto_id : null;
  if (comProduto && produtoId == null) {
    const prod = await run(
      db,
      `INSERT INTO produtos (nome, saldo_fiscal, reservado_fiscal, estoque_atual)
       VALUES ('Criar', ?, ?, ?)`,
      [sf, rf, sf]
    );
    produtoId = prod.lastID;
  }

  const ped = await run(
    db,
    `INSERT INTO pedidos (codigo, data_pedido, total, status) VALUES ('C', date('now'), 0, ?)`,
    [status]
  );
  const pedidoId = ped.lastID;

  if (comProduto && produtoId != null && opts.semItem !== true) {
    await run(
      db,
      `INSERT INTO pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario, subtotal)
       VALUES (?, ?, ?, 1, ?)`,
      [pedidoId, produtoId, qtd, qtd]
    );
  }

  return { pedidoId, produtoId, quantidade: qtd };
}

async function seedReservaOrfa(db, opts = {}) {
  const sf = opts.saldo_fiscal != null ? opts.saldo_fiscal : 30;
  const rf = opts.reservado_fiscal != null ? opts.reservado_fiscal : 5;
  const qtd = opts.quantidade != null ? opts.quantidade : 5;
  const pedidoIdFantasma = opts.pedido_id != null ? opts.pedido_id : 99999;

  const prod = await run(
    db,
    `INSERT INTO produtos (nome, saldo_fiscal, reservado_fiscal, estoque_atual)
     VALUES ('Orfa', ?, ?, ?)`,
    [sf, rf, sf]
  );
  const produtoId = prod.lastID;
  const res = await run(
    db,
    `INSERT INTO pedido_estoque_reservas (pedido_id, produto_id, quantidade_fiscal, status)
     VALUES (?, ?, ?, 'ATIVA')`,
    [pedidoIdFantasma, produtoId, qtd]
  );
  return { produtoId, pedidoIdFantasma, reservaId: res.lastID, quantidade: qtd };
}

async function testRemoverSucesso() {
  const { db, file } = await setupDb();
  const seed = await seedReservaOrfa(db);
  const plano = montarPlanoCorrecao(TipoInconsistencia.RESERVA_ORFA);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      reserva_id: seed.reservaId,
      produto_id: seed.produtoId,
      usuario_id: 7
    }
  });

  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.acao, AcaoCorrecao.REMOVER_RESERVA);
  assert.strictEqual(r.detalhes.quantidade_removida, seed.quantidade);
  assert.strictEqual(r.detalhes.reservado_depois, 0);

  const reserva = await get(db, 'SELECT status FROM pedido_estoque_reservas WHERE id = ?', [seed.reservaId]);
  assert.strictEqual(reserva.status, 'CANCELADA');
  const prod = await get(db, 'SELECT reservado_fiscal FROM produtos WHERE id = ?', [seed.produtoId]);
  assert.strictEqual(prod.reservado_fiscal, 0);

  const audits = await all(
    db,
    `SELECT * FROM auditoria_pedido_estoque_fiscal WHERE evento = 'REPARO_REMOVER_RESERVA'`
  );
  assert.strictEqual(audits.length, 1);
  assert.strictEqual(audits[0].usuario_id, 7);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testRemoverComPedidoAssociado() {
  const { db, file } = await setupDb();
  // Reserva ligada a pedido existente → deve bloquear
  const seed = await seedCanceladoComReserva(db, {
    status: PedidoStatus.AGUARDANDO_FATURAMENTO
  });
  const plano = montarPlanoCorrecao(TipoInconsistencia.RESERVA_ORFA);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: { reserva_id: seed.reservaId }
  });

  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(r.codigo, 'PEDIDO_ASSOCIADO');
  const reserva = await get(db, 'SELECT status FROM pedido_estoque_reservas WHERE id = ?', [seed.reservaId]);
  assert.strictEqual(reserva.status, 'ATIVA');

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testRemoverReservaInexistente() {
  const { db, file } = await setupDb();
  const plano = montarPlanoCorrecao(TipoInconsistencia.RESERVA_ORFA);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: { reserva_id: 88888 }
  });

  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(r.codigo, 'RESERVA_INEXISTENTE');

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testRemoverSaldoInconsistente() {
  const { db, file } = await setupDb();
  const seed = await seedReservaOrfa(db, {
    reservado_fiscal: 1,
    quantidade: 5,
    saldo_fiscal: 20
  });
  const plano = montarPlanoCorrecao(TipoInconsistencia.RESERVA_ORFA);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: { reserva_id: seed.reservaId }
  });

  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(r.codigo, 'SALDO_INCONSISTENTE');
  const reserva = await get(db, 'SELECT status FROM pedido_estoque_reservas WHERE id = ?', [seed.reservaId]);
  assert.strictEqual(reserva.status, 'ATIVA');

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testRemoverDryRunSemMutacao() {
  const { db, file } = await setupDb();
  const seed = await seedReservaOrfa(db);
  const plano = montarPlanoCorrecao(TipoInconsistencia.RESERVA_ORFA);

  const r = await executarPlano(plano, {
    dryRun: true,
    db,
    contexto: { reserva_id: seed.reservaId }
  });

  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.dry_run, true);
  assert.strictEqual(r.executaria, true);

  const reserva = await get(db, 'SELECT status FROM pedido_estoque_reservas WHERE id = ?', [seed.reservaId]);
  assert.strictEqual(reserva.status, 'ATIVA');
  const prod = await get(db, 'SELECT reservado_fiscal FROM produtos WHERE id = ?', [seed.produtoId]);
  assert.strictEqual(prod.reservado_fiscal, 5);
  const audits = await all(db, 'SELECT COUNT(*) AS c FROM auditoria_pedido_estoque_fiscal');
  assert.strictEqual(audits[0].c, 0);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testLiberarSucesso() {
  const { db, file } = await setupDb();
  const seed = await seedCanceladoComReserva(db);
  const plano = montarPlanoCorrecao(TipoInconsistencia.PEDIDO_CANCELADO_COM_RESERVA_ATIVA);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      reserva_id: seed.reservaId,
      produto_id: seed.produtoId,
      usuario_id: 42
    }
  });

  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.acao, AcaoCorrecao.LIBERAR_RESERVA);
  assert.strictEqual(r.dry_run, false);
  assert.strictEqual(r.detalhes.quantidade_liberada, seed.quantidade);
  assert.strictEqual(r.detalhes.reservado_depois, 0);

  const reserva = await get(db, 'SELECT status FROM pedido_estoque_reservas WHERE id = ?', [seed.reservaId]);
  assert.strictEqual(reserva.status, 'CANCELADA');

  const prod = await get(db, 'SELECT reservado_fiscal, saldo_fiscal FROM produtos WHERE id = ?', [seed.produtoId]);
  assert.strictEqual(prod.reservado_fiscal, 0);
  assert.strictEqual(prod.saldo_fiscal, 40);

  const audits = await all(
    db,
    `SELECT * FROM auditoria_pedido_estoque_fiscal WHERE evento = 'REPARO_LIBERAR_RESERVA'`
  );
  assert.strictEqual(audits.length, 1);
  assert.strictEqual(audits[0].pedido_id, seed.pedidoId);
  assert.strictEqual(audits[0].usuario_id, 42);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testLiberarPedidoAtivo() {
  const { db, file } = await setupDb();
  const seed = await seedCanceladoComReserva(db, {
    status: PedidoStatus.AGUARDANDO_FATURAMENTO
  });
  const plano = montarPlanoCorrecao(TipoInconsistencia.PEDIDO_CANCELADO_COM_RESERVA_ATIVA);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      reserva_id: seed.reservaId
    }
  });

  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(r.codigo, 'PEDIDO_NAO_CANCELADO');

  const reserva = await get(db, 'SELECT status FROM pedido_estoque_reservas WHERE id = ?', [seed.reservaId]);
  assert.strictEqual(reserva.status, 'ATIVA');
  const prod = await get(db, 'SELECT reservado_fiscal FROM produtos WHERE id = ?', [seed.produtoId]);
  assert.strictEqual(prod.reservado_fiscal, 8);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testLiberarReservaInexistente() {
  const { db, file } = await setupDb();
  const plano = montarPlanoCorrecao(TipoInconsistencia.PEDIDO_CANCELADO_COM_RESERVA_ATIVA);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: { pedido_id: 1, reserva_id: 99999 }
  });

  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(r.codigo, 'RESERVA_INEXISTENTE');

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testLiberarDryRunNaoAlteraBanco() {
  const { db, file } = await setupDb();
  const seed = await seedCanceladoComReserva(db);
  const plano = montarPlanoCorrecao(TipoInconsistencia.PEDIDO_CANCELADO_COM_RESERVA_ATIVA);

  const r = await executarPlano(plano, {
    dryRun: true,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      reserva_id: seed.reservaId
    }
  });

  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.dry_run, true);
  assert.strictEqual(r.executaria, true);

  const reserva = await get(db, 'SELECT status FROM pedido_estoque_reservas WHERE id = ?', [seed.reservaId]);
  assert.strictEqual(reserva.status, 'ATIVA');
  const prod = await get(db, 'SELECT reservado_fiscal FROM produtos WHERE id = ?', [seed.produtoId]);
  assert.strictEqual(prod.reservado_fiscal, 8);
  const audits = await all(db, 'SELECT COUNT(*) AS c FROM auditoria_pedido_estoque_fiscal');
  assert.strictEqual(audits[0].c, 0);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testLiberarSaldoInconsistente() {
  const { db, file } = await setupDb();
  // reservado_fiscal menor que a quantidade da reserva
  const seed = await seedCanceladoComReserva(db, {
    reservado_fiscal: 2,
    quantidade: 8,
    saldo_fiscal: 40
  });
  const plano = montarPlanoCorrecao(TipoInconsistencia.PEDIDO_CANCELADO_COM_RESERVA_ATIVA);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: { pedido_id: seed.pedidoId, reserva_id: seed.reservaId }
  });

  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(r.codigo, 'SALDO_INCONSISTENTE');
  const reserva = await get(db, 'SELECT status FROM pedido_estoque_reservas WHERE id = ?', [seed.reservaId]);
  assert.strictEqual(reserva.status, 'ATIVA');

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testCriarSucesso() {
  const { db, file } = await setupDb();
  const seed = await seedPedidoSemReserva(db, { saldo_fiscal: 50, quantidade: 10 });
  const plano = montarPlanoCorrecao(TipoInconsistencia.PEDIDO_SEM_RESERVA);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      produto_id: seed.produtoId,
      pedido_quantidade: seed.quantidade,
      usuario_id: 15
    }
  });

  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.acao, AcaoCorrecao.CRIAR_RESERVA);
  assert.strictEqual(r.detalhes.quantidade_criada, 10);
  assert.strictEqual(r.detalhes.reservado_depois, 10);
  assert.ok(r.detalhes.reserva_id);

  const reserva = await get(
    db,
    `SELECT * FROM pedido_estoque_reservas WHERE id = ?`,
    [r.detalhes.reserva_id]
  );
  assert.strictEqual(reserva.status, 'ATIVA');
  assert.strictEqual(reserva.quantidade_fiscal, 10);

  const prod = await get(db, 'SELECT reservado_fiscal, saldo_fiscal FROM produtos WHERE id = ?', [seed.produtoId]);
  assert.strictEqual(prod.reservado_fiscal, 10);
  assert.strictEqual(prod.saldo_fiscal, 50);

  const audits = await all(
    db,
    `SELECT * FROM auditoria_pedido_estoque_fiscal WHERE evento = 'REPARO_CRIAR_RESERVA'`
  );
  assert.strictEqual(audits.length, 1);
  assert.strictEqual(audits[0].usuario_id, 15);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testCriarPedidoCancelado() {
  const { db, file } = await setupDb();
  const seed = await seedPedidoSemReserva(db, { status: PedidoStatus.CANCELADO });
  const plano = montarPlanoCorrecao(TipoInconsistencia.PEDIDO_SEM_RESERVA);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      produto_id: seed.produtoId,
      pedido_quantidade: seed.quantidade
    }
  });

  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(r.codigo, 'PEDIDO_CANCELADO');
  const count = await get(db, 'SELECT COUNT(*) AS c FROM pedido_estoque_reservas');
  assert.strictEqual(count.c, 0);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testCriarReservaExistente() {
  const { db, file } = await setupDb();
  const seed = await seedPedidoSemReserva(db, { saldo_fiscal: 50, quantidade: 10 });
  await run(
    db,
    `INSERT INTO pedido_estoque_reservas (pedido_id, produto_id, quantidade_fiscal, status)
     VALUES (?, ?, 10, 'ATIVA')`,
    [seed.pedidoId, seed.produtoId]
  );
  await run(db, `UPDATE produtos SET reservado_fiscal = 10 WHERE id = ?`, [seed.produtoId]);

  const plano = montarPlanoCorrecao(TipoInconsistencia.PEDIDO_SEM_RESERVA);
  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      produto_id: seed.produtoId,
      pedido_quantidade: 10
    }
  });

  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(r.codigo, 'RESERVA_JA_EXISTENTE');

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testCriarSaldoInsuficiente() {
  const { db, file } = await setupDb();
  const seed = await seedPedidoSemReserva(db, {
    saldo_fiscal: 5,
    reservado_fiscal: 0,
    quantidade: 10
  });
  const plano = montarPlanoCorrecao(TipoInconsistencia.PEDIDO_SEM_RESERVA);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      produto_id: seed.produtoId,
      pedido_quantidade: 10
    }
  });

  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(r.codigo, 'SALDO_INSUFICIENTE');
  const count = await get(db, 'SELECT COUNT(*) AS c FROM pedido_estoque_reservas');
  assert.strictEqual(count.c, 0);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testCriarProdutoInexistente() {
  const { db, file } = await setupDb();
  const seed = await seedPedidoSemReserva(db, { comProduto: false, semItem: true });
  // pedido sem produto real
  const plano = montarPlanoCorrecao(TipoInconsistencia.PEDIDO_SEM_RESERVA);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      produto_id: 77777,
      pedido_quantidade: 5
    }
  });

  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(r.codigo, 'PRODUTO_INEXISTENTE');

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testCriarQuantidadeInvalida() {
  const { db, file } = await setupDb();
  const seed = await seedPedidoSemReserva(db, { quantidade: 10 });
  const plano = montarPlanoCorrecao(TipoInconsistencia.PEDIDO_SEM_RESERVA);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      produto_id: seed.produtoId,
      pedido_quantidade: 0
    }
  });

  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(r.codigo, 'QUANTIDADE_INVALIDA');

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testCriarDryRun() {
  const { db, file } = await setupDb();
  const seed = await seedPedidoSemReserva(db);
  const plano = montarPlanoCorrecao(TipoInconsistencia.PEDIDO_SEM_RESERVA);

  const r = await executarPlano(plano, {
    dryRun: true,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      produto_id: seed.produtoId,
      pedido_quantidade: seed.quantidade
    }
  });

  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.dry_run, true);
  assert.strictEqual(r.executaria, true);
  const count = await get(db, 'SELECT COUNT(*) AS c FROM pedido_estoque_reservas');
  assert.strictEqual(count.c, 0);
  const prod = await get(db, 'SELECT reservado_fiscal FROM produtos WHERE id = ?', [seed.produtoId]);
  assert.strictEqual(prod.reservado_fiscal, 0);
  const audits = await all(db, 'SELECT COUNT(*) AS c FROM auditoria_pedido_estoque_fiscal');
  assert.strictEqual(audits[0].c, 0);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testAjustarAumento() {
  const { db, file } = await setupDb();
  const seed = await seedPedidoComReserva(db, {
    saldo_fiscal: 100,
    reserva_qtd: 5,
    pedido_qtd: 20,
    reservado_fiscal: 5
  });
  const plano = montarPlanoCorrecao(TipoInconsistencia.RESERVA_MAIOR_QUE_PEDIDO);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      produto_id: seed.produtoId,
      reserva_id: seed.reservaId,
      pedido_quantidade: 20,
      usuario_id: 3
    }
  });

  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.acao, AcaoCorrecao.AJUSTAR_RESERVA);
  assert.strictEqual(r.detalhes.diferenca, 15);
  assert.strictEqual(r.detalhes.reserva_quantidade_depois, 20);
  assert.strictEqual(r.detalhes.reservado_depois, 20);

  const reserva = await get(db, 'SELECT quantidade_fiscal FROM pedido_estoque_reservas WHERE id = ?', [seed.reservaId]);
  assert.strictEqual(reserva.quantidade_fiscal, 20);
  const prod = await get(db, 'SELECT reservado_fiscal FROM produtos WHERE id = ?', [seed.produtoId]);
  assert.strictEqual(prod.reservado_fiscal, 20);
  const audits = await all(db, `SELECT * FROM auditoria_pedido_estoque_fiscal WHERE evento = 'REPARO_AJUSTAR_RESERVA'`);
  assert.strictEqual(audits.length, 1);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testAjustarReducao() {
  const { db, file } = await setupDb();
  const seed = await seedPedidoComReserva(db, {
    saldo_fiscal: 100,
    reserva_qtd: 20,
    pedido_qtd: 5,
    reservado_fiscal: 20
  });
  const plano = montarPlanoCorrecao(TipoInconsistencia.RESERVA_MAIOR_QUE_PEDIDO);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      produto_id: seed.produtoId,
      reserva_id: seed.reservaId,
      pedido_quantidade: 5
    }
  });

  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.detalhes.diferenca, -15);
  assert.strictEqual(r.detalhes.reserva_quantidade_depois, 5);
  assert.strictEqual(r.detalhes.reservado_depois, 5);

  const reserva = await get(db, 'SELECT quantidade_fiscal FROM pedido_estoque_reservas WHERE id = ?', [seed.reservaId]);
  assert.strictEqual(reserva.quantidade_fiscal, 5);
  const prod = await get(db, 'SELECT reservado_fiscal FROM produtos WHERE id = ?', [seed.produtoId]);
  assert.strictEqual(prod.reservado_fiscal, 5);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testAjustarSemAlteracoes() {
  const { db, file } = await setupDb();
  const seed = await seedPedidoComReserva(db, {
    reserva_qtd: 10,
    pedido_qtd: 10,
    reservado_fiscal: 10
  });
  const plano = montarPlanoCorrecao(TipoInconsistencia.RESERVA_MAIOR_QUE_PEDIDO);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      reserva_id: seed.reservaId,
      pedido_quantidade: 10
    }
  });

  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.codigo, 'SEM_ALTERACOES');
  const audits = await all(db, 'SELECT COUNT(*) AS c FROM auditoria_pedido_estoque_fiscal');
  assert.strictEqual(audits[0].c, 0);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testAjustarSaldoInsuficiente() {
  const { db, file } = await setupDb();
  const seed = await seedPedidoComReserva(db, {
    saldo_fiscal: 12,
    reserva_qtd: 10,
    pedido_qtd: 20,
    reservado_fiscal: 10
  });
  // disponível = 12-10 = 2, aumento = 10 → insuficiente
  const plano = montarPlanoCorrecao(TipoInconsistencia.RESERVA_MAIOR_QUE_PEDIDO);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      reserva_id: seed.reservaId,
      pedido_quantidade: 20
    }
  });

  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(r.codigo, 'SALDO_INSUFICIENTE');
  const reserva = await get(db, 'SELECT quantidade_fiscal FROM pedido_estoque_reservas WHERE id = ?', [seed.reservaId]);
  assert.strictEqual(reserva.quantidade_fiscal, 10);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testAjustarPedidoCancelado() {
  const { db, file } = await setupDb();
  const seed = await seedPedidoComReserva(db, {
    status: PedidoStatus.CANCELADO,
    reserva_qtd: 8,
    pedido_qtd: 5
  });
  const plano = montarPlanoCorrecao(TipoInconsistencia.RESERVA_MAIOR_QUE_PEDIDO);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      reserva_id: seed.reservaId,
      pedido_quantidade: 5
    }
  });

  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(r.codigo, 'PEDIDO_CANCELADO');

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testAjustarReservaInexistente() {
  const { db, file } = await setupDb();
  const seed = await seedPedidoSemReserva(db);
  const plano = montarPlanoCorrecao(TipoInconsistencia.RESERVA_MAIOR_QUE_PEDIDO);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      produto_id: seed.produtoId,
      reserva_id: 99999,
      pedido_quantidade: 5
    }
  });

  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(r.codigo, 'RESERVA_INEXISTENTE');

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testAjustarProdutoInexistente() {
  const { db, file } = await setupDb();
  const ped = await run(
    db,
    `INSERT INTO pedidos (codigo, data_pedido, total, status) VALUES ('Z', date('now'), 0, ?)`,
    [PedidoStatus.AGUARDANDO_FATURAMENTO]
  );
  const pedidoId = ped.lastID;
  const res = await run(
    db,
    `INSERT INTO pedido_estoque_reservas (pedido_id, produto_id, quantidade_fiscal, status)
     VALUES (?, 55555, 5, 'ATIVA')`,
    [pedidoId]
  );
  const plano = montarPlanoCorrecao(TipoInconsistencia.RESERVA_MAIOR_QUE_PEDIDO);

  const r = await executarPlano(plano, {
    dryRun: false,
    db,
    contexto: {
      pedido_id: pedidoId,
      reserva_id: res.lastID,
      pedido_quantidade: 8
    }
  });

  assert.strictEqual(r.sucesso, false);
  assert.strictEqual(r.codigo, 'PRODUTO_INEXISTENTE');

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testAjustarDryRun() {
  const { db, file } = await setupDb();
  const seed = await seedPedidoComReserva(db, {
    reserva_qtd: 20,
    pedido_qtd: 5,
    reservado_fiscal: 20
  });
  const plano = montarPlanoCorrecao(TipoInconsistencia.RESERVA_MAIOR_QUE_PEDIDO);

  const r = await executarPlano(plano, {
    dryRun: true,
    db,
    contexto: {
      pedido_id: seed.pedidoId,
      reserva_id: seed.reservaId,
      pedido_quantidade: 5
    }
  });

  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.dry_run, true);
  const reserva = await get(db, 'SELECT quantidade_fiscal FROM pedido_estoque_reservas WHERE id = ?', [seed.reservaId]);
  assert.strictEqual(reserva.quantidade_fiscal, 20);
  const prod = await get(db, 'SELECT reservado_fiscal FROM produtos WHERE id = ?', [seed.produtoId]);
  assert.strictEqual(prod.reservado_fiscal, 20);
  const audits = await all(db, 'SELECT COUNT(*) AS c FROM auditoria_pedido_estoque_fiscal');
  assert.strictEqual(audits[0].c, 0);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function main() {
  const testes = [
    ['DRY_RUN padrão', testDryRunPadrao],
    ['DRY_RUN todas as ações', testDryRunTodasAcoes],
    ['plano desconhecido', testPlanoDesconhecido],
    ['ação não implementada (ANALISE_MANUAL)', testAcaoNaoImplementada],
    ['LIBERAR_RESERVA sucesso', testLiberarSucesso],
    ['LIBERAR_RESERVA pedido ativo', testLiberarPedidoAtivo],
    ['LIBERAR_RESERVA reserva inexistente', testLiberarReservaInexistente],
    ['LIBERAR_RESERVA dryRun sem alterar banco', testLiberarDryRunNaoAlteraBanco],
    ['LIBERAR_RESERVA saldo inconsistente', testLiberarSaldoInconsistente],
    ['REMOVER_RESERVA sucesso', testRemoverSucesso],
    ['REMOVER_RESERVA com pedido (bloqueia)', testRemoverComPedidoAssociado],
    ['REMOVER_RESERVA reserva inexistente', testRemoverReservaInexistente],
    ['REMOVER_RESERVA saldo inconsistente', testRemoverSaldoInconsistente],
    ['REMOVER_RESERVA dryRun sem mutação', testRemoverDryRunSemMutacao],
    ['CRIAR_RESERVA sucesso', testCriarSucesso],
    ['CRIAR_RESERVA pedido cancelado', testCriarPedidoCancelado],
    ['CRIAR_RESERVA reserva existente', testCriarReservaExistente],
    ['CRIAR_RESERVA saldo insuficiente', testCriarSaldoInsuficiente],
    ['CRIAR_RESERVA produto inexistente', testCriarProdutoInexistente],
    ['CRIAR_RESERVA quantidade inválida', testCriarQuantidadeInvalida],
    ['CRIAR_RESERVA dryRun', testCriarDryRun],
    ['AJUSTAR_RESERVA aumento', testAjustarAumento],
    ['AJUSTAR_RESERVA redução', testAjustarReducao],
    ['AJUSTAR_RESERVA sem alterações', testAjustarSemAlteracoes],
    ['AJUSTAR_RESERVA saldo insuficiente', testAjustarSaldoInsuficiente],
    ['AJUSTAR_RESERVA pedido cancelado', testAjustarPedidoCancelado],
    ['AJUSTAR_RESERVA reserva inexistente', testAjustarReservaInexistente],
    ['AJUSTAR_RESERVA produto inexistente', testAjustarProdutoInexistente],
    ['AJUSTAR_RESERVA dryRun', testAjustarDryRun]
  ];

  let falhas = 0;
  for (const [nome, fn] of testes) {
    try {
      await fn();
      console.log(`✓ ${nome}`);
    } catch (err) {
      falhas += 1;
      console.error(`✗ ${nome}`);
      console.error(err);
    }
  }
  if (falhas) {
    console.error(`\n${falhas} teste(s) falharam`);
    process.exit(1);
  }
  console.log('\nRC5.3.5 homologada com sucesso.');
  process.exit(0);
}

main();
