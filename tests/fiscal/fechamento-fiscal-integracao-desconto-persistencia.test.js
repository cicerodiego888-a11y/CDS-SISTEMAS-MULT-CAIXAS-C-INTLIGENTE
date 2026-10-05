'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const {
  gerarPrevia,
  obterPorId
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalService');
const {
  garantirSchemaFechamentoFiscal
} = require('../../backend/services/fechamento-fiscal/schema/fechamentoFiscalSchema');

const DATA = '2026-10-01';

function abrirDb() {
  return new sqlite3.Database(':memory:');
}

function executar(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this.lastID);
    });
  });
}

function consultar(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function garantirSchema(db) {
  return new Promise((resolve, reject) => {
    garantirSchemaFechamentoFiscal(db, (err) => (err ? reject(err) : resolve()));
  });
}

test('comprovante explícito compõe acima do alvo e persiste bruto, desconto e final', async (t) => {
  const db = abrirDb();
  t.after(() => db.close());

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
    subtotal REAL, valor_fiscal REAL, valor_nao_fiscal REAL, preco_unitario REAL
  )`);
  await executar(db, `CREATE TABLE vendas_devolucoes (
    id INTEGER PRIMARY KEY, venda_id INTEGER, venda_item_id INTEGER,
    produto_id INTEGER, quantidade REAL, valor_total REAL
  )`);
  await executar(db, `CREATE TABLE movimentos_transferencia_saldos (
    id INTEGER PRIMARY KEY, produto_id INTEGER, quantidade REAL, origem TEXT, destino TEXT
  )`);
  await executar(db, `INSERT INTO produtos
    (id,nome,codigo,item_fiscal,saldo_fiscal,saldo_nao_fiscal,preco_venda,preco_compra)
    VALUES (1,'Produto fiscal sem venda','P1',1,2,100,14.90,5)`);

  await garantirSchema(db);
  const fechamentoId = await executar(db, `INSERT INTO fechamentos_fiscais
    (data_fechamento,cnpj,status) VALUES (?,'123','RASCUNHO')`, [DATA]);
  const estoqueAntes = await consultar(
    db,
    'SELECT preco_venda,preco_compra,saldo_fiscal,saldo_nao_fiscal FROM produtos WHERE id=1'
  );
  const transferenciasAntes = await consultar(db, 'SELECT * FROM movimentos_transferencia_saldos');

  const gerada = await gerarPrevia({
    id: fechamentoId,
    data: DATA,
    valor_informado: 28,
    comprovantes: [28],
    persistir: true
  }, { db, moduloOn: true, capturarSnapshot: false });

  const lida = await obterPorId(fechamentoId, { db });
  const vendaPersistida = lida.previa_vendas[0];
  const estoqueDepois = await consultar(
    db,
    'SELECT preco_venda,preco_compra,saldo_fiscal,saldo_nao_fiscal FROM produtos WHERE id=1'
  );
  const transferenciasDepois = await consultar(db, 'SELECT * FROM movimentos_transferencia_saldos');

  assert.equal(gerada.previa.valor_informado, 28);
  assert.equal(gerada.previa.quantidade_vendas, 1);
  assert.equal(gerada.previa.valor_distribuido, 29.8);
  assert.equal(gerada.previa.desconto, 1.8);
  assert.equal(gerada.previa.valor_final, 28);
  assert.deepEqual(gerada.previa.vendas[0].itens.map((item) => item.produto_id), [1]);
  assert.equal(lida.valor_informado, 28);
  assert.equal(lida.valor_distribuido, 29.8);
  assert.equal(lida.desconto, 1.8);
  assert.equal(lida.valor_final, 28);
  assert.equal(vendaPersistida.valor, 29.8);
  assert.equal(vendaPersistida.desconto, 1.8);
  assert.equal(vendaPersistida.valor_final, 28);
  assert.deepEqual(estoqueDepois, estoqueAntes);
  assert.deepEqual(transferenciasDepois, transferenciasAntes);
});

test('comprovantes iguais diversificam produtos equivalentes de forma determinística', async (t) => {
  const db = abrirDb();
  t.after(() => db.close());

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
    subtotal REAL, valor_fiscal REAL, valor_nao_fiscal REAL, preco_unitario REAL
  )`);
  await executar(db, `CREATE TABLE vendas_devolucoes (
    id INTEGER PRIMARY KEY, venda_id INTEGER, venda_item_id INTEGER,
    produto_id INTEGER, quantidade REAL, valor_total REAL
  )`);
  const saldosFiscais = [12, 10, 4, 3];
  for (let id = 1; id <= 4; id += 1) {
    await executar(db, `INSERT INTO produtos
      (id,nome,codigo,item_fiscal,saldo_fiscal,saldo_nao_fiscal,preco_venda,preco_compra)
      VALUES (?,?,?,1,?,0,5,2)`, [id, `Produto ${id}`, `P${id}`, saldosFiscais[id - 1]]);
  }

  const params = {
    data: DATA,
    valor_informado: 30,
    comprovantes: [10, 10, 10],
    persistir: false
  };
  const primeira = await gerarPrevia(params, { db, moduloOn: true, capturarSnapshot: false });
  const segunda = await gerarPrevia(params, { db, moduloOn: true, capturarSnapshot: false });
  const normalizar = (resultado) => ({
    vendas: resultado.previa.vendas.map((venda) => ({
      bruto: venda.valor,
      desconto: venda.desconto,
      final: venda.valor_final,
      itens: venda.itens.map((item) => ({
        produto_id: item.produto_id,
        quantidade: item.quantidade
      }))
    })),
    informado: resultado.previa.valor_informado,
    bruto: resultado.previa.valor_distribuido,
    desconto: resultado.previa.desconto,
    final: resultado.previa.valor_final,
    ordem: resultado.previa.vendas.map((venda) => venda.sequencia)
  });

  assert.equal(primeira.previa.metricas.produtos_elegiveis, 4);
  assert.deepEqual(primeira.previa.vendas.map((venda) => venda.valor_final), [10, 10, 10]);
  const produtosVendaUm = new Set(primeira.previa.vendas[0].itens.map((item) => item.produto_id));
  const produtosVendaDois = new Set(primeira.previa.vendas[1].itens.map((item) => item.produto_id));
  assert.deepEqual([...produtosVendaUm].sort(), [1, 2]);
  assert.deepEqual([...produtosVendaDois].sort(), [3, 4]);
  assert.ok([...produtosVendaDois].every((produtoId) => !produtosVendaUm.has(produtoId)));
  assert.deepEqual(normalizar(primeira), normalizar(segunda));
});