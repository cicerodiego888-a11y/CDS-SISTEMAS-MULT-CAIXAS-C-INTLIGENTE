/**
 * RC5.2.1 / RC5.2.2 / RC5.2.3 — Reconciliação de Reservas
 * (READ-ONLY + evidências + plano de correção simulado).
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const {
  reconciliarReservas,
  TipoInconsistencia,
  EncontradoEm,
  AcaoCorrecao,
  RiscoCorrecao,
  montarPlanoCorrecao
} = require('../../backend/motores/comercial/ReservaReconciliationService');
const { PedidoStatus } = require('../../backend/services/pedido/enums');

const CAMPOS_EVIDENCIA = [
  'pedido_id',
  'produto_id',
  'tipo',
  'descricao',
  'pedido_quantidade',
  'reserva_quantidade',
  'saldo_fiscal',
  'status_pedido',
  'reserva_id',
  'encontrado_em',
  'data_criacao',
  'data_reserva',
  'usuario',
  'plano_correcao'
];

/** Mapeamento esperado RC5.2.3 (acao / risco / executavel). */
const PLANO_ESPERADO = Object.freeze({
  [TipoInconsistencia.PEDIDO_SEM_RESERVA]: {
    acao: AcaoCorrecao.CRIAR_RESERVA,
    risco: RiscoCorrecao.MEDIO,
    executavel: true
  },
  [TipoInconsistencia.RESERVA_INEXISTENTE]: {
    acao: AcaoCorrecao.CRIAR_RESERVA,
    risco: RiscoCorrecao.MEDIO,
    executavel: true
  },
  [TipoInconsistencia.RESERVA_ORFA]: {
    acao: AcaoCorrecao.REMOVER_RESERVA,
    risco: RiscoCorrecao.BAIXO,
    executavel: true
  },
  [TipoInconsistencia.RESERVA_MAIOR_QUE_PEDIDO]: {
    acao: AcaoCorrecao.AJUSTAR_RESERVA,
    risco: RiscoCorrecao.MEDIO,
    executavel: true
  },
  [TipoInconsistencia.RESERVA_QUANTIDADE_INVALIDA]: {
    acao: AcaoCorrecao.AJUSTAR_RESERVA,
    risco: RiscoCorrecao.MEDIO,
    executavel: true
  },
  [TipoInconsistencia.PEDIDO_CANCELADO_COM_RESERVA_ATIVA]: {
    acao: AcaoCorrecao.LIBERAR_RESERVA,
    risco: RiscoCorrecao.BAIXO,
    executavel: true
  },
  [TipoInconsistencia.SALDO_FISCAL_NEGATIVO]: {
    acao: AcaoCorrecao.ANALISE_MANUAL,
    risco: RiscoCorrecao.ALTO,
    executavel: false
  },
  [TipoInconsistencia.PRODUTO_INEXISTENTE]: {
    acao: AcaoCorrecao.ANALISE_MANUAL,
    risco: RiscoCorrecao.ALTO,
    executavel: false
  }
});

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

function closeDb(db) {
  return new Promise((resolve) => {
    try { db.close(() => resolve()); } catch (_) { resolve(); }
  });
}

async function setupDb() {
  const file = path.join(os.tmpdir(), `rc523-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
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
      status TEXT NOT NULL DEFAULT 'AGUARDANDO_FATURAMENTO',
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

  return { db, file };
}

async function criarProduto(db, opts = {}) {
  const r = await run(
    db,
    `INSERT INTO produtos (nome, saldo_fiscal, saldo_nao_fiscal, reservado_fiscal, estoque_atual)
     VALUES (?, ?, ?, ?, ?)`,
    [
      opts.nome || 'Produto',
      opts.saldo_fiscal != null ? opts.saldo_fiscal : 100,
      opts.saldo_nao_fiscal != null ? opts.saldo_nao_fiscal : 0,
      opts.reservado_fiscal != null ? opts.reservado_fiscal : 0,
      opts.estoque_atual != null ? opts.estoque_atual : 100
    ]
  );
  return r.lastID;
}

async function criarPedido(db, status, itens, opts = {}) {
  const p = await run(
    db,
    `INSERT INTO pedidos (codigo, data_pedido, total, status, operador_id, created_at)
     VALUES (?, date('now'), 0, ?, ?, CURRENT_TIMESTAMP)`,
    [
      `P-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      status,
      opts.operador_id != null ? opts.operador_id : 7
    ]
  );
  const pedidoId = p.lastID;
  for (const item of itens) {
    await run(
      db,
      `INSERT INTO pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario, subtotal)
       VALUES (?, ?, ?, 1, ?)`,
      [pedidoId, item.produto_id, item.quantidade, item.quantidade]
    );
  }
  return pedidoId;
}

