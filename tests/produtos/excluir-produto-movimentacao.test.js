'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const {
  excluirProdutoCadastro,
  usuarioEhSuperAdmin,
  MSG_BLOQUEIO_MOVIMENTACAO
} = require('../../backend/services/excluirProdutoService');

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log('OK', nome))
    .catch((err) => {
      console.error('FAIL', nome);
      throw err;
    });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function criarDb() {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excluir-prod-'));
    const db = new sqlite3.Database(path.join(dir, 't.db'), (err) => {
      if (err) return reject(err);
      db.run('PRAGMA foreign_keys = ON', (pragmaErr) => {
        if (pragmaErr) return reject(pragmaErr);
        resolve(db);
      });
    });
  });
}

async function prepararSchema(db) {
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT,
    nome TEXT NOT NULL,
    ativo INTEGER DEFAULT 1
  )`);
  await run(db, `CREATE TABLE vendas_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER,
    produto_id INTEGER,
    quantidade REAL NOT NULL DEFAULT 1,
    preco_unitario REAL NOT NULL DEFAULT 1,
    subtotal REAL NOT NULL DEFAULT 1,
    FOREIGN KEY (produto_id) REFERENCES produtos(id)
  )`);
  await run(db, `CREATE TABLE compras_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compra_id INTEGER,
    produto_id INTEGER,
    quantidade REAL NOT NULL DEFAULT 1,
    preco_unitario REAL NOT NULL DEFAULT 1,
    subtotal REAL NOT NULL DEFAULT 1,
    FOREIGN KEY (produto_id) REFERENCES produtos(id)
  )`);
  await run(db, `CREATE TABLE compras_devolucoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compra_id INTEGER NOT NULL,
    compra_item_id INTEGER NOT NULL,
    produto_id INTEGER NOT NULL,
    quantidade REAL NOT NULL DEFAULT 1,
    valor_unitario REAL NOT NULL DEFAULT 1,
    valor_total REAL NOT NULL DEFAULT 1
  )`);
  await run(db, `CREATE TABLE produtos_ajustes_estoque (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER NOT NULL,
    motivo TEXT NOT NULL,
    FOREIGN KEY (produto_id) REFERENCES produtos(id)
  )`);
  await run(db, `CREATE TABLE produtos_lotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER NOT NULL,
    lote TEXT NOT NULL,
    quantidade_inicial REAL NOT NULL DEFAULT 0,
    quantidade_atual REAL NOT NULL DEFAULT 0,
    data_validade DATE,
    data_entrada DATE,
    origem TEXT NOT NULL DEFAULT 'COMPRA',
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
  )`);
}

async function main() {
  await test('somente SUPER_ADMIN é super usuário', () => {
    assert.strictEqual(usuarioEhSuperAdmin({ perfil: 'SUPER_ADMIN' }), true);
    assert.strictEqual(usuarioEhSuperAdmin({ perfil: 'ADMIN' }), false);
    assert.strictEqual(usuarioEhSuperAdmin({ perfil: 'USUARIO' }), false);
    assert.strictEqual(usuarioEhSuperAdmin({ role: 'admin' }), false);
  });

  const db = await criarDb();
  await prepararSchema(db);

  await run(db, `INSERT INTO produtos (codigo, nome) VALUES ('A1', 'Sem movimento')`);
  await run(db, `INSERT INTO produtos (codigo, nome) VALUES ('B2', 'Com venda')`);
  await run(db, `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal)
    VALUES (1, 2, 1, 10, 10)`);

  await test('ADMIN não exclui produto com movimentação', async () => {
    await assert.rejects(
      () => excluirProdutoCadastro(db, { produtoId: 2, usuario: { perfil: 'ADMIN' } }),
      (err) => {
        assert.strictEqual(err.statusCode, 409);
        assert.strictEqual(err.message, MSG_BLOQUEIO_MOVIMENTACAO);
        return true;
      }
    );
    const ainda = await get(db, 'SELECT id FROM produtos WHERE id = 2');
    assert.ok(ainda);
  });

  await test('usuário comum não exclui produto com movimentação', async () => {
    await assert.rejects(
      () => excluirProdutoCadastro(db, { produtoId: 2, usuario: { perfil: 'USUARIO' } }),
      (err) => err.statusCode === 409
    );
  });

  await test('qualquer perfil exclui produto sem movimentação', async () => {
    const r = await excluirProdutoCadastro(db, {
      produtoId: 1,
      usuario: { perfil: 'USUARIO' }
    });
    assert.strictEqual(r.forcado, false);
    const sumiu = await get(db, 'SELECT id FROM produtos WHERE id = 1');
    assert.strictEqual(sumiu, undefined);
  });

  await test('SUPER_ADMIN exclui produto mesmo com venda', async () => {
    const r = await excluirProdutoCadastro(db, {
      produtoId: 2,
      usuario: { perfil: 'SUPER_ADMIN' }
    });
    assert.strictEqual(r.forcado, true);
    const sumiu = await get(db, 'SELECT id FROM produtos WHERE id = 2');
    assert.strictEqual(sumiu, undefined);
    const item = await get(db, 'SELECT produto_id FROM vendas_itens WHERE id = 1');
    assert.ok(item, 'histórico da venda deve permanecer');
  });

  await test('rota e tela usam a regra do Super Administrador', () => {
    const rota = fs.readFileSync(path.join(__dirname, '../../backend/rotas/produtos.js'), 'utf8');
    assert.ok(rota.includes('excluirProdutoCadastro'));
    assert.ok(rota.includes('deletar_produto_com_movimentacao'));

    const front = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
    assert.ok(front.includes('isSuperAdminUser'));
    assert.ok(front.includes('mesmo se o produto tiver vendas'));
  });

  await new Promise((resolve) => db.close(() => resolve()));
  console.log('\nExclusão de produto com movimentação OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
