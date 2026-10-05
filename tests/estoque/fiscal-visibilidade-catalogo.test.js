'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const { criarBuscaOperacionalProdutosService, normalizarNomeBusca } = require('../../backend/services/busca-operacional-produtos');
const CatalogSnapshot = require('../../backend/motores/mib/catalog/CatalogSnapshot');
const HotCache = require('../../backend/motores/mib/cache/HotCache');

async function criarDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fiscal-visibilidade-'));
  const db = new sqlite3.Database(path.join(dir, 't.db'));
  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE produtos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT,
        codigo_barras TEXT,
        nome TEXT,
        nome_busca TEXT,
        ativo INTEGER DEFAULT 1,
        item_fiscal INTEGER DEFAULT 1,
        categoria_id INTEGER,
        marca_id INTEGER,
        preco_venda REAL DEFAULT 0,
        estoque_atual REAL DEFAULT 0,
        saldo_fiscal REAL DEFAULT 0,
        saldo_nao_fiscal REAL DEFAULT 0,
        controla_estoque INTEGER DEFAULT 1
      )`, (err) => err ? reject(err) : null);
      db.run(`CREATE TABLE produto_identificadores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_id INTEGER,
        tipo TEXT,
        codigo TEXT,
        ativo INTEGER DEFAULT 1,
        principal INTEGER DEFAULT 0
      )`, (err) => err ? reject(err) : null);
      db.run(`CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT)`, (err) => err ? reject(err) : null);
      db.run(`CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT)`, (err) => err ? reject(err) : null);
      db.run(`CREATE TABLE produto_atacado (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_id INTEGER,
        preco_atacado REAL,
        quantidade_minima REAL
      )`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
  return db;
}

test('Busca operacional encontra produto alternativo em modo fiscal', async () => {
  const db = await criarDb();
  try {
    await new Promise((resolve, reject) => {
      db.run(`INSERT INTO produtos (codigo, codigo_barras, nome, nome_busca, item_fiscal, saldo_fiscal, saldo_nao_fiscal, preco_venda)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['TOMATE-ALT', '', 'Tomate', normalizarNomeBusca('Tomate'), 0, 0, 15, 10],
        function onRun(err) { err ? reject(err) : resolve(); }
      );
    });

    const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => [] });
    const r = await svc.buscar({ q: 'Tomate', incluirSugestoes: false, modoFiscal: true });
    assert.ok(r.itens.some((p) => String(p.nome).toLowerCase() === 'tomate'));
    assert.ok(r.itens.some((p) => Number(p.item_fiscal) === 0));
  } finally {
    await new Promise((resolve) => db.close(() => resolve()));
  }
});

test('CatalogSnapshot continua visível em modo fiscal quando item_fiscal=0', () => {
  const snapshot = CatalogSnapshot.fromRows([
    { id: 1, nome: 'Tomate', nome_busca: 'tomate', codigo: 'TOMATE', codigo_barras: '', plu: '', item_fiscal: 0 }
  ]);

  const itens = snapshot.filtrar('tomate', { modoFiscal: true, limite: 20 });
  assert.equal(itens.length, 1);
  assert.equal(itens[0].item_fiscal, 0);
});

test('HotCache continua visível em modo fiscal quando item_fiscal=0', () => {
  const cache = new HotCache({ size: 10 });
  cache._byId.set(10, {
    id: 10,
    nome: 'Tomate',
    nome_busca: 'tomate',
    codigo: 'TOMATE',
    codigo_barras: '',
    plu: '',
    item_fiscal: 0,
    preco: 10
  });

  const itens = cache.buscar('tomate', 'tomate', { modoFiscal: true, limite: 20 });
  assert.equal(itens.length, 1);
  assert.equal(itens[0].item_fiscal, 0);
});