async function criarReserva(db, pedidoId, produtoId, quantidade, status = 'ATIVA') {
  const r = await run(
    db,
    `INSERT INTO pedido_estoque_reservas (pedido_id, produto_id, quantidade_fiscal, status, criado_em)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [pedidoId, produtoId, quantidade, status]
  );
  return r.lastID;
}

function assertTemTipo(relatorio, tipo) {
  const hit = relatorio.inconsistencias.find((i) => i.tipo === tipo);
  assert.ok(hit, `esperava inconsistência ${tipo}, veio: ${JSON.stringify(relatorio.inconsistencias)}`);
  return hit;
}

function assertPlano(hit, esperado) {
  assert.ok(hit.plano_correcao, 'plano_correcao ausente');
  assert.strictEqual(hit.plano_correcao.acao, esperado.acao, `acao de ${hit.tipo}`);
  assert.strictEqual(hit.plano_correcao.risco, esperado.risco, `risco de ${hit.tipo}`);
  assert.strictEqual(hit.plano_correcao.executavel, esperado.executavel, `executavel de ${hit.tipo}`);
  assert.ok(typeof hit.plano_correcao.descricao === 'string' && hit.plano_correcao.descricao.length > 0);
}

function assertEvidencias(hit, esperados = {}) {
  for (const campo of CAMPOS_EVIDENCIA) {
    assert.ok(Object.prototype.hasOwnProperty.call(hit, campo), `faltou campo ${campo}`);
  }
  for (const [k, v] of Object.entries(esperados)) {
    assert.strictEqual(hit[k], v, `campo ${k}`);
  }
  const planoEsp = PLANO_ESPERADO[hit.tipo];
  if (planoEsp) assertPlano(hit, planoEsp);
}

async function testCenarioConsistente() {
  const { db, file } = await setupDb();
  const produtoId = await criarProduto(db, { saldo_fiscal: 50, reservado_fiscal: 10 });
  const pedidoId = await criarPedido(db, PedidoStatus.AGUARDANDO_FATURAMENTO, [
    { produto_id: produtoId, quantidade: 10 }
  ]);
  await criarReserva(db, pedidoId, produtoId, 10);

  const rel = await reconciliarReservas({ db, pedidoIds: [pedidoId] });
  assert.strictEqual(rel.analisados, 1);
  assert.strictEqual(rel.consistentes, 1);
  assert.strictEqual(rel.inconsistencias.length, 0);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testPedidoSemReserva() {
  const { db, file } = await setupDb();
  const produtoId = await criarProduto(db, { saldo_fiscal: 80 });
  const pedidoId = await criarPedido(db, PedidoStatus.AGUARDANDO_FATURAMENTO, [
    { produto_id: produtoId, quantidade: 5 }
  ], { operador_id: 11 });

  const rel = await reconciliarReservas({ db, pedidoIds: [pedidoId] });
  assert.ok(rel.analisados >= 1);
  assert.strictEqual(rel.consistentes, 0);

  const hit = assertTemTipo(rel, TipoInconsistencia.PEDIDO_SEM_RESERVA);
  assertEvidencias(hit, {
    pedido_id: pedidoId,
    produto_id: produtoId,
    pedido_quantidade: 5,
    reserva_quantidade: null,
    saldo_fiscal: 80,
    status_pedido: PedidoStatus.AGUARDANDO_FATURAMENTO,
    reserva_id: null,
    encontrado_em: EncontradoEm.PEDIDO,
    usuario: 11
  });
  assertPlano(hit, PLANO_ESPERADO[TipoInconsistencia.PEDIDO_SEM_RESERVA]);

  const hitInex = assertTemTipo(rel, TipoInconsistencia.RESERVA_INEXISTENTE);
  assertEvidencias(hitInex, {
    pedido_id: pedidoId,
    produto_id: produtoId,
    encontrado_em: EncontradoEm.RESERVA,
    reserva_id: null
  });
  assertPlano(hitInex, PLANO_ESPERADO[TipoInconsistencia.RESERVA_INEXISTENTE]);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testReservaOrfa() {
  const { db, file } = await setupDb();
  const produtoId = await criarProduto(db, { saldo_fiscal: 12 });
  const pedidoInexistente = 99999;
  const reservaId = await criarReserva(db, pedidoInexistente, produtoId, 3);

  const rel = await reconciliarReservas({ db, pedidoIds: [pedidoInexistente] });
  const hit = assertTemTipo(rel, TipoInconsistencia.RESERVA_ORFA);
  assertEvidencias(hit, {
    pedido_id: pedidoInexistente,
    produto_id: produtoId,
    pedido_quantidade: null,
    reserva_quantidade: 3,
    saldo_fiscal: 12,
    status_pedido: null,
    reserva_id: reservaId,
    encontrado_em: EncontradoEm.RESERVA
  });
  assertPlano(hit, PLANO_ESPERADO[TipoInconsistencia.RESERVA_ORFA]);
  assert.strictEqual(rel.consistentes, 0);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testReservaMaiorQuePedido() {
  const { db, file } = await setupDb();
  const produtoId = await criarProduto(db, { saldo_fiscal: 100, reservado_fiscal: 20 });
  const pedidoId = await criarPedido(db, PedidoStatus.AGUARDANDO_FATURAMENTO, [
    { produto_id: produtoId, quantidade: 5 }
  ], { operador_id: 3 });
  const reservaId = await criarReserva(db, pedidoId, produtoId, 20);

  const rel = await reconciliarReservas({ db, pedidoIds: [pedidoId] });
  const hit = assertTemTipo(rel, TipoInconsistencia.RESERVA_MAIOR_QUE_PEDIDO);
  assertEvidencias(hit, {
    pedido_id: pedidoId,
    produto_id: produtoId,
    pedido_quantidade: 5,
    reserva_quantidade: 20,
    saldo_fiscal: 100,
    status_pedido: PedidoStatus.AGUARDANDO_FATURAMENTO,
    reserva_id: reservaId,
    encontrado_em: EncontradoEm.RESERVA,
    usuario: 3
  });
  assertPlano(hit, PLANO_ESPERADO[TipoInconsistencia.RESERVA_MAIOR_QUE_PEDIDO]);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testPedidoCanceladoComReservaAtiva() {
  const { db, file } = await setupDb();
  const produtoId = await criarProduto(db, { saldo_fiscal: 40, reservado_fiscal: 8 });
  const pedidoId = await criarPedido(db, PedidoStatus.CANCELADO, [
    { produto_id: produtoId, quantidade: 8 }
  ], { operador_id: 9 });
  const reservaId = await criarReserva(db, pedidoId, produtoId, 8);

  const rel = await reconciliarReservas({ db, pedidoIds: [pedidoId] });
  const hit = assertTemTipo(rel, TipoInconsistencia.PEDIDO_CANCELADO_COM_RESERVA_ATIVA);
  assertEvidencias(hit, {
    pedido_id: pedidoId,
    produto_id: produtoId,
    pedido_quantidade: 8,
    reserva_quantidade: 8,
    saldo_fiscal: 40,
    status_pedido: PedidoStatus.CANCELADO,
    reserva_id: reservaId,
    encontrado_em: EncontradoEm.PEDIDO,
    usuario: 9
  });
  assertPlano(hit, PLANO_ESPERADO[TipoInconsistencia.PEDIDO_CANCELADO_COM_RESERVA_ATIVA]);
  assert.strictEqual(rel.consistentes, 0);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testReservaQuantidadeInvalida() {
  const { db, file } = await setupDb();
  const produtoId = await criarProduto(db, { saldo_fiscal: 10 });
  const pedidoId = await criarPedido(db, PedidoStatus.AGUARDANDO_FATURAMENTO, [
    { produto_id: produtoId, quantidade: 2 }
  ]);
  const reservaId = await criarReserva(db, pedidoId, produtoId, 0);

  const rel = await reconciliarReservas({ db, pedidoIds: [pedidoId] });
  const hit = assertTemTipo(rel, TipoInconsistencia.RESERVA_QUANTIDADE_INVALIDA);
  assertEvidencias(hit, {
    pedido_id: pedidoId,
    produto_id: produtoId,
    reserva_quantidade: 0,
    reserva_id: reservaId,
    encontrado_em: EncontradoEm.RESERVA,
    saldo_fiscal: 10
  });
  assertPlano(hit, PLANO_ESPERADO[TipoInconsistencia.RESERVA_QUANTIDADE_INVALIDA]);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testSaldoFiscalNegativo() {
  const { db, file } = await setupDb();
  const produtoId = await criarProduto(db, { saldo_fiscal: -5, reservado_fiscal: 2 });
  const pedidoId = await criarPedido(db, PedidoStatus.AGUARDANDO_FATURAMENTO, [
    { produto_id: produtoId, quantidade: 2 }
  ]);
  const reservaId = await criarReserva(db, pedidoId, produtoId, 2);

  const rel = await reconciliarReservas({ db, pedidoIds: [pedidoId] });
  const hit = assertTemTipo(rel, TipoInconsistencia.SALDO_FISCAL_NEGATIVO);
  assertEvidencias(hit, {
    pedido_id: pedidoId,
    produto_id: produtoId,
    saldo_fiscal: -5,
    reserva_id: reservaId,
    encontrado_em: EncontradoEm.ESTOQUE,
    pedido_quantidade: 2,
    reserva_quantidade: 2
  });
  assertPlano(hit, PLANO_ESPERADO[TipoInconsistencia.SALDO_FISCAL_NEGATIVO]);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testProdutoInexistente() {
  const { db, file } = await setupDb();
  const pedidoId = await criarPedido(db, PedidoStatus.AGUARDANDO_FATURAMENTO, []);
  const produtoFantasma = 888;
  await run(
    db,
    `INSERT INTO pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario, subtotal)
     VALUES (?, ?, 1, 1, 1)`,
    [pedidoId, produtoFantasma]
  );
  const reservaId = await criarReserva(db, pedidoId, produtoFantasma, 1);

  const rel = await reconciliarReservas({ db, pedidoIds: [pedidoId] });
  const hit = assertTemTipo(rel, TipoInconsistencia.PRODUTO_INEXISTENTE);
  assertEvidencias(hit, {
    pedido_id: pedidoId,
    produto_id: produtoFantasma,
    reserva_id: reservaId,
    saldo_fiscal: null,
    encontrado_em: EncontradoEm.ESTOQUE
  });
  assertPlano(hit, PLANO_ESPERADO[TipoInconsistencia.PRODUTO_INEXISTENTE]);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testSomenteLeituraNaoMutates() {
  const { db, file } = await setupDb();
  const produtoId = await criarProduto(db, { saldo_fiscal: 10, reservado_fiscal: 2 });
  const pedidoId = await criarPedido(db, PedidoStatus.AGUARDANDO_FATURAMENTO, [
    { produto_id: produtoId, quantidade: 2 }
  ]);
  await criarReserva(db, pedidoId, produtoId, 2);

  await reconciliarReservas({ db, pedidoIds: [pedidoId] });

  const get = (sql, params) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
  const prod = await get('SELECT saldo_fiscal, reservado_fiscal FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.saldo_fiscal, 10);
  assert.strictEqual(prod.reservado_fiscal, 2);
  const res = await get(
    'SELECT status, quantidade_fiscal FROM pedido_estoque_reservas WHERE pedido_id = ?',
    [pedidoId]
  );
  assert.strictEqual(res.status, 'ATIVA');
  assert.strictEqual(res.quantidade_fiscal, 2);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testTodosTiposEPlanos() {
  const tiposEsperados = Object.values(TipoInconsistencia);
  const { db, file } = await setupDb();

  const pOk = await criarProduto(db, { saldo_fiscal: 50 });
  const pNeg = await criarProduto(db, { saldo_fiscal: -1 });
  const pedidoSem = await criarPedido(db, PedidoStatus.AGUARDANDO_FATURAMENTO, [
    { produto_id: pOk, quantidade: 1 }
  ]);
  const pedidoCancel = await criarPedido(db, PedidoStatus.CANCELADO, [
    { produto_id: pOk, quantidade: 2 }
  ]);
  await criarReserva(db, pedidoCancel, pOk, 2);
  await criarReserva(db, 77777, pOk, 1);
  const pedidoMaior = await criarPedido(db, PedidoStatus.AGUARDANDO_FATURAMENTO, [
    { produto_id: pOk, quantidade: 1 }
  ]);
  await criarReserva(db, pedidoMaior, pOk, 9);
  const pedidoQtd = await criarPedido(db, PedidoStatus.AGUARDANDO_FATURAMENTO, [
    { produto_id: pNeg, quantidade: 1 }
  ]);
  await criarReserva(db, pedidoQtd, pNeg, 0);
  const pedidoProd = await criarPedido(db, PedidoStatus.AGUARDANDO_FATURAMENTO, []);
  await run(db, `INSERT INTO pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario, subtotal) VALUES (?, 555, 1, 1, 1)`, [pedidoProd]);
  await criarReserva(db, pedidoProd, 555, 1);

  const rel = await reconciliarReservas({
    db,
    pedidoIds: [pedidoSem, pedidoCancel, 77777, pedidoMaior, pedidoQtd, pedidoProd]
  });
  const tipos = new Set(rel.inconsistencias.map((i) => i.tipo));
  for (const t of tiposEsperados) {
    assert.ok(tipos.has(t), `tipo não coberto: ${t}`);
  }
  for (const hit of rel.inconsistencias) {
    assertEvidencias(hit);
    assert.ok(Object.values(EncontradoEm).includes(hit.encontrado_em));
    assertPlano(hit, PLANO_ESPERADO[hit.tipo]);
  }

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testMontarPlanoCorrecaoUnitario() {
  for (const [tipo, esperado] of Object.entries(PLANO_ESPERADO)) {
    const plano = montarPlanoCorrecao(tipo);
    assert.strictEqual(plano.acao, esperado.acao, tipo);
    assert.strictEqual(plano.risco, esperado.risco, tipo);
    assert.strictEqual(plano.executavel, esperado.executavel, tipo);
  }
}

async function main() {
  const testes = [
    ['cenário consistente', testCenarioConsistente],
    ['pedido sem reserva + plano CRIAR_RESERVA', testPedidoSemReserva],
    ['reserva órfã + plano REMOVER_RESERVA', testReservaOrfa],
    ['reserva maior que pedido + plano AJUSTAR_RESERVA', testReservaMaiorQuePedido],
    ['pedido cancelado + plano LIBERAR_RESERVA', testPedidoCanceladoComReservaAtiva],
    ['reserva quantidade inválida + plano AJUSTAR_RESERVA', testReservaQuantidadeInvalida],
    ['saldo fiscal negativo + plano ANALISE_MANUAL', testSaldoFiscalNegativo],
    ['produto inexistente + plano ANALISE_MANUAL', testProdutoInexistente],
    ['somente leitura (sem mutação)', testSomenteLeituraNaoMutates],
    ['todos os tipos + planos', testTodosTiposEPlanos],
    ['montarPlanoCorrecao unitário', testMontarPlanoCorrecaoUnitario]
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
  console.log('\nRC5.2.3 homologada com sucesso.');
  process.exit(0);
}

main();
