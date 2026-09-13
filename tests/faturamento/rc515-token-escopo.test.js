/**
 * RC5.1.5 — Token de supervisor vinculado ao escopo da operação.
 */
'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const { JWT_SECRET } = require('../../backend/middleware/auth');
const {
  verificarSupervisorToken,
  limparSupervisorTokensUsados,
  normalizarEscopoSupervisor
} = require('../../backend/rotas/auth');
const MotorComercial = require('../../backend/motores/comercial');

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

function emitirTokenSupervisor(escopo, overrides = {}) {
  const jti = crypto.randomUUID();
  const escopoNorm = normalizarEscopoSupervisor(escopo || {});
  const payload = {
    id: overrides.id || 7,
    usuario_id: overrides.id || 7,
    username: overrides.username || 'sup',
    nome: 'Supervisor',
    role: 'user',
    perfil: 'SUPERVISOR',
    pedido_id: escopoNorm.pedido_id,
    produtos: escopoNorm.produtos,
    quantidades: escopoNorm.quantidades
  };
  return {
    token: jwt.sign(payload, JWT_SECRET, { expiresIn: '15m', jwtid: jti }),
    jti,
    escopo: escopoNorm
  };
}

async function setupDb(opts = {}) {
  const file = opts.file || path.join(os.tmpdir(), `rc515-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
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

  const sf = opts.saldo_fiscal != null ? opts.saldo_fiscal : 5;
  const snf = opts.saldo_nao_fiscal != null ? opts.saldo_nao_fiscal : 100;
  const p = await run(
    db,
    `INSERT INTO produtos (nome, saldo_fiscal, saldo_nao_fiscal, reservado_fiscal, reservado_nao_fiscal, estoque_atual)
     VALUES ('Produto A RC515', ?, ?, 0, 0, ?)`,
    [sf, snf, sf + snf]
  );
  const p2 = await run(
    db,
    `INSERT INTO produtos (nome, saldo_fiscal, saldo_nao_fiscal, reservado_fiscal, reservado_nao_fiscal, estoque_atual)
     VALUES ('Produto B RC515', ?, ?, 0, 0, ?)`,
    [sf, snf, sf + snf]
  );
  return { db, produtoId: p.lastID, produtoIdB: p2.lastID, file };
}

async function testTokenValidoMesmoPedido() {
  limparSupervisorTokensUsados();
  const { db, produtoId, file } = await setupDb();
  const pedidoId = 701;
  const quantidade = 20;
  const { token } = emitirTokenSupervisor({
    pedido_id: pedidoId,
    produtos: [produtoId],
    quantidades: [quantidade]
  });

  const r = await MotorComercial.confirmarPedidoFiscal({
    pedidoId,
    itens: [{ produto_id: produtoId, quantidade }],
    supervisorToken: token,
    usuarioId: 1
  }, { db });

  assert.strictEqual(r.sucesso, true);
  assert.ok(r.transferencias.length >= 1);
  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testTokenPedidoDiferente() {
  limparSupervisorTokensUsados();
  const { db, produtoId, file } = await setupDb();
  const { token } = emitirTokenSupervisor({
    pedido_id: 801,
    produtos: [produtoId],
    quantidades: [20]
  });

  await assert.rejects(
    () => MotorComercial.confirmarPedidoFiscal({
      pedidoId: 802,
      itens: [{ produto_id: produtoId, quantidade: 20 }],
      supervisorToken: token,
      usuarioId: 1
    }, { db }),
    (err) => {
      assert.strictEqual(err.codigo || err.code, 'TOKEN_FORA_DO_ESCOPO');
      return true;
    }
  );

  // Escopo divergente não consome o jti — ainda válido para o pedido original
  const ok = await verificarSupervisorToken(token, {
    pedido_id: 801,
    produtos: [produtoId],
    quantidades: [20]
  });
  assert.ok(ok);

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testTokenQuantidadeDiferente() {
  limparSupervisorTokensUsados();
  const { db, produtoId, file } = await setupDb();
  const { token } = emitirTokenSupervisor({
    pedido_id: 901,
    produtos: [produtoId],
    quantidades: [20]
  });

  await assert.rejects(
    () => MotorComercial.confirmarPedidoFiscal({
      pedidoId: 901,
      itens: [{ produto_id: produtoId, quantidade: 30 }],
      supervisorToken: token,
      usuarioId: 1
    }, { db }),
    (err) => {
      assert.strictEqual(err.codigo || err.code, 'TOKEN_FORA_DO_ESCOPO');
      return true;
    }
  );

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testTokenProdutoDiferente() {
  limparSupervisorTokensUsados();
  const { db, produtoId, produtoIdB, file } = await setupDb();
  const { token } = emitirTokenSupervisor({
    pedido_id: 1001,
    produtos: [produtoId],
    quantidades: [20]
  });

  await assert.rejects(
    () => MotorComercial.confirmarPedidoFiscal({
      pedidoId: 1001,
      itens: [{ produto_id: produtoIdB, quantidade: 20 }],
      supervisorToken: token,
      usuarioId: 1
    }, { db }),
    (err) => {
      assert.strictEqual(err.codigo || err.code, 'TOKEN_FORA_DO_ESCOPO');
      return true;
    }
  );

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testClaimsNoPayload() {
  limparSupervisorTokensUsados();
  const { token, escopo } = emitirTokenSupervisor({
    pedido_id: 55,
    produtos: [3, 1],
    quantidades: [4, 9]
  });
  const decoded = jwt.decode(token);
  assert.strictEqual(decoded.pedido_id, 55);
  assert.deepStrictEqual(decoded.produtos, escopo.produtos);
  assert.deepStrictEqual(decoded.quantidades, escopo.quantidades);
  assert.ok(decoded.exp, 'expiração preservada');
}

async function main() {
  const testes = [
    ['claims pedido_id/produtos/quantidades no JWT', testClaimsNoPayload],
    ['token válido no mesmo pedido', testTokenValidoMesmoPedido],
    ['token em pedido diferente → TOKEN_FORA_DO_ESCOPO', testTokenPedidoDiferente],
    ['token com quantidade diferente → TOKEN_FORA_DO_ESCOPO', testTokenQuantidadeDiferente],
    ['token com produto diferente → TOKEN_FORA_DO_ESCOPO', testTokenProdutoDiferente]
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
  limparSupervisorTokensUsados();
  if (falhas) {
    console.error(`\n${falhas} teste(s) falharam`);
    process.exit(1);
  }
  console.log('\nRC5.1.5 homologada com sucesso.');
  process.exit(0);
}

main();
