/**
 * Sprint INFRA 02 — Galeria produto_imagens (compatível com imagem_principal)
 * Executar: npm run test:produto-infra-02
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  garantirSchemaProdutoImagens,
  migrarImagensPrincipaisParaGaleria
} = require('../../backend/services/produto-imagem/produtoImagensSchema');
const ProdutoImagemRepository = require('../../backend/repositories/ProdutoImagemRepository');
const ProdutoImagemService = require('../../backend/services/ProdutoImagemService');

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

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

function garantirSchema(db) {
  return new Promise((resolve, reject) => {
    garantirSchemaProdutoImagens(db, (err) => (err ? reject(err) : resolve()));
  });
}

async function criarDb() {
  const file = path.join(os.tmpdir(), `infra02-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const db = await openDb(file);
  await run(db, `
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      imagem_principal TEXT
    )
  `);
  await garantirSchema(db);
  return { db, file };
}

async function main() {
  console.log('\n=== Sprint INFRA 02 — Galeria de Imagens ===\n');

  await test('cria schema produto_imagens', async () => {
    const { db, file } = await criarDb();
    try {
      const row = await get(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='produto_imagens'`);
      assert.ok(row);
    } finally {
      await closeDb(db);
      fs.unlinkSync(file);
    }
  });

  await test('migração espelha imagem_principal sem alterar o campo', async () => {
    const { db, file } = await criarDb();
    try {
      const pathImg = '/storage/produtos/legado.jpg';
      const ins = await run(db, `INSERT INTO produtos (nome, imagem_principal) VALUES (?, ?)`, [
        'Com Imagem',
        pathImg
      ]);
      await new Promise((resolve, reject) => {
        migrarImagensPrincipaisParaGaleria(db, (err, stats) => (err ? reject(err) : resolve(stats)));
      });

      const produto = await get(db, `SELECT * FROM produtos WHERE id = ?`, [ins.lastID]);
      assert.strictEqual(produto.imagem_principal, pathImg);

      const galeria = await get(
        db,
        `SELECT * FROM produto_imagens WHERE produto_id = ? AND principal = 1 AND ativo = 1`,
        [ins.lastID]
      );
      assert.ok(galeria);
      assert.strictEqual(galeria.arquivo, pathImg);
      assert.strictEqual(galeria.ordem, 1);
    } finally {
      await closeDb(db);
      fs.unlinkSync(file);
    }
  });

  await test('produto sem imagem não gera galeria', async () => {
    const { db, file } = await criarDb();
    try {
      const ins = await run(db, `INSERT INTO produtos (nome) VALUES (?)`, ['Sem Imagem']);
      await new Promise((resolve, reject) => {
        migrarImagensPrincipaisParaGaleria(db, (err) => (err ? reject(err) : resolve()));
      });
      const count = await get(
        db,
        `SELECT COUNT(*) AS n FROM produto_imagens WHERE produto_id = ?`,
        [ins.lastID]
      );
      assert.strictEqual(Number(count.n), 0);
    } finally {
      await closeDb(db);
      fs.unlinkSync(file);
    }
  });

  await test('service sincroniza e lista imagens', async () => {
    const { db, file } = await criarDb();
    try {
      const ins = await run(db, `INSERT INTO produtos (nome, imagem_principal) VALUES (?, ?)`, [
        'Sync',
        '/storage/produtos/a.jpg'
      ]);
      const service = new ProdutoImagemService({ db });
      const principal = await service.sincronizarAPartirDeImagemPrincipal(
        ins.lastID,
        '/storage/produtos/a.jpg'
      );
      assert.strictEqual(principal.principal, true);
      assert.strictEqual(principal.ordem, 1);

      const extra = await service.adicionarImagem(ins.lastID, '/storage/produtos/b.jpg', {
        principal: false
      });
      assert.strictEqual(extra.principal, false);

      const lista = await service.listarImagens(ins.lastID);
      assert.strictEqual(lista.length, 2);
      assert.strictEqual(lista[0].arquivo, '/storage/produtos/a.jpg');

      // imagem_principal permanece
      const produto = await get(db, `SELECT imagem_principal FROM produtos WHERE id = ?`, [ins.lastID]);
      assert.strictEqual(produto.imagem_principal, '/storage/produtos/a.jpg');
    } finally {
      await closeDb(db);
      fs.unlinkSync(file);
    }
  });

  await test('definir principal espelha em imagem_principal', async () => {
    const { db, file } = await criarDb();
    try {
      const ins = await run(db, `INSERT INTO produtos (nome) VALUES (?)`, ['Principal']);
      const service = new ProdutoImagemService({
        db,
        repository: new ProdutoImagemRepository({ db })
      });
      const a = await service.adicionarImagem(ins.lastID, '/storage/produtos/1.jpg', { principal: true });
      const b = await service.adicionarImagem(ins.lastID, '/storage/produtos/2.jpg');
      await service.definirImagemPrincipal(ins.lastID, b.id);

      const produto = await get(db, `SELECT imagem_principal FROM produtos WHERE id = ?`, [ins.lastID]);
      assert.strictEqual(produto.imagem_principal, '/storage/produtos/2.jpg');

      const lista = await service.listarImagens(ins.lastID);
      const principais = lista.filter((i) => i.principal);
      assert.strictEqual(principais.length, 1);
      assert.strictEqual(principais[0].id, b.id);
      assert.ok(a.id);
    } finally {
      await closeDb(db);
      fs.unlinkSync(file);
    }
  });

  await test('limpar imagem_principal inativa principal na galeria', async () => {
    const { db, file } = await criarDb();
    try {
      const ins = await run(db, `INSERT INTO produtos (nome, imagem_principal) VALUES (?, ?)`, [
        'Limpar',
        '/storage/produtos/x.jpg'
      ]);
      const service = new ProdutoImagemService({ db });
      await service.sincronizarAPartirDeImagemPrincipal(ins.lastID, '/storage/produtos/x.jpg');
      await service.sincronizarAPartirDeImagemPrincipal(ins.lastID, null);
      const lista = await service.listarImagens(ins.lastID);
      assert.strictEqual(lista.length, 0);
    } finally {
      await closeDb(db);
      fs.unlinkSync(file);
    }
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
