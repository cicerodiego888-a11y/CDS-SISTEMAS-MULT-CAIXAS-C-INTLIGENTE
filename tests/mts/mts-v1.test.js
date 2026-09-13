/**
 * MTS V1.0 — homologação do Motor de Transferência de Saldos
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.resolve(__dirname, '../..');
const MTS_DIR = path.join(ROOT, 'backend/motores/mts');
const FXNF_PUBLIC = path.join(ROOT, 'backend/services/fiscalNaoFiscal/estoqueSaldosPublico.js');

const {
  transferirSaldo,
  consultarTransferencia,
  TipoSaldo,
  ResultadoTransferencia
} = require('../../backend/motores/mts');
const estoqueSaldosPublico = require('../../backend/services/fiscalNaoFiscal/estoqueSaldosPublico');

function openDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(db)));
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

function closeDb(db) {
  return new Promise((resolve) => {
    try {
      db.close(() => resolve());
    } catch (_) {
      resolve();
    }
  });
}

async function setupDb() {
  const db = await openDb();
  await run(db, `
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT,
      saldo_fiscal REAL DEFAULT 0,
      saldo_nao_fiscal REAL DEFAULT 0,
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
  const p = await run(
    db,
    `INSERT INTO produtos (nome, saldo_fiscal, saldo_nao_fiscal, estoque_atual)
     VALUES ('Produto MTS', 100, 50, 150)`
  );
  return { db, produtoId: p.lastID };
}

function assertRejects(promise, code) {
  return promise.then(
    () => {
      throw new Error(`Esperava erro ${code}, mas resolveu`);
    },
    (err) => {
      assert.strictEqual(err.code, code, `código esperado ${code}, veio ${err.code}: ${err.message}`);
    }
  );
}

const CTX_AUTH = Object.freeze({ autorizado: true });

async function testFiscalParaNaoFiscal() {
  const { db, produtoId } = await setupDb();
  const r = await transferirSaldo({
    produto: produtoId,
    origem: TipoSaldo.FISCAL,
    destino: TipoSaldo.NAO_FISCAL,
    quantidade: 20,
    motivo: 'Homologação F→NF',
    usuario: 7,
    contextoAutorizacao: CTX_AUTH
  }, { db, estoque: estoqueSaldosPublico });

  assert.strictEqual(r.sucesso, true);
  assert.strictEqual(r.resultado, ResultadoTransferencia.SUCESSO);
  assert.strictEqual(r.quantidade, 20);
  assert.strictEqual(r.saldo_origem_antes, 100);
  assert.strictEqual(r.saldo_origem_depois, 80);
  assert.strictEqual(r.saldo_destino_antes, 50);
  assert.strictEqual(r.saldo_destino_depois, 70);

  const prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.saldo_fiscal, 80);
  assert.strictEqual(prod.saldo_nao_fiscal, 70);
  assert.strictEqual(prod.estoque_atual, 150);
  await closeDb(db);
}

async function testNaoFiscalParaFiscal() {
  const { db, produtoId } = await setupDb();
  const r = await transferirSaldo({
    produto: produtoId,
    origem: 'NAO_FISCAL',
    destino: 'FISCAL',
    quantidade: 10,
    motivo: 'Homologação NF→F',
    usuario: { id: 3 },
    contextoAutorizacao: CTX_AUTH
  }, { db, estoque: estoqueSaldosPublico });

  assert.strictEqual(r.origem, TipoSaldo.NAO_FISCAL);
  assert.strictEqual(r.destino, TipoSaldo.FISCAL);
  assert.strictEqual(r.saldo_origem_depois, 40);
  assert.strictEqual(r.saldo_destino_depois, 110);

  const prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.saldo_fiscal, 110);
  assert.strictEqual(prod.saldo_nao_fiscal, 40);
  await closeDb(db);
}

async function testSaldoInsuficiente() {
  const { db, produtoId } = await setupDb();
  await assertRejects(
    transferirSaldo({
      produto: produtoId,
      origem: TipoSaldo.FISCAL,
      destino: TipoSaldo.NAO_FISCAL,
      quantidade: 999,
      motivo: 'deve falhar',
      contextoAutorizacao: CTX_AUTH
    }, { db, estoque: estoqueSaldosPublico }),
    'SALDO_INSUFICIENTE'
  );

  const prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.saldo_fiscal, 100);
  assert.strictEqual(prod.saldo_nao_fiscal, 50);

  const auditCount = await get(db, 'SELECT COUNT(*) AS c FROM movimentos_transferencia_saldos');
  assert.strictEqual(auditCount.c, 0);
  await closeDb(db);
}

async function testRollback() {
  const { db, produtoId } = await setupDb();

  const estoqueQuebrado = {
    ...estoqueSaldosPublico,
    async creditarSaldo() {
      throw Object.assign(new Error('Falha simulada no crédito'), { code: 'FALHA_SIMULADA' });
    },
    executarEmTransacao: estoqueSaldosPublico.executarEmTransacao,
    consultarSaldo: estoqueSaldosPublico.consultarSaldo,
    debitarSaldo: estoqueSaldosPublico.debitarSaldo,
    normalizarTipoSaldo: estoqueSaldosPublico.normalizarTipoSaldo
  };

  await assertRejects(
    transferirSaldo({
      produto: produtoId,
      origem: TipoSaldo.FISCAL,
      destino: TipoSaldo.NAO_FISCAL,
      quantidade: 5,
      motivo: 'rollback',
      contextoAutorizacao: CTX_AUTH
    }, { db, estoque: estoqueQuebrado }),
    'FALHA_SIMULADA'
  );

  const prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.saldo_fiscal, 100, 'débito deve ter sido revertido');
  assert.strictEqual(prod.saldo_nao_fiscal, 50);

  const auditCount = await get(db, 'SELECT COUNT(*) AS c FROM movimentos_transferencia_saldos');
  assert.strictEqual(auditCount.c, 0, 'auditoria não deve persistir após rollback');
  await closeDb(db);
}

async function testAuditoria() {
  const { db, produtoId } = await setupDb();
  const r = await transferirSaldo({
    produto: { id: produtoId },
    origem: TipoSaldo.FISCAL,
    destino: TipoSaldo.NAO_FISCAL,
    quantidade: 3,
    motivo: 'auditoria',
    usuario: 99,
    contextoAutorizacao: CTX_AUTH
  }, { db, estoque: estoqueSaldosPublico });

  const row = await consultarTransferencia(r.transferencia_id, { db });
  assert.strictEqual(row.produto_id, produtoId);
  assert.strictEqual(row.origem, TipoSaldo.FISCAL);
  assert.strictEqual(row.destino, TipoSaldo.NAO_FISCAL);
  assert.strictEqual(row.quantidade, 3);
  assert.strictEqual(row.usuario_id, 99);
  assert.strictEqual(row.resultado, ResultadoTransferencia.SUCESSO);
  assert.ok(row.data_hora);
  await closeDb(db);
}

async function testConcorrencia() {
  const os = require('os');
  const file = path.join(os.tmpdir(), `mts-conc-${Date.now()}-${process.pid}.db`);

  const openFile = (mode) => new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(file, mode, (err) => (err ? reject(err) : resolve(conn)));
  });

  const setup = await openFile(sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
  await run(setup, `
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT,
      saldo_fiscal REAL DEFAULT 0,
      saldo_nao_fiscal REAL DEFAULT 0,
      estoque_atual REAL DEFAULT 0,
      updated_at DATETIME
    )
  `);
  await run(setup, `
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
  const p = await run(
    setup,
    `INSERT INTO produtos (nome, saldo_fiscal, saldo_nao_fiscal, estoque_atual)
     VALUES ('Produto Conc', 15, 50, 65)`
  );
  const produtoId = p.lastID;
  await new Promise((resolve) => setup.close(resolve));

  const db1 = await openFile(sqlite3.OPEN_READWRITE);
  const db2 = await openFile(sqlite3.OPEN_READWRITE);
  await run(db1, 'PRAGMA busy_timeout = 5000');
  await run(db2, 'PRAGMA busy_timeout = 5000');

  const p1 = transferirSaldo({
    produto: produtoId,
    origem: TipoSaldo.FISCAL,
    destino: TipoSaldo.NAO_FISCAL,
    quantidade: 10,
    motivo: 'conc-1',
    contextoAutorizacao: CTX_AUTH
  }, { db: db1, estoque: estoqueSaldosPublico });

  const p2 = transferirSaldo({
    produto: produtoId,
    origem: TipoSaldo.FISCAL,
    destino: TipoSaldo.NAO_FISCAL,
    quantidade: 10,
    motivo: 'conc-2',
    contextoAutorizacao: CTX_AUTH
  }, { db: db2, estoque: estoqueSaldosPublico });

  const results = await Promise.allSettled([p1, p2]);
  const ok = results.filter((x) => x.status === 'fulfilled');
  const fail = results.filter((x) => x.status === 'rejected');

  assert.strictEqual(ok.length, 1, 'apenas uma transferência deve vencer');
  assert.strictEqual(fail.length, 1, 'a outra deve falhar por saldo');
  assert.strictEqual(fail[0].reason.code, 'SALDO_INSUFICIENTE');

  const prod = await get(db1, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.saldo_fiscal, 5);
  assert.strictEqual(prod.saldo_nao_fiscal, 60);

  const auditCount = await get(db1, 'SELECT COUNT(*) AS c FROM movimentos_transferencia_saldos');
  assert.strictEqual(auditCount.c, 1);

  await closeDb(db1);
  await closeDb(db2);
  try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
}

function testSemAcessoDiretoEstoque() {
  const arquivosMts = fs.readdirSync(MTS_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(MTS_DIR, f));

  const proibido = [
    /FROM\s+produtos\b/i,
    /UPDATE\s+produtos\b/i,
    /INSERT\s+INTO\s+produtos\b/i,
    /DELETE\s+FROM\s+produtos\b/i,
    /produtos_ajustes_estoque/i,
    /produtos_lotes/i
  ];

  for (const file of arquivosMts) {
    const src = fs.readFileSync(file, 'utf8');
    for (const re of proibido) {
      assert.ok(
        !re.test(src),
        `MTS não pode acessar estoque diretamente (${path.basename(file)} bateu ${re})`
      );
    }
  }

  // Interface pública do Motor F×NF É quem toca produtos
  const fxnf = fs.readFileSync(FXNF_PUBLIC, 'utf8');
  assert.ok(/UPDATE\s+produtos/i.test(fxnf), 'Interface pública F×NF deve atualizar produtos');
  assert.ok(/FROM\s+produtos/i.test(fxnf), 'Interface pública F×NF deve consultar produtos');

  // MTS deve depender da interface pública
  const mtsService = fs.readFileSync(path.join(MTS_DIR, 'MtsService.js'), 'utf8');
  assert.ok(
    mtsService.includes('fiscalNaoFiscal/estoqueSaldosPublico')
      || mtsService.includes("fiscalNaoFiscal'"),
    'MTS deve comunicar-se via Interface Pública F×NF'
  );
  assert.ok(mtsService.includes('consultarSaldo'));
  assert.ok(mtsService.includes('debitarSaldo'));
  assert.ok(mtsService.includes('creditarSaldo'));
}

async function testValidacoesBasicas() {
  const { db, produtoId } = await setupDb();

  await assertRejects(
    transferirSaldo({
      produto: produtoId,
      origem: TipoSaldo.FISCAL,
      destino: TipoSaldo.FISCAL,
      quantidade: 1
    }, { db, estoque: estoqueSaldosPublico }),
    'ORIGEM_DESTINO_IGUAIS'
  );

  await assertRejects(
    transferirSaldo({
      produto: produtoId,
      origem: TipoSaldo.FISCAL,
      destino: TipoSaldo.NAO_FISCAL,
      quantidade: 0
    }, { db, estoque: estoqueSaldosPublico }),
    'QUANTIDADE_INVALIDA'
  );

  await assertRejects(
    transferirSaldo({
      produto: 99999,
      origem: TipoSaldo.FISCAL,
      destino: TipoSaldo.NAO_FISCAL,
      quantidade: 1,
      contextoAutorizacao: CTX_AUTH
    }, { db, estoque: estoqueSaldosPublico }),
    'PRODUTO_NAO_ENCONTRADO'
  );

  await closeDb(db);
}

/** RC5.1.2 — chamada direta sem contexto de autorização deve ser bloqueada. */
async function testSemContextoAutorizacao() {
  const { db, produtoId } = await setupDb();

  await assertRejects(
    transferirSaldo({
      produto: produtoId,
      origem: TipoSaldo.FISCAL,
      destino: TipoSaldo.NAO_FISCAL,
      quantidade: 1,
      motivo: 'sem auth'
    }, { db, estoque: estoqueSaldosPublico }),
    'AUTORIZACAO_AUSENTE'
  );

  await assertRejects(
    transferirSaldo({
      produto: produtoId,
      origem: TipoSaldo.FISCAL,
      destino: TipoSaldo.NAO_FISCAL,
      quantidade: 1,
      contextoAutorizacao: { autorizado: false }
    }, { db, estoque: estoqueSaldosPublico }),
    'AUTORIZACAO_AUSENTE'
  );

  const prod = await get(db, 'SELECT * FROM produtos WHERE id = ?', [produtoId]);
  assert.strictEqual(prod.saldo_fiscal, 100);
  assert.strictEqual(prod.saldo_nao_fiscal, 50);
  const auditCount = await get(db, 'SELECT COUNT(*) AS c FROM movimentos_transferencia_saldos');
  assert.strictEqual(auditCount.c, 0);
  await closeDb(db);
}

async function main() {
  const testes = [
    ['sem acesso direto a estoque', testSemAcessoDiretoEstoque],
    ['Fiscal → Não Fiscal', testFiscalParaNaoFiscal],
    ['Não Fiscal → Fiscal', testNaoFiscalParaFiscal],
    ['saldo insuficiente', testSaldoInsuficiente],
    ['rollback', testRollback],
    ['auditoria', testAuditoria],
    ['concorrência', testConcorrencia],
    ['validações básicas', testValidacoesBasicas],
    ['RC5.1.2 sem contexto de autorização', testSemContextoAutorizacao]
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
  console.log('\nMTS V1.0 homologado com sucesso.');
  process.exit(0);
}

main();
