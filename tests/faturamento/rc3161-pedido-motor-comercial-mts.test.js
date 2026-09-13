/**
 * RC3.16.1 — Integração Pedido × Motor Comercial × F×NF × MTS
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.resolve(__dirname, '../..');
const MotorComercial = require('../../backend/motores/comercial');
const fxnfReservas = require('../../backend/services/fiscalNaoFiscal/reservasPublico');
const fxnfSaldos = require('../../backend/services/fiscalNaoFiscal/estoqueSaldosPublico');
const { TipoSaldo } = require('../../backend/services/fiscalNaoFiscal/constants');

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

async function setupDb(opts = {}) {
  const file = opts.file || ':memory:';
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
      estoque_atual REAL DEFAULT 0,
      updated_at DATETIME
    )
  `);
  await run(db, `
    CREATE TABLE movimentos_transferencia_saldos (
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

  const sf = opts.saldo_fiscal != null ? opts.saldo_fiscal : 100;
  const snf = opts.saldo_nao_fiscal != null ? opts.saldo_nao_fiscal : 50;
  const p = await run(
    db,
    `INSERT INTO produtos (nome, saldo_fiscal, saldo_nao_fiscal, reservado_fiscal, reservado_nao_fiscal, estoque_atual)
     VALUES ('Produto RC3161', ?, ?, 0, 0, ?)`,
    [sf, snf, sf + snf]
  );
  return { db, produtoId: p.lastID, file };
}

function assertRejects(promise, codigo) {
  return promise.then(
    () => { throw new Error(`Esperava erro ${codigo}`); },
    (err) => {
      const c = err.codigo || err.code;
      assert.strictEqual(c, codigo, `esperado ${codigo}, veio ${c}: ${err.message}`);
    }
  );
}

async function testFiscalSuficiente() {
  const { db, produtoId } = await setupDb({ saldo_fiscal: 100, saldo_nao_fiscal: 0 });
  const r = await MotorComercial.confirmarPedidoFiscal({
    pedidoId: 1,
    itens: [{ produto_id: produtoId, quantidade: 30 }],
    usuarioId: 1
  }, { db });

  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.transferencias.length, 0);
  assert.strictEqual(r.reservas.length, 1);

  const prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.saldo_fiscal, 100);
  assert.strictEqual(prod.reservado_fiscal, 30);

  const eventos = await all(db, 'SELECT evento FROM auditoria_pedido_estoque_fiscal ORDER BY id');
  assert.ok(eventos.some((e) => e.evento === 'CONSULTA'));
  assert.ok(eventos.some((e) => e.evento === 'RESERVA'));
  assert.ok(eventos.some((e) => e.evento === 'CONFIRMADO'));
  await closeDb(db);
}

async function testFiscalInsuficienteRequerSupervisor() {
  const { db, produtoId } = await setupDb({ saldo_fiscal: 10, saldo_nao_fiscal: 90 });
  const analise = await MotorComercial.analisarDisponibilidadeFiscal(
    [{ produto_id: produtoId, quantidade: 40 }],
    { db }
  );
  assert.strictEqual(analise.requerAutorizacao, true);
  assert.strictEqual(analise.bloqueado, false);

  await assertRejects(
    MotorComercial.confirmarPedidoFiscal({
      pedidoId: 2,
      itens: [{ produto_id: produtoId, quantidade: 40 }],
      usuarioId: 1
    }, { db }),
    'REQUER_AUTORIZACAO_SUPERVISOR'
  );

  const prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.saldo_fiscal, 10);
  assert.strictEqual(prod.reservado_fiscal, 0);
  await closeDb(db);
}

async function testSupervisorAprovaTransferencia() {
  const { db, produtoId } = await setupDb({ saldo_fiscal: 10, saldo_nao_fiscal: 90 });
  const r = await MotorComercial.confirmarPedidoFiscal({
    pedidoId: 3,
    itens: [{ produto_id: produtoId, quantidade: 40 }],
    supervisorToken: 'tok',
    usuarioId: 1
  }, {
    db,
    verificarSupervisorToken: async () => ({ id: 99, username: 'sup', perfil: 'SUPERVISOR' })
  });

  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.transferencias.length, 1);
  assert.strictEqual(r.transferencias[0].quantidade, 30);
  assert.strictEqual(r.transferencias[0].origem, TipoSaldo.NAO_FISCAL);
  assert.strictEqual(r.transferencias[0].destino, TipoSaldo.FISCAL);

  const prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.saldo_fiscal, 40);
  assert.strictEqual(prod.saldo_nao_fiscal, 60);
  assert.strictEqual(prod.reservado_fiscal, 40);

  const mov = await get(db, 'SELECT * FROM movimentos_transferencia_saldos');
  assert.ok(mov);
  assert.strictEqual(mov.quantidade, 30);

  const eventos = await all(db, 'SELECT evento FROM auditoria_pedido_estoque_fiscal');
  assert.ok(eventos.some((e) => e.evento === 'AUTORIZACAO_CONCEDIDA'));
  assert.ok(eventos.some((e) => e.evento === 'TRANSFERENCIA'));
  assert.ok(eventos.some((e) => e.evento === 'RESERVA'));
  await closeDb(db);
}

async function testSupervisorRejeita() {
  const { db, produtoId } = await setupDb({ saldo_fiscal: 5, saldo_nao_fiscal: 50 });
  await assertRejects(
    MotorComercial.confirmarPedidoFiscal({
      pedidoId: 4,
      itens: [{ produto_id: produtoId, quantidade: 20 }],
      supervisorToken: 'ruim'
    }, {
      db,
      verificarSupervisorToken: async () => {
        throw new Error('Token de supervisor inválido ou expirado.');
      }
    }),
    'AUTORIZACAO_REJEITADA'
  );
  const prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.saldo_fiscal, 5);
  assert.strictEqual(prod.reservado_fiscal, 0);
  await closeDb(db);
}

async function testSaldoTotalInsuficiente() {
  const { db, produtoId } = await setupDb({ saldo_fiscal: 5, saldo_nao_fiscal: 5 });
  await assertRejects(
    MotorComercial.confirmarPedidoFiscal({
      pedidoId: 5,
      itens: [{ produto_id: produtoId, quantidade: 20 }]
    }, { db }),
    'SALDO_INSUFICIENTE'
  );
  const prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.reservado_fiscal, 0);
  await closeDb(db);
}

async function testRollback() {
  const { db, produtoId } = await setupDb({ saldo_fiscal: 10, saldo_nao_fiscal: 90 });

  // Força falha após transferência: stub criarReservaFiscal
  const original = fxnfReservas.criarReservaFiscal;
  fxnfReservas.criarReservaFiscal = async () => {
    throw Object.assign(new Error('Falha reserva'), { code: 'FALHA_RESERVA' });
  };

  try {
    await assertRejects(
      MotorComercial.confirmarPedidoFiscal({
        pedidoId: 6,
        itens: [{ produto_id: produtoId, quantidade: 40 }],
        supervisorToken: 'tok'
      }, {
        db,
        verificarSupervisorToken: async () => ({ id: 1, username: 'sup' })
      }),
      'FALHA_RESERVA'
    );
  } finally {
    fxnfReservas.criarReservaFiscal = original;
  }

  const prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  // Transferência deve ter sido revertida junto com a TX
  assert.strictEqual(prod.saldo_fiscal, 10, 'rollback deve restaurar saldo fiscal');
  assert.strictEqual(prod.saldo_nao_fiscal, 90);
  assert.strictEqual(prod.reservado_fiscal, 0);

  const movCount = await get(db, 'SELECT COUNT(*) AS c FROM movimentos_transferencia_saldos');
  assert.strictEqual(movCount.c, 0, 'auditoria MTS não persiste após rollback');
  await closeDb(db);
}

async function testConcorrenciaPedidos() {
  const file = path.join(os.tmpdir(), `rc3161-conc-${Date.now()}.db`);
  const { db: setup, produtoId } = await setupDb({
    file,
    saldo_fiscal: 20,
    saldo_nao_fiscal: 0
  });
  await closeDb(setup);

  const db1 = await openDb(file);
  const db2 = await openDb(file);
  await run(db1, 'PRAGMA busy_timeout = 5000');
  await run(db2, 'PRAGMA busy_timeout = 5000');

  const p1 = MotorComercial.confirmarPedidoFiscal({
    pedidoId: 101,
    itens: [{ produto_id: produtoId, quantidade: 15 }]
  }, { db: db1 });
  const p2 = MotorComercial.confirmarPedidoFiscal({
    pedidoId: 102,
    itens: [{ produto_id: produtoId, quantidade: 15 }]
  }, { db: db2 });

  const results = await Promise.allSettled([p1, p2]);
  const ok = results.filter((x) => x.status === 'fulfilled');
  const fail = results.filter((x) => x.status === 'rejected');
  assert.strictEqual(ok.length, 1);
  assert.strictEqual(fail.length, 1);
  assert.ok(
    ['SALDO_INSUFICIENTE'].includes(fail[0].reason.codigo || fail[0].reason.code)
  );

  const prod = await get(db1, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.reservado_fiscal, 15);
  assert.strictEqual(prod.saldo_fiscal, 20);

  await closeDb(db1);
  await closeDb(db2);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

function testArquiteturaSemAcoplamento() {
  const pedidoFiles = [
    'backend/services/pedido/PedidoOperacionalService.js',
    'backend/services/pedido/PedidoService.js',
    'backend/services/pedido/PedidoRepository.js'
  ];
  for (const rel of pedidoFiles) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (rel.includes('PedidoRepository')) {
      assert.ok(!/motores\/mts/.test(src), 'Repository não pode conhecer MTS');
      assert.ok(!/fiscalNaoFiscal/.test(src), 'Repository não pode conhecer F×NF');
      continue;
    }
    assert.ok(
      !/require\(['"].*motores\/mts/.test(src),
      `${rel} não deve require MTS direto`
    );
    assert.ok(
      !/require\(['"].*fiscalNaoFiscal/.test(src),
      `${rel} não deve require F×NF direto`
    );
    assert.ok(
      /motores\/comercial/.test(src),
      `${rel} deve orquestrar via Motor Comercial`
    );
  }

  const comercial = fs.readFileSync(
    path.join(ROOT, 'backend/motores/comercial/MotorComercialService.js'),
    'utf8'
  );
  assert.ok(/require\(['"]\.\.\/mts['"]\)|motores\/mts/.test(comercial), 'Motor Comercial usa MTS');
  assert.ok(/fiscalNaoFiscal/.test(comercial), 'Motor Comercial usa F×NF');
  assert.ok(!/UPDATE\s+produtos/i.test(comercial), 'Motor Comercial não UPDATE produtos');

  const mts = fs.readFileSync(path.join(ROOT, 'backend/motores/mts/MtsService.js'), 'utf8');
  assert.ok(!/criarReserva|reservado_fiscal|pedido_estoque/i.test(mts), 'MTS não cria reservas');
}

async function testLiberarReserva() {
  const { db, produtoId } = await setupDb({ saldo_fiscal: 50, saldo_nao_fiscal: 0 });
  await MotorComercial.confirmarPedidoFiscal({
    pedidoId: 77,
    itens: [{ produto_id: produtoId, quantidade: 12 }]
  }, { db });
  let prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.reservado_fiscal, 12);

  await MotorComercial.liberarReservasDoPedido(77, { db });
  prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.reservado_fiscal, 0);
  await closeDb(db);
}

async function main() {
  const testes = [
    ['arquitetura sem acoplamento Pedido→F×NF/MTS', testArquiteturaSemAcoplamento],
    ['saldo fiscal suficiente + reserva', testFiscalSuficiente],
    ['fiscal insuficiente / NF ok → requer supervisor', testFiscalInsuficienteRequerSupervisor],
    ['supervisor aprova + transferência MTS + reserva', testSupervisorAprovaTransferencia],
    ['supervisor rejeita', testSupervisorRejeita],
    ['saldo total insuficiente (bloqueado)', testSaldoTotalInsuficiente],
    ['rollback em falha', testRollback],
    ['concorrência / pedidos simultâneos', testConcorrenciaPedidos],
    ['liberar reserva', testLiberarReserva]
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
  console.log('\nRC3.16.1 homologada com sucesso.');
  process.exit(0);
}

main();
