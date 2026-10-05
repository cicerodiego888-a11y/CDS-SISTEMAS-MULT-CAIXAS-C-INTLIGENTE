'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '../..');
const padroes = require('../../backend/services/categorias/categoriaPadroes');
const { normalizarProdutoCategoriaEspecial } = require('../../backend/services/categorias/normalizacaoProdutosCategoriaEspecial');

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
    try { db.close(() => resolve()); } catch (_) { resolve(); }
  });
}

async function schema(db) {
  await run(db, `
    CREATE TABLE categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      descricao TEXT,
      tipo TEXT NOT NULL DEFAULT 'produto',
      ativo INTEGER DEFAULT 1,
      padrao_controla_estoque INTEGER NOT NULL DEFAULT 1,
      padrao_controle_comercial TEXT NOT NULL DEFAULT 'PADRAO',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(db, `
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT,
      categoria_id INTEGER,
      controla_estoque INTEGER DEFAULT 1,
      item_fiscal INTEGER DEFAULT 1
    )
  `);
}

describe('Categoria — padrões de estoque e comercial', () => {
  it('criar categoria normal usa Controlado + Padrão', () => {
    const r = padroes.resolverPadroesCategoriaParaSalvar('Mercearia', {}, { criar: true });
    assert.equal(r.padrao_controla_estoque, 1);
    assert.equal(r.padrao_controle_comercial, 'PADRAO');
  });

  it('criar Hortifruti e Açougue usa Não controlado + Alternativo', () => {
    const h = padroes.resolverPadroesCategoriaParaSalvar('Hortifruti', {}, { criar: true });
    const a = padroes.resolverPadroesCategoriaParaSalvar('Açougue', {}, { criar: true });
    assert.equal(h.padrao_controla_estoque, 0);
    assert.equal(h.padrao_controle_comercial, 'ALTERNATIVO');
    assert.equal(a.padrao_controla_estoque, 0);
    assert.equal(a.padrao_controle_comercial, 'ALTERNATIVO');
  });

  it('listar serializa defaults compatíveis para categoria sem config', () => {
    const row = padroes.serializarCategoria({ id: 1, nome: 'Geral' });
    assert.equal(row.padrao_controla_estoque, 1);
    assert.equal(row.padrao_controle_comercial, 'PADRAO');
  });

  it('alterar padrão explícito não usa sugestão de nome no UPDATE', () => {
    const r = padroes.resolverPadroesCategoriaParaSalvar('Hortifruti', {
      padrao_controla_estoque: 1,
      padrao_controle_comercial: 'PADRAO'
    }, {
      criar: false,
      atual: { padrao_controla_estoque: 0, padrao_controle_comercial: 'ALTERNATIVO' }
    });
    assert.equal(r.padrao_controla_estoque, 1);
    assert.equal(r.padrao_controle_comercial, 'PADRAO');
  });

  it('categorias existentes no banco recebem default Controlado + Padrão', async () => {
    const db = await openDb();
    try {
      await run(db, `CREATE TABLE categorias (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE
      )`);
      await run(db, `INSERT INTO categorias (nome) VALUES ('Mercearia antiga')`);
      await run(db, `ALTER TABLE categorias ADD COLUMN padrao_controla_estoque INTEGER DEFAULT 1`);
      await run(db, `ALTER TABLE categorias ADD COLUMN padrao_controle_comercial TEXT DEFAULT 'PADRAO'`);
      const row = await get(db, 'SELECT * FROM categorias WHERE nome = ?', ['Mercearia antiga']);
      const ser = padroes.serializarCategoria(row);
      assert.equal(ser.padrao_controla_estoque, 1);
      assert.equal(ser.padrao_controle_comercial, 'PADRAO');
    } finally {
      await closeDb(db);
    }
  });

  it('reprodução: categorias Hortifruti/Açougue antigas herdam o default global fiscal', async () => {
    const db = await openDb();
    try {
      await run(db, `CREATE TABLE categorias (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE
      )`);
      await run(db, `INSERT INTO categorias (nome) VALUES ('Hortifruti'), ('Açougue')`);
      await run(db, `ALTER TABLE categorias ADD COLUMN padrao_controla_estoque INTEGER DEFAULT 1`);
      await run(db, `ALTER TABLE categorias ADD COLUMN padrao_controle_comercial TEXT DEFAULT 'PADRAO'`);

      const observado = [];
      for (const nome of ['Hortifruti', 'Açougue']) {
        const row = await get(db, 'SELECT * FROM categorias WHERE nome = ?', [nome]);
        const categoria = padroes.serializarCategoria(row);
        const flags = padroes.resolverFlagsNovoProduto({}, categoria, 0, 0);
        observado.push({ categoria: nome, controlaEstoque: flags.controlaEstoque, itemFiscal: flags.itemFiscal });
      }
      assert.deepEqual(observado, [
        { categoria: 'Hortifruti', controlaEstoque: 0, itemFiscal: 0 },
        { categoria: 'Açougue', controlaEstoque: 0, itemFiscal: 0 }
      ]);
    } finally {
      await closeDb(db);
    }
  });

  it('UPDATE da categoria não altera produtos existentes', async () => {
    const db = await openDb();
    try {
      await schema(db);
      const cat = await run(db, `
        INSERT INTO categorias (nome, padrao_controla_estoque, padrao_controle_comercial)
        VALUES ('Hortifruti', 0, 'ALTERNATIVO')
      `);
      await run(db, `
        INSERT INTO produtos (nome, categoria_id, controla_estoque, item_fiscal)
        VALUES ('Banana', ?, 1, 1)
      `, [cat.lastID]);
      await run(db, `
        UPDATE categorias SET padrao_controla_estoque = 1, padrao_controle_comercial = 'PADRAO' WHERE id = ?
      `, [cat.lastID]);
      const prod = await get(db, 'SELECT * FROM produtos WHERE nome = ?', ['Banana']);
      assert.equal(Number(prod.controla_estoque), 1);
      assert.equal(Number(prod.item_fiscal), 1);
    } finally {
      await closeDb(db);
    }
  });
});

describe('Produto — herança do padrão da categoria', () => {
  it('novo produto herda padrão da categoria', () => {
    const flags = padroes.resolverFlagsNovoProduto(
      { nome: 'Alface' },
      { padrao_controla_estoque: 0, padrao_controle_comercial: 'ALTERNATIVO' },
      0,
      0
    );
    assert.equal(flags.controlaEstoque, 0);
    assert.equal(flags.itemFiscal, 0);
  });

  it('configuração explícita do produto tem prioridade', () => {
    const flags = padroes.resolverFlagsNovoProduto(
      { controla_estoque: 1, item_fiscal: 1 },
      { padrao_controla_estoque: 0, padrao_controle_comercial: 'ALTERNATIVO' },
      0,
      0
    );
    assert.equal(flags.controlaEstoque, 1);
    assert.equal(flags.itemFiscal, 1);
  });

  it('Hortifruti / Açougue: novo produto Não controlado + Alternativo', () => {
    const cat = padroes.resolverPadroesCategoriaParaSalvar('Hortifruti', {}, { criar: true });
    const flags = padroes.resolverFlagsNovoProduto({}, cat, 0, 0);
    assert.equal(flags.controlaEstoque, 0);
    assert.equal(flags.itemFiscal, 0);

    const acougue = padroes.resolverPadroesCategoriaParaSalvar('Açougue', {}, { criar: true });
    const flagsA = padroes.resolverFlagsNovoProduto({}, acougue, 0, 0);
    assert.equal(flagsA.controlaEstoque, 0);
    assert.equal(flagsA.itemFiscal, 0);
  });

  it('Açougue/Hortifruti força 0/0 mesmo com flags explícitas e nomes variados', () => {
    for (const nome of ['AÇOUGUE', 'Açougue bovino', 'HORTI-FRUTI', 'Hortifruti'] ) {
      const flags = padroes.resolverFlagsNovoProduto(
        { controla_estoque: 1, item_fiscal: 1 },
        { nome, padrao_controla_estoque: 1, padrao_controle_comercial: 'PADRAO' },
        50,
        20
      );
      assert.equal(flags.controlaEstoque, 0, `${nome}: controla_estoque`);
      assert.equal(flags.itemFiscal, 0, `${nome}: item_fiscal`);
    }
  });

  it('categoria normal: novo produto Controlado + Padrão', () => {
    const cat = padroes.resolverPadroesCategoriaParaSalvar('Mercearia', {}, { criar: true });
    const flags = padroes.resolverFlagsNovoProduto({}, cat, 0, 0);
    assert.equal(flags.controlaEstoque, 1);
    assert.equal(flags.itemFiscal, 1);
  });

  it('produto movido para categoria especial passa a 0/0', async () => {
    const db = await openDb();
    try {
      await schema(db);
      const horti = await run(db, `INSERT INTO categorias (nome, padrao_controla_estoque, padrao_controle_comercial) VALUES ('Hortifruti', 0, 'ALTERNATIVO')`);
      const acougue = await run(db, `INSERT INTO categorias (nome, padrao_controla_estoque, padrao_controle_comercial) VALUES ('Açougue', 0, 'ALTERNATIVO')`);
      await run(db, `INSERT INTO produtos (nome, categoria_id, controla_estoque, item_fiscal) VALUES ('Tomate', ?, 1, 1)`, [horti.lastID]);
      await run(db, `UPDATE produtos SET categoria_id = ? WHERE nome = 'Tomate'`, [acougue.lastID]);
      await normalizarProdutoCategoriaEspecial(db, 1, acougue.lastID);
      const prod = await get(db, 'SELECT * FROM produtos WHERE nome = ?', ['Tomate']);
      assert.equal(Number(prod.categoria_id), acougue.lastID);
      assert.equal(Number(prod.controla_estoque), 0);
      assert.equal(Number(prod.item_fiscal), 0);
    } finally {
      await closeDb(db);
    }
  });

  it('sem categoria usa default global existente', () => {
    const flags = padroes.resolverFlagsNovoProduto({}, null, 0, 0);
    assert.equal(flags.controlaEstoque, 1);
    assert.equal(flags.itemFiscal, 1);
  });
});

describe('Fonte — não sobrescreve produto nem expõe nomenclatura interna na UX nova', () => {
  it('rota de categorias não faz UPDATE em massa em produtos', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/categorias.js'), 'utf8');
    assert.doesNotMatch(src, /UPDATE\s+produtos/i);
    assert.match(src, /padrao_controla_estoque/);
    assert.match(src, /padrao_controle_comercial/);
  });

  it('database.js cria e migra as colunas com default seguro', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
    assert.match(src, /padrao_controla_estoque INTEGER NOT NULL DEFAULT 1/);
    assert.match(src, /padrao_controle_comercial TEXT NOT NULL DEFAULT 'PADRAO'/);
    assert.match(src, /ALTER TABLE categorias ADD COLUMN padrao_controla_estoque INTEGER DEFAULT 1/);
    assert.match(src, /ALTER TABLE categorias ADD COLUMN padrao_controle_comercial TEXT DEFAULT 'PADRAO'/);
  });

  it('UX de Controla Estoque permanece e Controle comercial é neutro', () => {
    const prod = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');
    assert.match(prod, /Controla Estoque/);
    assert.match(prod, /Quando desligado, a venda não valida nem movimenta saldo/);
    assert.match(prod, /Controle comercial/);
    assert.match(prod, /controle_comercial_padrao/);
    assert.match(prod, /controle_comercial_alternativo/);
    assert.match(prod, /aplicarPadraoCategoriaNoNovoProduto/);
    assert.match(prod, /if \(!isEdit\)/);

    const catJs = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/categorias.js'), 'utf8');
    assert.match(catJs, /Controlado/);
    assert.match(catJs, /Não controlado/);
    assert.match(catJs, /Alternativo/);
    assert.doesNotMatch(catJs, /item_fiscal/);
    assert.doesNotMatch(catJs, /saldo_fiscal/);
    assert.doesNotMatch(catJs, /Natureza Fiscal/);

    const catHtml = fs.readFileSync(path.join(ROOT, 'frontend/erp/pages/categorias.html'), 'utf8');
    assert.match(catHtml, /Controle de estoque/);
    assert.match(catHtml, /Controle comercial/);
    assert.doesNotMatch(catHtml, /item_fiscal/);
    assert.doesNotMatch(catHtml, /saldo_nao_fiscal/);
  });
});
