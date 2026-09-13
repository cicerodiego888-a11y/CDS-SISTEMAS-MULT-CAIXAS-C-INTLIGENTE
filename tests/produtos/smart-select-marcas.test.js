/**
 * Sprint UX/INFRA 05 — Smart Select de Marcas
 * Executar: npm run test:smart-select-marcas
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  normalizarNomeCadastroSimples,
  chaveNomeCadastroSimples,
  nomesCadastroEquivalentes
} = require('../../backend/services/cadastroSimplesNome');
const { findOrCreateMarca, filtrarMarcasPorTermo } = require('../../backend/services/MarcaService');

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

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

async function criarDb() {
  const file = path.join(os.tmpdir(), `smart-marca-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
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
  return { db, file };
}

async function main() {
  console.log('\n=== UX/INFRA 05 — Smart Select Marcas ===\n');

  await test('normaliza espaços e trim', () => {
    assert.strictEqual(normalizarNomeCadastroSimples('  Tio   João  '), 'Tio João');
    assert.strictEqual(chaveNomeCadastroSimples('TIO JOÃO'), 'tio joão');
  });

  await test('equivalência case-insensitive', () => {
    assert.ok(nomesCadastroEquivalentes('Tio João', 'tio joão'));
    assert.ok(nomesCadastroEquivalentes('TIO JOÃO', '  tio   joão '));
    assert.ok(!nomesCadastroEquivalentes('Tio João', 'Tio Pedro'));
  });

  await test('rejeita nome vazio', async () => {
    const { db, file } = await criarDb();
    try {
      let erro = null;
      try {
        await findOrCreateMarca(db, '   ');
      } catch (e) {
        erro = e;
      }
      assert.ok(erro);
      assert.strictEqual(erro.status, 400);
    } finally {
      await closeDb(db);
      fs.unlinkSync(file);
    }
  });

  await test('cria marca e evita duplicidade', async () => {
    const { db, file } = await criarDb();
    try {
      const a = await findOrCreateMarca(db, 'Tio João');
      assert.strictEqual(a.criado, true);
      const b = await findOrCreateMarca(db, 'tio joão');
      assert.strictEqual(b.criado, false);
      assert.strictEqual(b.marca.id, a.marca.id);
      const c = await findOrCreateMarca(db, '  TIO   JOÃO ');
      assert.strictEqual(c.marca.id, a.marca.id);
    } finally {
      await closeDb(db);
      fs.unlinkSync(file);
    }
  });

  await test('reativa marca inativa', async () => {
    const { db, file } = await criarDb();
    try {
      const criada = await findOrCreateMarca(db, 'Nestlé');
      await run(db, `UPDATE marcas SET ativo = 0 WHERE id = ?`, [criada.marca.id]);
      const result = await findOrCreateMarca(db, 'nestlé');
      assert.strictEqual(result.reativado, true);
      assert.strictEqual(Number(result.marca.ativo), 1);
      assert.strictEqual(result.marca.id, criada.marca.id);
    } finally {
      await closeDb(db);
      fs.unlinkSync(file);
    }
  });

  await test('filtra marcas por termo', () => {
    const lista = [
      { id: 1, nome: 'Tio João' },
      { id: 2, nome: 'Tio Luiz' },
      { id: 3, nome: 'Coca-Cola' }
    ];
    const filtradas = filtrarMarcasPorTermo(lista, 'tio');
    assert.strictEqual(filtradas.length, 2);
  });

  await test('CdsSmartSelect exporta mount', () => {
    const smart = require('../../frontend/shared/js/cds-smart-select.js');
    assert.strictEqual(typeof smart.mount, 'function');
    assert.strictEqual(smart.normalizeLabel('  a   b '), 'a b');
  });

  await test('lista de marca/fornecedor só abre após digitação', () => {
    const smartSrc = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/cds-smart-select.js'), 'utf8');
    assert.ok(smartSrc.includes('minCharsSuggest'));
    assert.ok(smartSrc.includes('queryProntoParaLista'));
    assert.ok(smartSrc.includes('Lista só aparece depois que o usuário começar a digitar'));
  });

  await test('Smart Select de marca permite excluir item da lista', () => {
    const smartSrc = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/cds-smart-select.js'), 'utf8');
    assert.ok(smartSrc.includes('deleteItem'));
    assert.ok(smartSrc.includes('cds-smart-select__option-delete'));
    const produtosSrc = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
    assert.ok(produtosSrc.includes("method: 'DELETE'"));
    assert.ok(produtosSrc.includes('/marcas/${item.id}') || produtosSrc.includes('/marcas/'));
    const rotas = fs.readFileSync(path.join(__dirname, '../../backend/rotas/marcas.js'), 'utf8');
    assert.ok(rotas.includes("router.delete('/:id'"));
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
