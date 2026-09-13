/**
 * Sprint INFRA 01 — Marca / Observações / Imagem Principal (zero breaking change)
 * Executar: npm run test:produto-infra-01
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  caminhoPublicoImagemProduto,
  removerArquivoImagemProduto,
  produtosImagensPath
} = require('../../backend/services/produtoImagemUpload');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

function openDb(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function cb(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

async function criarDb() {
  const file = path.join(os.tmpdir(), `infra01-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const db = await openDb(file);
  await run(db, `
    CREATE TABLE marcas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      ativo INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(db, `
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo VARCHAR(50),
      nome VARCHAR(200) NOT NULL,
      preco_venda DECIMAL(10,2) DEFAULT 1,
      marca_id INTEGER,
      observacoes TEXT,
      imagem_principal TEXT
    )
  `);
  return { db, file };
}

async function main() {
  console.log('\n=== Sprint INFRA 01 — Cadastro Produtos ===\n');

  await test('caminho público de imagem nunca usa Base64', () => {
    const p = caminhoPublicoImagemProduto('produto_123.jpg');
    assert.strictEqual(p, '/storage/produtos/produto_123.jpg');
    assert.ok(!p.includes('data:'));
  });

  await test('produto legado sem marca/obs/imagem continua válido', async () => {
    const { db, file } = await criarDb();
    try {
      const ins = await run(db, `INSERT INTO produtos (codigo, nome, preco_venda) VALUES (?, ?, ?)`, [
        'LEG1',
        'Produto Legado',
        10
      ]);
      const row = await get(db, 'SELECT * FROM produtos WHERE id = ?', [ins.lastID]);
      assert.strictEqual(row.marca_id, null);
      assert.strictEqual(row.observacoes, null);
      assert.strictEqual(row.imagem_principal, null);
    } finally {
      await closeDb(db);
      fs.unlinkSync(file);
    }
  });

  await test('persiste marca, observações e imagem_principal', async () => {
    const { db, file } = await criarDb();
    try {
      const marca = await run(db, `INSERT INTO marcas (nome, ativo) VALUES (?, 1)`, ['Nestlé']);
      const pathImg = '/storage/produtos/produto_teste.jpg';
      const ins = await run(
        db,
        `INSERT INTO produtos (codigo, nome, preco_venda, marca_id, observacoes, imagem_principal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['P1', 'Produto Novo', 5, marca.lastID, 'Obs teste', pathImg]
      );
      const row = await get(db, 'SELECT * FROM produtos WHERE id = ?', [ins.lastID]);
      assert.strictEqual(row.marca_id, marca.lastID);
      assert.strictEqual(row.observacoes, 'Obs teste');
      assert.strictEqual(row.imagem_principal, pathImg);
    } finally {
      await closeDb(db);
      fs.unlinkSync(file);
    }
  });

  await test('inativação lógica de marca não apaga produtos', async () => {
    const { db, file } = await criarDb();
    try {
      const marca = await run(db, `INSERT INTO marcas (nome, ativo) VALUES (?, 1)`, ['Coca']);
      await run(db, `INSERT INTO produtos (nome, preco_venda, marca_id) VALUES (?, ?, ?)`, [
        'Refri',
        8,
        marca.lastID
      ]);
      await run(db, `UPDATE marcas SET ativo = 0 WHERE id = ?`, [marca.lastID]);
      const ativas = await all(db, `SELECT * FROM marcas WHERE COALESCE(ativo, 1) = 1`);
      assert.strictEqual(ativas.length, 0);
      const produto = await get(db, `SELECT * FROM produtos WHERE nome = ?`, ['Refri']);
      assert.strictEqual(produto.marca_id, marca.lastID);
    } finally {
      await closeDb(db);
      fs.unlinkSync(file);
    }
  });

  await test('ALTER TABLE ADD COLUMN é idempotente (padrão do ERP)', async () => {
    const { db, file } = await criarDb();
    try {
      await run(db, `ALTER TABLE produtos ADD COLUMN extra_teste TEXT`).catch(() => {});
      let duplicou = false;
      try {
        await run(db, `ALTER TABLE produtos ADD COLUMN extra_teste TEXT`);
      } catch (err) {
        duplicou = String(err.message || '').includes('duplicate column');
      }
      assert.ok(duplicou, 'segunda ADD COLUMN deve falhar com duplicate column');
    } finally {
      await closeDb(db);
      fs.unlinkSync(file);
    }
  });

  await test('removerArquivoImagemProduto ignora Base64 e paths inválidos', () => {
    assert.strictEqual(removerArquivoImagemProduto('data:image/png;base64,AAAA'), false);
    assert.strictEqual(removerArquivoImagemProduto('../etc/passwd'), false);
    assert.ok(fs.existsSync(produtosImagensPath));
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
