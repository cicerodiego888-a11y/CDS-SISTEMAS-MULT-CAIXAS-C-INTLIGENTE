'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { resolverFlagsObrigatoriosCategoria } = require('../../backend/services/categorias/categoriaPadroes');
const { inserirProduto } = require('../../backend/services/importacao-inicial-produtos/importer');
const compras = require('../../backend/rotas/compras');
const {
  normalizarProdutosCategoriaEspecial,
  normalizarProdutoCategoriaEspecial
} = require('../../backend/services/categorias/normalizacaoProdutosCategoriaEspecial');

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

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function criarDb() {
  const db = await openDb();
  await run(db, 'CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT NOT NULL)');
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY,
    categoria_id INTEGER,
    item_fiscal INTEGER,
    controla_estoque INTEGER,
    saldo_fiscal REAL,
    saldo_nao_fiscal REAL,
    estoque_atual REAL,
    reservado_fiscal REAL,
    reservado_nao_fiscal REAL,
    comprometido_fiscal REAL,
    comprometido_nao_fiscal REAL
  )`);
  await run(db, 'CREATE TABLE produtos_ajustes_estoque (id INTEGER PRIMARY KEY, produto_id INTEGER)');
  await run(db, 'INSERT INTO categorias (id, nome) VALUES (1, ?), (2, ?), (3, ?)', [
    'AÇOUGUE', 'Horti-Fruti', 'Mercearia'
  ]);
  await run(db, `INSERT INTO produtos VALUES
    (1, 1, 1, 1, 12, 3, 15, 2, 1, 4, 2),
    (2, 2, 1, 1, 8, 5, 13, 1, 2, 3, 4),
    (3, 3, 1, 1, 20, 0, 20, 0, 0, 0, 0)`);
  return db;
}

function fechar(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

async function criarDbCadastro() {
  const db = await openDb();
  await run(db, 'CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT, tipo TEXT DEFAULT \'produto\', ativo INTEGER DEFAULT 1)');
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT, nome TEXT, categoria_id INTEGER,
    subcategoria_id INTEGER, unidade TEXT, preco_compra REAL, lucro_percentual REAL,
    preco_venda REAL, estoque_atual REAL, estoque_minimo REAL, fornecedor TEXT,
    ncm TEXT, cfop TEXT, csosn TEXT, origem TEXT, cest TEXT, codigo_barras TEXT,
    aliquota_icms REAL, aliquota_pis REAL, aliquota_cofins REAL, controlar_validade INTEGER,
    controla_estoque INTEGER, vendido_por_peso INTEGER, produto_fracionado INTEGER,
    peso_total_compra REAL, valor_total_compra REAL, custo_por_kg REAL, venda_atacado INTEGER,
    saldo_fiscal REAL, saldo_nao_fiscal REAL, item_fiscal INTEGER,
    permite_venda_unidade INTEGER, peso_medio_unidade REAL, preco_unidade REAL,
    marca_id INTEGER, observacoes TEXT, imagem_principal TEXT, updated_at TEXT
  )`);
  return db;
}

