'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const {
  findOrCreateFornecedor,
  filtrarFornecedoresPorTermo
} = require('../../backend/services/FornecedorCadastroSimplesService');

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log('OK', nome))
    .catch((err) => {
      console.error('FAIL', nome);
      throw err;
    });
}

function openDb(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function cb(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function criarDb() {
  const file = path.join(os.tmpdir(), `forn-smart-${Date.now()}.db`);
  const db = await openDb(file);
  await run(db, `CREATE TABLE fornecedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    razao_social TEXT,
    cpf_cnpj TEXT
  )`);
  return { db, file };
}

async function main() {
  await test('cria fornecedor pelo nome e evita duplicidade', async () => {
    const { db, file } = await criarDb();
    try {
      const a = await findOrCreateFornecedor(db, '  Distribuidora   Alpha ');
      assert.strictEqual(a.criado, true);
      assert.strictEqual(a.fornecedor.nome, 'Distribuidora Alpha');
      const b = await findOrCreateFornecedor(db, 'distribuidora alpha');
      assert.strictEqual(b.criado, false);
      assert.strictEqual(b.fornecedor.id, a.fornecedor.id);
    } finally {
      await new Promise((resolve) => db.close(() => resolve()));
      try { fs.unlinkSync(file); } catch (_) { /* Windows pode manter o lock por um instante */ }
    }
  });

  await test('filtra por nome e CNPJ', () => {
    const lista = [
      { id: 1, nome: 'Alpha Ltda', cpf_cnpj: '12.345.678/0001-90' },
      { id: 2, nome: 'Beta SA', razao_social: 'Beta Comércio' }
    ];
    assert.strictEqual(filtrarFornecedoresPorTermo(lista, 'alpha').length, 1);
    assert.strictEqual(filtrarFornecedoresPorTermo(lista, '12345678').length, 1);
    assert.strictEqual(filtrarFornecedoresPorTermo(lista, 'comercio').length, 1);
  });

  await test('cadastro de produto usa Smart Select opcional de fornecedor', () => {
    const produtos = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
    assert.ok(produtos.includes('inicializarFornecedorProdutoCadastro'));
    assert.ok(produtos.includes('Buscar ou criar fornecedor (opcional)'));
    assert.ok(produtos.includes('/fornecedores/find-or-create'));
    assert.ok(produtos.includes('deleteItem:'));
    assert.ok(produtos.includes('/fornecedores/${encodeURIComponent(id)}'));
    assert.ok(produtos.includes('obterNomeFornecedorCadastro'));
    assert.doesNotMatch(produtos, /inicializarAutocompleteFornecedor/);
    const rotas = fs.readFileSync(path.join(__dirname, '../../backend/rotas/fornecedores.js'), 'utf8');
    assert.ok(rotas.includes("router.post('/find-or-create'"));
    assert.ok(rotas.includes("router.delete('/:id'"));
  });

  console.log('\nSmart Select fornecedor OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
