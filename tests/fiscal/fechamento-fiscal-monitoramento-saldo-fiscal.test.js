/**
 * Monitoramento fiscal: somente item_fiscal = 1 AND saldo_fiscal > 0.
 * Executar: node tests/fiscal/fechamento-fiscal-monitoramento-saldo-fiscal.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const {
  garantirSchemaFechamentoFiscal,
  listarMonitoramentoProdutosDoDia,
  listarLotesElegiveisDoDia,
  listarProdutosElegiveisDoDia,
  obterResumoDia
} = require('../../backend/services/fechamento-fiscal');
const moduloConfig = require('../../backend/services/fechamento-fiscal/fechamentoFiscalModuloConfig');

let ok = 0;
let falhas = 0;

async function test(nome, fn) {
  try {
    await fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${err && err.stack ? err.stack : err}`);
  }
}

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

async function schemaBase(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS configuracoes (
    chave TEXT PRIMARY KEY, valor TEXT
  )`);
  await run(db, `INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES ('fechamento_fiscal_do_dia', '1')`);
  await run(db, `CREATE TABLE IF NOT EXISTS produtos (
    id INTEGER PRIMARY KEY,
    nome TEXT, codigo TEXT,
    preco_venda REAL DEFAULT 0,
    preco_compra REAL DEFAULT 0,
    item_fiscal INTEGER DEFAULT 0,
    saldo_fiscal REAL DEFAULT 0,
    saldo_nao_fiscal REAL DEFAULT 0,
    ativo INTEGER DEFAULT 1,
    ncm TEXT, cfop TEXT, csosn TEXT, origem INTEGER DEFAULT 0, unidade TEXT DEFAULT 'UN'
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS vendas (
    id INTEGER PRIMARY KEY,
    data_venda TEXT,
    total REAL DEFAULT 0,
    valor_fiscal REAL DEFAULT 0,
    valor_nao_fiscal REAL DEFAULT 0,
    status TEXT,
    cancelada INTEGER DEFAULT 0
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS vendas_itens (
    id INTEGER PRIMARY KEY,
    venda_id INTEGER,
    produto_id INTEGER,
    quantidade REAL DEFAULT 0,
    quantidade_fiscal REAL DEFAULT 0,
    quantidade_nao_fiscal REAL DEFAULT 0,
    subtotal REAL DEFAULT 0,
    valor_fiscal REAL DEFAULT 0,
    valor_nao_fiscal REAL DEFAULT 0,
    preco_unitario REAL DEFAULT 0,
    item_fiscal INTEGER DEFAULT 0
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS vendas_devolucoes (
    id INTEGER PRIMARY KEY,
    venda_id INTEGER,
    venda_item_id INTEGER,
    produto_id INTEGER,
    quantidade REAL DEFAULT 0,
    valor_total REAL DEFAULT 0
  )`);
  await garantirSchemaFechamentoFiscal(db);
}

async function inserirVendaNf(db, { vendaId, itemId, produtoId, data, qtd, preco }) {
  const total = Number((qtd * preco).toFixed(2));
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
    VALUES (?,?,?,?, 'concluida', 0)`, [vendaId, data, total, total]);
  await run(db, `INSERT INTO vendas_itens
    (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario,item_fiscal)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
    itemId, vendaId, produtoId, qtd, qtd, 0, total, total, total, preco, 1
  ]);
}

async function main() {
  console.log('\n=== Monitoramento fiscal — saldo_fiscal > 0 ===\n');
  moduloConfig._resetCacheForTests();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffd-mon-sf-'));
  const db = await openDb(path.join(dir, 'test.db'));
  await schemaBase(db);
  moduloConfig._resetCacheForTests();

  const DATA = '2026-09-14';

  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,item_fiscal,saldo_fiscal,saldo_nao_fiscal)
    VALUES (1,'Nao fiscal com saldo','NF1',10,0,100,0)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,item_fiscal,saldo_fiscal,saldo_nao_fiscal)
    VALUES (2,'Fiscal sem saldo','F0',10,1,0,50)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,item_fiscal,saldo_fiscal,saldo_nao_fiscal)
    VALUES (3,'Fiscal negativo','FNEG',10,1,-5,50)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,item_fiscal,saldo_fiscal,saldo_nao_fiscal)
    VALUES (4,'Fiscal saldo 1','F1',10,1,1,0)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,item_fiscal,saldo_fiscal,saldo_nao_fiscal)
    VALUES (5,'Fiscal saldo 100','F100',10,1,100,0)`);

  await inserirVendaNf(db, { vendaId: 1, itemId: 11, produtoId: 1, data: DATA, qtd: 2, preco: 10 });
  await inserirVendaNf(db, { vendaId: 2, itemId: 12, produtoId: 2, data: DATA, qtd: 2, preco: 10 });
  await inserirVendaNf(db, { vendaId: 3, itemId: 13, produtoId: 3, data: DATA, qtd: 2, preco: 10 });
  await inserirVendaNf(db, { vendaId: 4, itemId: 14, produtoId: 4, data: DATA, qtd: 2, preco: 10 });
  await inserirVendaNf(db, { vendaId: 5, itemId: 15, produtoId: 5, data: DATA, qtd: 2, preco: 10 });

  const mon = await listarMonitoramentoProdutosDoDia(db, DATA);
  const ids = mon.map((p) => Number(p.produto_id));

  await test('TESTE 1 — produto não fiscal (item_fiscal=0, saldo_fiscal>0) NÃO monitora', async () => {
    assert.ok(!ids.includes(1), `não deveria incluir produto 1, ids=${ids.join(',')}`);
  });

  await test('TESTE 2 — produto fiscal sem saldo (saldo_fiscal=0) NÃO monitora', async () => {
    assert.ok(!ids.includes(2), `não deveria incluir produto 2, ids=${ids.join(',')}`);
  });

  await test('TESTE 3 — produto fiscal com saldo negativo NÃO monitora', async () => {
    assert.ok(!ids.includes(3), `não deveria incluir produto 3, ids=${ids.join(',')}`);
  });

  await test('TESTE 4 — produto fiscal com saldo_fiscal=1 APARECE', async () => {
    const p = mon.find((x) => Number(x.produto_id) === 4);
    assert.ok(p, 'produto 4 deveria aparecer no monitoramento');
    assert.strictEqual(Number(p.item_fiscal), 1);
  });

  await test('TESTE 5 — produto fiscal com saldo_fiscal=100 APARECE', async () => {
    const p = mon.find((x) => Number(x.produto_id) === 5);
    assert.ok(p, 'produto 5 deveria aparecer no monitoramento');
    assert.strictEqual(Number(p.item_fiscal), 1);
  });

  await test('TESTE 6 — só saldo não fiscal não entra nos lotes do fechamento', async () => {
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    assert.ok(!lotes.some((l) => Number(l.produto_id) === 2));
    assert.ok(!lotes.some((l) => Number(l.produto_id) === 1));
    assert.ok(!lotes.some((l) => Number(l.produto_id) === 3));
    const produtos = await listarProdutosElegiveisDoDia(db, DATA);
    assert.ok(!produtos.some((p) => Number(p.produto_id) === 2));
    assert.ok(produtos.some((p) => Number(p.produto_id) === 4));
    assert.ok(produtos.some((p) => Number(p.produto_id) === 5));
  });

  await test('TESTE 7 — Coca Cola só NF (item_fiscal=1, saldo_fiscal=0) não conta no painel', async () => {
    const r = await obterResumoDia(db, DATA);
    assert.equal(Number(r.produtos_fiscais_vendidos), 2);
    assert.equal(Number(r.vendas_do_dia), 2);
    assert.equal(Number(r.vendas_nao_fiscais), 2);
    assert.equal(Number(r.valor_nao_fiscal_vendido), 40);
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    const idsLote = new Set(lotes.map((l) => Number(l.produto_id)));
    assert.equal(idsLote.has(2), false);
    assert.equal(idsLote.has(4), true);
    assert.equal(idsLote.has(5), true);
    assert.ok(!mon.some((p) => Number(p.produto_id) === 2));
  });

  await test('TESTE 8 — produto só com saldo fiscal é elegível', async () => {
    await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,item_fiscal,saldo_fiscal,saldo_nao_fiscal)
      VALUES (6,'So Fiscal','SF',10,1,50,0)`);
    await inserirVendaNf(db, { vendaId: 6, itemId: 16, produtoId: 6, data: DATA, qtd: 1, preco: 10 });
    const lotes = await listarLotesElegiveisDoDia(db, DATA);
    const mon2 = await listarMonitoramentoProdutosDoDia(db, DATA);
    assert.ok(lotes.some((l) => Number(l.produto_id) === 6));
    assert.ok(mon2.some((p) => Number(p.produto_id) === 6));
  });

  await db.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }

  console.log(`\nResultado monitoramento saldo_fiscal: ${ok} OK, ${falhas} falha(s)\n`);
  if (falhas > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
