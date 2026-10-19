'use strict';

const assert = require('assert');
const sqlite3 = require('sqlite3');
const { obterProdutoEmbalagemService } = require('../../backend/services/produto-embalagem/ProdutoEmbalagemService');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function sync(service, produtoId, presentations) {
  return new Promise((resolve, reject) => {
    service.sincronizarEmbalagensProduto(
      produtoId,
      presentations,
      'm',
      { id: 1 },
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

async function main() {
  const db = new sqlite3.Database(':memory:');
  try {
    await run(db, `CREATE TABLE produtos (
      id INTEGER PRIMARY KEY,
      compra_por_embalagem INTEGER DEFAULT 1,
      unidade_comercial TEXT,
      quantidade_por_embalagem REAL,
      valor_compra_embalagem REAL,
      updated_at TEXT
    )`);
    await run(db, `CREATE TABLE produto_embalagens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      descricao TEXT,
      quantidade REAL NOT NULL,
      unidade TEXT,
      gtin TEXT,
      codigo_fornecedor TEXT,
      codigo_interno_fornecedor TEXT,
      fornecedor_cnpj TEXT,
      fornecedor_nome TEXT,
      fornecedor_descricao TEXT,
      valor_compra REAL,
      preco_venda REAL,
      tipo_conversao TEXT,
      principal INTEGER,
      compra INTEGER,
      venda INTEGER,
      estoque INTEGER,
      ativa INTEGER,
      vigencia_inicio TEXT,
      vigencia_fim TEXT,
      origem TEXT,
      usuario_criacao INTEGER,
      observacao TEXT,
      motivo_alteracao TEXT,
      created_at TEXT,
      updated_at TEXT
    )`);
    await run(db, 'CREATE TABLE produto_embalagem_historico (id INTEGER PRIMARY KEY, embalagem_id INTEGER, campo TEXT, valor_anterior TEXT, valor_novo TEXT, usuario_id INTEGER, usuario_nome TEXT)');
    await run(db, "INSERT INTO produtos (id, compra_por_embalagem) VALUES (41, 1)");

    const service = obterProdutoEmbalagemService(db);
    const saved = await sync(service, 41, [{
      tipo: 'VARA',
      descricao: 'Vara comercial',
      quantidade: 2.75,
      unidade: 'm',
      principal: 1,
      compra: 1,
      venda: 1,
      estoque: 1,
      ativa: 1
    }]);

    assert.strictEqual(saved[0].tipo, 'VARA');
    assert.strictEqual(saved[0].quantidade, 2.75);
    assert.strictEqual(saved[0].unidade, 'm');

    const reopened = await all(db, 'SELECT * FROM produto_embalagens WHERE produto_id = ?', [41]);
    assert.strictEqual(reopened.length, 1);
    assert.strictEqual(reopened[0].tipo, 'VARA');
    assert.strictEqual(reopened[0].quantidade, 2.75);

    await sync(service, 41, [{
      id: reopened[0].id,
      tipo: reopened[0].tipo,
      descricao: reopened[0].descricao,
      quantidade: 3.5,
      unidade: reopened[0].unidade,
      principal: 1,
      compra: 1,
      venda: 1,
      estoque: 1,
      ativa: 1
    }]);
    const edited = await all(db, 'SELECT tipo, quantidade FROM produto_embalagens WHERE produto_id = ?', [41]);
    assert.deepStrictEqual(edited, [{ tipo: 'VARA', quantidade: 3.5 }]);

    console.log('OK  VARA salva, reaberta e editada em SQLite temporário com o fator preservado');
  } finally {
    await new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
  }
}

main().catch((err) => {
  console.error('FAIL  Persistência SQLite temporária da apresentação VARA');
  console.error(err);
  process.exitCode = 1;
});
