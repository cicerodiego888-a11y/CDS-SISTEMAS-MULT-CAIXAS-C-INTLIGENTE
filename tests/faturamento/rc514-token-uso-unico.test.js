/**
 * RC5.1.4 — Token de supervisor de uso único (jti).
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
  limparSupervisorTokensUsados
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

function emitirTokenSupervisor(overrides = {}) {
  const jti = overrides.jti || crypto.randomUUID();
  const payload = {
    id: overrides.id || 7,
    usuario_id: overrides.id || 7,
    username: overrides.username || 'sup',
    nome: 'Supervisor',
    role: overrides.role || 'user',
    perfil: overrides.perfil || 'SUPERVISOR',
    ...overrides.extra
  };
  const opts = { expiresIn: '15m' };
  if (overrides.semJti) {
    // sem jwtid
  } else {
    opts.jwtid = jti;
  }
  return { token: jwt.sign(payload, JWT_SECRET, opts), jti: overrides.semJti ? null : jti };
}

async function setupDb(opts = {}) {
  const file = opts.file || path.join(os.tmpdir(), `rc514-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
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
     VALUES ('Produto RC514', ?, ?, 0, 0, ?)`,
    [sf, snf, sf + snf]
  );
  return { db, produtoId: p.lastID, file };
}

async function testPrimeiroUsoOk() {
  limparSupervisorTokensUsados();
  const { token, jti } = emitirTokenSupervisor();
  const user = await verificarSupervisorToken(token);
  assert.strictEqual(user.jti, jti);
  assert.strictEqual(user.perfil, 'SUPERVISOR');
}

async function testReutilizacaoBloqueada() {
  limparSupervisorTokensUsados();
  const { token } = emitirTokenSupervisor();
  await verificarSupervisorToken(token);
  await assert.rejects(
    () => verificarSupervisorToken(token),
    (err) => {
      assert.strictEqual(err.code, 'TOKEN_JA_UTILIZADO');
      return true;
    }
  );
}

async function testTokenSemJtiRejeitado() {
  limparSupervisorTokensUsados();
  const { token } = emitirTokenSupervisor({ semJti: true });
  await assert.rejects(
    () => verificarSupervisorToken(token),
    (err) => {
      assert.ok(err.message.includes('identificador único') || err.code === 'AUTORIZACAO_REJEITADA');
      return true;
    }
  );
}

async function testMotorComercialPropagaTokenJaUtilizado() {
  limparSupervisorTokensUsados();
  const { db, produtoId, file } = await setupDb();
  const escopo = {
    pedido_id: 501,
    produtos: [produtoId],
    quantidades: [20]
  };
  const { token } = emitirTokenSupervisor({ id: 42, extra: escopo });

  const r1 = await MotorComercial.confirmarPedidoFiscal({
    pedidoId: 501,
    itens: [{ produto_id: produtoId, quantidade: 20 }],
    supervisorToken: token,
    usuarioId: 1
  }, { db });
  assert.strictEqual(r1.sucesso, true);
  assert.ok(r1.transferencias.length >= 1);

  await assert.rejects(
    () => verificarSupervisorToken(token, escopo),
    (err) => {
      assert.strictEqual(err.code, 'TOKEN_JA_UTILIZADO');
      return true;
    }
  );

  await assert.rejects(
    () => MotorComercial.confirmarPedidoFiscal({
      pedidoId: 503,
      itens: [{ produto_id: produtoId, quantidade: 20 }],
      supervisorToken: 'tok-reusado',
      usuarioId: 1
    }, {
      db,
      verificarSupervisorToken: async () => {
        const e = new Error('Token de autorização já utilizado.');
        e.code = 'TOKEN_JA_UTILIZADO';
        throw e;
      }
    }),
    (err) => {
      assert.strictEqual(err.codigo || err.code, 'TOKEN_JA_UTILIZADO');
      return true;
    }
  );

  await closeDb(db);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

async function testJwtContemJtiPadrao() {
  limparSupervisorTokensUsados();
  const { token, jti } = emitirTokenSupervisor();
  const decoded = jwt.decode(token);
  assert.strictEqual(decoded.jti, jti);
  assert.ok(decoded.exp, 'expiração 15m preservada via exp');
}

async function main() {
  const testes = [
    ['JWT contém jti (exp 15m)', testJwtContemJtiPadrao],
    ['primeiro uso ok', testPrimeiroUsoOk],
    ['reutilização → TOKEN_JA_UTILIZADO', testReutilizacaoBloqueada],
    ['token sem jti rejeitado', testTokenSemJtiRejeitado],
    ['Motor Comercial propaga TOKEN_JA_UTILIZADO', testMotorComercialPropagaTokenJaUtilizado]
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
  console.log('\nRC5.1.4 homologada com sucesso.');
  process.exit(0);
}

main();
