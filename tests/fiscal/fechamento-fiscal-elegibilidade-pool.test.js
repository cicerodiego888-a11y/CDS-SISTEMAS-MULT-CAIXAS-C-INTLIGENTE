'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const {
  listarLotesElegiveisDoDia,
  listarProdutosElegiveisDoDia
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalElegibilidadeService');
const { gerarPrevia } = require('../../backend/services/fechamento-fiscal/FechamentoFiscalService');

const DATA = '2026-10-01';

function abrirDb() {
  return new sqlite3.Database(':memory:');
}

function executar(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

function consultar(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function prepararDb() {
  const db = abrirDb();
  await executar(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT, item_fiscal INTEGER,
    saldo_fiscal REAL, saldo_nao_fiscal REAL, preco_venda REAL,
    preco_compra REAL DEFAULT 0, ativo INTEGER DEFAULT 1,
    ncm TEXT, cfop TEXT, csosn TEXT, origem INTEGER DEFAULT 0
  )`);
  await executar(db, `CREATE TABLE vendas (
    id INTEGER PRIMARY KEY, codigo TEXT, data_venda TEXT, total REAL,
    valor_fiscal REAL DEFAULT 0, valor_nao_fiscal REAL DEFAULT 0,
    status TEXT, cancelada INTEGER DEFAULT 0
  )`);
  await executar(db, `CREATE TABLE vendas_itens (
    id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER,
    quantidade REAL, quantidade_fiscal REAL, quantidade_nao_fiscal REAL,
    subtotal REAL, valor_fiscal REAL, valor_nao_fiscal REAL,
    preco_unitario REAL
  )`);
  await executar(db, `CREATE TABLE vendas_devolucoes (
    id INTEGER PRIMARY KEY, venda_id INTEGER, venda_item_id INTEGER,
    produto_id INTEGER, quantidade REAL, valor_total REAL
  )`);
  await executar(db, `CREATE TABLE movimentos_transferencia_saldos (
    id INTEGER PRIMARY KEY, produto_id INTEGER, quantidade REAL, origem TEXT, destino TEXT
  )`);
  return db;
}

async function inserirProduto(db, {
  id,
  nome = `Produto ${id}`,
  itemFiscal = 1,
  saldoFiscal,
  saldoNaoFiscal = 0,
  preco
}) {
  await executar(db, `INSERT INTO produtos
    (id,nome,codigo,item_fiscal,saldo_fiscal,saldo_nao_fiscal,preco_venda)
    VALUES (?,?,?,?,?,?,?)`, [id, nome, `P${id}`, itemFiscal, saldoFiscal, saldoNaoFiscal, preco]);
}

async function inserirVendaItem(db, {
  vendaId,
  itemId,
  produtoId,
  quantidadeFiscal,
  preco
}) {
  const valor = quantidadeFiscal * preco;
  await executar(db, `INSERT INTO vendas
    (id,codigo,data_venda,total,valor_fiscal,valor_nao_fiscal,status,cancelada)
    VALUES (?,?,?,?,?,?, 'concluida', 0)`,
  [vendaId, `V${vendaId}`, `${DATA} 10:00:00`, valor, valor, 0]);
  await executar(db, `INSERT INTO vendas_itens
    (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,
     subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (?,?,?,?,?,0,?,?,0,?)`,
  [itemId, vendaId, produtoId, quantidadeFiscal, quantidadeFiscal, valor, valor, preco]);
}

test('elegibilidade inclui produtos sem venda e mantém produtos vendidos no dia', async (t) => {
  const db = await prepararDb();
  t.after(() => db.close());
  await inserirProduto(db, { id: 1, saldoFiscal: 100, preco: 28 });
  await inserirProduto(db, { id: 2, saldoFiscal: 10, preco: 10 });
  await inserirVendaItem(db, { vendaId: 1, itemId: 11, produtoId: 2, quantidadeFiscal: 1, preco: 10 });

  const lotes = await listarLotesElegiveisDoDia(db, DATA);
  assert.deepEqual(lotes.map((lote) => lote.produto_id), [1, 2]);
  assert.equal(lotes.find((lote) => lote.produto_id === 1).quantidade_disponivel, 100);
  assert.equal(lotes.find((lote) => lote.produto_id === 1).origem_distribuicao, 'SALDO_FISCAL_CADASTRO');
  const produtos = await listarProdutosElegiveisDoDia(db, DATA);
  assert.equal(produtos.find((produto) => produto.produto_id === 1).quantidade_disponivel, 100);
  assert.equal(produtos.find((produto) => produto.produto_id === 1).valor_vendido_no_dia, 0);
});

test('elegibilidade limita venda histórica ao saldo fiscal e ignora saldo não fiscal', async (t) => {
  const db = await prepararDb();
  t.after(() => db.close());
  await inserirProduto(db, { id: 1, saldoFiscal: 2, saldoNaoFiscal: 100, preco: 10 });
  await inserirProduto(db, { id: 2, saldoFiscal: 0, saldoNaoFiscal: 100, preco: 10 });
  await inserirProduto(db, { id: 3, saldoFiscal: 3, saldoNaoFiscal: 100, preco: 10 });
  await inserirProduto(db, { id: 4, itemFiscal: 0, saldoFiscal: 50, preco: 10 });
  await inserirVendaItem(db, { vendaId: 1, itemId: 11, produtoId: 1, quantidadeFiscal: 10, preco: 10 });
  await inserirVendaItem(db, { vendaId: 2, itemId: 12, produtoId: 3, quantidadeFiscal: 10, preco: 10 });

  const lotes = await listarLotesElegiveisDoDia(db, DATA);
  const produtoA = lotes.filter((lote) => lote.produto_id === 1);
  const produtoB = lotes.filter((lote) => lote.produto_id === 3);
  assert.equal(produtoA.reduce((total, lote) => total + lote.quantidade_disponivel, 0), 2);
  assert.equal(produtoB.reduce((total, lote) => total + lote.quantidade_disponivel, 0), 3);
  assert.ok(!lotes.some((lote) => lote.produto_id === 2));
  assert.ok(!lotes.some((lote) => lote.produto_id === 4));
  assert.ok(lotes.every((lote) => lote.quantidade_disponivel >= 0));
});

test('prévia completa compõe produto não vendido e não altera saldos reais', async (t) => {
  const db = await prepararDb();
  t.after(() => db.close());
  await inserirProduto(db, { id: 1, nome: 'Produto A sem venda', saldoFiscal: 1, preco: 28 });
  await inserirProduto(db, { id: 2, nome: 'Produto B vendido', saldoFiscal: 1, preco: 10 });
  await inserirVendaItem(db, { vendaId: 1, itemId: 11, produtoId: 2, quantidadeFiscal: 1, preco: 10 });

  const antes = await consultar(db, 'SELECT id, preco_venda, preco_compra, saldo_fiscal, saldo_nao_fiscal FROM produtos ORDER BY id');
  const transferenciasAntes = await consultar(db, 'SELECT * FROM movimentos_transferencia_saldos');
  const previa = await gerarPrevia({
    data: DATA,
    valor_informado: 28,
    comprovantes: [28],
    persistir: false
  }, { db, moduloOn: true, capturarSnapshot: false });
  const depois = await consultar(db, 'SELECT id, preco_venda, preco_compra, saldo_fiscal, saldo_nao_fiscal FROM produtos ORDER BY id');
  const transferenciasDepois = await consultar(db, 'SELECT * FROM movimentos_transferencia_saldos');

  assert.equal(previa.previa.quantidade_vendas, 1);
  assert.deepEqual(previa.previa.vendas[0].itens.map((item) => item.produto_id), [1]);
  assert.deepEqual(depois, antes);
  assert.deepEqual(transferenciasDepois, transferenciasAntes);
});

test('comprovantes consecutivos consomem unidades internas sem reutilização', async (t) => {
  const db = await prepararDb();
  t.after(() => db.close());
  await inserirProduto(db, { id: 1, saldoFiscal: 5, preco: 1 });

  const previa = await gerarPrevia({
    data: DATA,
    valor_informado: 5,
    comprovantes: [3, 2],
    persistir: false
  }, { db, moduloOn: true, capturarSnapshot: false });

  assert.deepEqual(previa.previa.vendas.map((venda) => venda.valor), [3, 2]);
  assert.deepEqual(previa.previa.vendas.map((venda) =>
    venda.itens.reduce((total, item) => total + item.quantidade, 0)
  ), [3, 2]);
  assert.equal(previa.previa.itensUtilizados[0].quantidade_utilizada, 5);
});

test('elegibilidade subtrai consumo fiscal já persistido por produto', async (t) => {
  const db = await prepararDb();
  t.after(() => db.close());
  await inserirProduto(db, { id: 1, saldoFiscal: 5, preco: 1 });
  await executar(db, `CREATE TABLE fechamentos_fiscais (
    id INTEGER PRIMARY KEY, data_fechamento TEXT, status TEXT
  )`);
  await executar(db, `CREATE TABLE fechamentos_fiscais_previa_itens (
    id INTEGER PRIMARY KEY, fechamento_fiscal_id INTEGER, produto_id INTEGER,
    venda_item_origem_id INTEGER, quantidade REAL
  )`);
  await executar(db, `INSERT INTO fechamentos_fiscais (id,data_fechamento,status)
    VALUES (1,?, 'PREVIA')`, [DATA]);
  await executar(db, `INSERT INTO fechamentos_fiscais_previa_itens
    (id,fechamento_fiscal_id,produto_id,venda_item_origem_id,quantidade)
    VALUES (1,1,1,-1,3)`);

  const lotes = await listarLotesElegiveisDoDia(db, DATA);
  assert.equal(lotes.length, 1);
  assert.equal(lotes[0].quantidade_disponivel, 2);
});