describe('Sprint 17 — normalização cadastral isolada', () => {
  it('normaliza somente flags e é idempotente, sem tocar saldos, reservas ou comprometimentos', async () => {
    const db = await criarDb();
    try {
      const antes = await all(db, 'SELECT * FROM produtos ORDER BY id');
      const resultado = await normalizarProdutosCategoriaEspecial(db);
      const depois = await all(db, 'SELECT * FROM produtos ORDER BY id');
      const segundaExecucao = await normalizarProdutosCategoriaEspecial(db);

      assert.equal(resultado.produtosAlterados, 2);
      assert.equal(segundaExecucao.produtosAlterados, 0);
      assert.equal(depois[0].item_fiscal, 0);
      assert.equal(depois[0].controla_estoque, 0);
      assert.equal(depois[1].item_fiscal, 0);
      assert.equal(depois[1].controla_estoque, 0);
      assert.equal(depois[2].item_fiscal, 1);
      assert.equal(depois[2].controla_estoque, 1);

      for (const campo of [
        'saldo_fiscal', 'saldo_nao_fiscal', 'estoque_atual',
        'reservado_fiscal', 'reservado_nao_fiscal',
        'comprometido_fiscal', 'comprometido_nao_fiscal'
      ]) {
        assert.deepEqual(depois.map((row) => row[campo]), antes.map((row) => row[campo]), campo);
      }
      assert.equal((await all(db, 'SELECT * FROM produtos_ajustes_estoque')).length, 0);
    } finally {
      await fechar(db);
    }
  });

  it('normaliza produtos legados de categoria especial mesmo quando item_fiscal/controla_estoque vierem nulos ou em valores antigos', async () => {
    const db = await criarDb();
    try {
      await run(db, 'UPDATE produtos SET item_fiscal = NULL, controla_estoque = NULL WHERE id IN (1, 2)');
      const resultado = await normalizarProdutosCategoriaEspecial(db);
      const rows = await all(db, 'SELECT id, item_fiscal, controla_estoque FROM produtos WHERE id IN (1, 2) ORDER BY id');

      assert.equal(resultado.produtosAlterados, 2);
      assert.deepEqual(rows, [
        { id: 1, item_fiscal: 0, controla_estoque: 0 },
        { id: 2, item_fiscal: 0, controla_estoque: 0 }
      ]);
    } finally {
      await fechar(db);
    }
  });

  it('normaliza apenas o produto indicado quando a categoria de destino é especial', async () => {
    const db = await criarDb();
    try {
      await run(db, 'UPDATE produtos SET categoria_id = 1 WHERE id = 3');
      const resultado = await normalizarProdutoCategoriaEspecial(db, 3, 1);
      const rows = await all(db, 'SELECT id, item_fiscal, controla_estoque FROM produtos ORDER BY id');
      assert.equal(resultado.produtosAlterados, 1);
      assert.deepEqual(rows, [
        { id: 1, item_fiscal: 1, controla_estoque: 1 },
        { id: 2, item_fiscal: 1, controla_estoque: 1 },
        { id: 3, item_fiscal: 0, controla_estoque: 0 }
      ]);
    } finally {
      await fechar(db);
    }
  });

  it('produto movido para Hortifruti fica 0/0 sem mudar seus saldos', async () => {
    const db = await criarDb();
    try {
      await run(db, 'UPDATE produtos SET categoria_id = 2 WHERE id = 3');
      const resultado = await normalizarProdutoCategoriaEspecial(db, 3, 2);
      const row = (await all(db, 'SELECT * FROM produtos WHERE id = 3'))[0];
      assert.equal(resultado.produtosAlterados, 1);
      assert.equal(row.item_fiscal, 0);
      assert.equal(row.controla_estoque, 0);
      assert.equal(row.saldo_fiscal, 20);
      assert.equal(row.saldo_nao_fiscal, 0);
      assert.equal(row.estoque_atual, 20);
    } finally {
      await fechar(db);
    }
  });

  it('ao mover para categoria comum, não inventa novos flags nem restaura valores', async () => {
    const db = await criarDb();
    try {
      await normalizarProdutosCategoriaEspecial(db);
      await run(db, 'UPDATE produtos SET categoria_id = 3 WHERE id = 1');
      const resultado = await normalizarProdutoCategoriaEspecial(db, 1, 3);
      const row = (await all(db, 'SELECT item_fiscal, controla_estoque FROM produtos WHERE id = 1'))[0];
      assert.equal(resultado.produtosAlterados, 0);
      assert.deepEqual(row, { item_fiscal: 0, controla_estoque: 0 });
    } finally {
      await fechar(db);
    }
  });

  it('importação cria produto de Açougue com 0/0 apesar dos flags de origem', async () => {
    const db = await criarDbCadastro();
    try {
      const categoria = await run(db, `INSERT INTO categorias (nome) VALUES ('Açougue')`);
      const produtoId = await inserirProduto(db, {
        status: 'PRONTO',
        produto: {
          codigo_origem: 'IMP-17-1',
          nome: 'Carne bovina',
          categoria: 'Açougue',
          controla_estoque: 1,
          item_fiscal: 1,
          custo_unitario: 10,
          preco_venda: 15
        },
        classificacao: { categoria_id: categoria.lastID },
        apresentacoes: []
      }, { categorias: new Map(), subcategorias: new Map() }, null);
      const rows = await all(db, 'SELECT item_fiscal, controla_estoque FROM produtos WHERE id = ?', [produtoId]);
      assert.deepEqual(rows[0], { item_fiscal: 0, controla_estoque: 0 });
    } finally {
      await fechar(db);
    }
  });

  it('compra cria produto associado a Hortifruti com 0/0 sem mudar natureza fiscal da entrada', async () => {
    const db = await criarDbCadastro();
    try {
      const categoria = await run(db, `INSERT INTO categorias (nome) VALUES ('Hortifruti')`);
      const produtoId = await new Promise((resolve, reject) => {
        compras.ensureProductForItemLegado({
          codigo_barras: 'SPRINT17-HORTI',
          produto_nome: 'Alface',
          categoria_id: categoria.lastID,
          quantidade_fiscal: 2,
          quantidade_nao_fiscal: 0,
          controla_estoque: 1
        }, (err, id) => (err ? reject(err) : resolve(id)), { db });
      });
      const rows = await all(db, 'SELECT categoria_id, item_fiscal, controla_estoque FROM produtos WHERE id = ?', [produtoId]);
      assert.deepEqual(rows[0], {
        categoria_id: categoria.lastID,
        item_fiscal: 0,
        controla_estoque: 0
      });
      assert.equal(resolverFlagsObrigatoriosCategoria('Hortifruti').itemFiscal, 0);
    } finally {
      await fechar(db);
    }
  });

  it('compra automática preserva flags legados fora das categorias especiais', async () => {
    const db = await criarDbCadastro();
    try {
      const categoria = await run(db, `INSERT INTO categorias (nome) VALUES ('Mercearia')`);
      const produtoId = await new Promise((resolve, reject) => {
        compras.ensureProductForItemLegado({
          codigo_barras: 'SPRINT17-MERCEARIA',
          produto_nome: 'Arroz',
          categoria_id: categoria.lastID,
          quantidade_fiscal: 2,
          controla_estoque: 0
        }, (err, id) => (err ? reject(err) : resolve(id)), { db });
      });
      const rows = await all(db, 'SELECT categoria_id, item_fiscal, controla_estoque FROM produtos WHERE id = ?', [produtoId]);
      assert.deepEqual(rows[0], { categoria_id: null, item_fiscal: 1, controla_estoque: 1 });
    } finally {
      await fechar(db);
    }
  });

  it('regra não intercepta F×NF, F12 nem VENDA SEM ESTOQUE e liga os pontos de gravação', () => {
    const root = path.join(__dirname, '../..');
    const produtoRoute = fs.readFileSync(path.join(root, 'backend/rotas/produtos.js'), 'utf8');
    const categoriaRoute = fs.readFileSync(path.join(root, 'backend/rotas/categorias.js'), 'utf8');
    const comprasRoute = fs.readFileSync(path.join(root, 'backend/rotas/compras.js'), 'utf8');
    const importerSource = fs.readFileSync(path.join(root, 'backend/services/importacao-inicial-produtos/importer.js'), 'utf8');
    assert.match(produtoRoute, /resolverFlagsNovoProduto\(/);
    assert.match(produtoRoute, /normalizarProdutoCategoriaEspecial\(/);
    assert.match(categoriaRoute, /normalizarProdutosCategoriaEspecial\(/);
    assert.match(comprasRoute, /resolverFlagsObrigatoriosCategoria\(/);
    assert.match(importerSource, /resolverFlagsObrigatoriosCategoria\(/);
    assert.doesNotMatch(produtoRoute, /distribuidorEstoqueVenda|F12|VENDA SEM ESTOQUE/);
  });
});
