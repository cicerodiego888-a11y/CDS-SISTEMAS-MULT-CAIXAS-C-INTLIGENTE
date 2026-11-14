'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { obterProdutoEmbalagemService } = require('../../backend/services/produto-embalagem/ProdutoEmbalagemService');
const MUC = require('../../backend/motores/muc');

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

function sync(service, produtoId, apresentacoes) {
  return new Promise((resolve, reject) => {
    service.sincronizarEmbalagensProduto(
      produtoId,
      apresentacoes,
      'und',
      { id: 1, nome: 'teste' },
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

function converterCompra(apresentacao, quantidade, valor) {
  return MUC.MotorConversao.converter({
    produtoId: 1,
    produto: { id: 1, unidade: 'und' },
    quantidadeCompra: quantidade,
    unidadeCompra: apresentacao.tipo,
    unidadeEstoque: 'und',
    valorTotalCompra: valor,
    apresentacao,
    origem: 'MANUAL'
  });
}

async function aplicarSaldo(db, produtoId, quantidade, fiscal) {
  const coluna = fiscal ? 'saldo_fiscal' : 'saldo_nao_fiscal';
  const outro = fiscal ? 'saldo_nao_fiscal' : 'saldo_fiscal';
  await run(
    db,
    `UPDATE produtos SET
       ${coluna} = COALESCE(${coluna}, 0) + ?,
       estoque_atual = COALESCE(${coluna}, 0) + ? + COALESCE(${outro}, 0)
     WHERE id = ?`,
    [quantidade, quantidade, produtoId]
  );
}

async function main() {
  const db = new sqlite3.Database(':memory:');
  try {
    await run(db, `CREATE TABLE produtos (
      id INTEGER PRIMARY KEY,
      unidade TEXT,
      compra_por_embalagem INTEGER DEFAULT 0,
      unidade_comercial TEXT,
      quantidade_por_embalagem REAL,
      valor_compra_embalagem REAL,
      saldo_fiscal REAL DEFAULT 0,
      saldo_nao_fiscal REAL DEFAULT 0,
      estoque_atual REAL DEFAULT 0,
      preco_venda REAL DEFAULT 0,
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
      usuario_alteracao INTEGER,
      observacao TEXT,
      motivo_alteracao TEXT,
      created_at TEXT,
      updated_at TEXT
    )`);
    await run(db, `CREATE TABLE produto_embalagem_historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      embalagem_id INTEGER,
      campo TEXT,
      valor_anterior TEXT,
      valor_novo TEXT,
      usuario_id INTEGER,
      usuario_nome TEXT,
      created_at TEXT
    )`);
    await run(db, `CREATE TABLE operacoes_apresentacao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER,
      apresentacao_id INTEGER,
      unidade_comercial TEXT,
      quantidade_apresentacao REAL,
      fator_conversao REAL,
      unidade_base TEXT,
      quantidade_base REAL,
      valor_total REAL,
      natureza TEXT
    )`);
    await run(
      db,
      `INSERT INTO produtos (id, unidade, compra_por_embalagem, preco_venda)
       VALUES (1, 'UND', 1, 1.20)`
    );

    const service = obterProdutoEmbalagemService(db);
    const arruela = [
      { tipo: 'KG', quantidade: 180, unidade: 'und', compra: 1, venda: 0, principal: 0, ativa: 1 },
      { tipo: 'UND', quantidade: 1, unidade: 'und', compra: 0, venda: 1, principal: 1, ativa: 1 },
      { tipo: 'CX', quantidade: 500, unidade: 'und', compra: 1, venda: 1, principal: 0, ativa: 1 },
      { tipo: 'PCT', quantidade: 50, unidade: 'und', compra: 0, venda: 1, principal: 0, ativa: 1 },
      { tipo: 'BANDEJA', quantidade: 8, unidade: 'und', compra: 1, venda: 1, principal: 0, ativa: 1 }
    ];

    await assert.rejects(() => sync(service, 1, [
      { tipo: 'KG', quantidade: 0, compra: 1, venda: 0 }
    ]), /positiva|quantidade de conversão/);
    await assert.rejects(() => sync(service, 1, [
      { tipo: 'KG', quantidade: -3, compra: 1, venda: 0 }
    ]), /positiva|quantidade de conversão/);
    await assert.rejects(() => sync(service, 1, [
      { tipo: 'KG', quantidade: 180, compra: 1, venda: 0 },
      { tipo: 'kg', quantidade: 90, compra: 1, venda: 0 }
    ]), /já existe neste produto/);

    const salvas = await sync(service, 1, arruela);
    assert.strictEqual(salvas.length, 5);
    const porTipo = Object.fromEntries(salvas.map((item) => [item.tipo, item]));
    assert.strictEqual(porTipo.KG.quantidade, 180);
    assert.strictEqual(porTipo.KG.compra, 1);
    assert.strictEqual(porTipo.KG.venda, 0);
    assert.strictEqual(porTipo.UN.quantidade, 1);
    assert.strictEqual(porTipo.UN.venda, 1);
    assert.strictEqual(porTipo.UN.compra, 0);
    assert.strictEqual(porTipo.CX.quantidade, 500);
    assert.strictEqual(porTipo.PCT.quantidade, 50);
    assert.strictEqual(porTipo.BANDEJA.quantidade, 8);

    const produto = (await all(db, 'SELECT unidade, preco_venda FROM produtos WHERE id = 1'))[0];
    assert.strictEqual(produto.unidade, 'UND');
    assert.strictEqual(produto.preco_venda, 1.2);

    const kg = converterCompra(porTipo.KG, 2, 180);
    assert.strictEqual(kg.fatorConversao, 180);
    assert.strictEqual(kg.quantidadeEstoque, 360);
    const custoKg = MUC.MotorConversao.simularConversao({ quantidadeCompra: 1, quantidadePorApresentacao: 180, valorTotal: 90 });
    assert.strictEqual(custoKg.custoUnitario, 0.5);
    const cx = converterCompra(porTipo.CX, 3, 0);
    assert.strictEqual(cx.quantidadeEstoque, 1500);
    const und = MUC.MotorConversao.simularConversao({ quantidadeCompra: 10, quantidadePorApresentacao: 1, valorTotal: 0 });
    assert.strictEqual(und.quantidadeEstoque, 10);
    const pct = MUC.MotorConversao.simularConversao({ quantidadeCompra: 2, quantidadePorApresentacao: 50, valorTotal: 0 });
    assert.strictEqual(pct.quantidadeEstoque, 100);
    const bandeja = converterCompra(porTipo.BANDEJA, 2, 0);
    assert.strictEqual(bandeja.quantidadeEstoque, 16);
    assert.strictEqual(bandeja.unidadeCompra, 'BANDEJA');

    await run(
      db,
      `INSERT INTO operacoes_apresentacao (
         produto_id, apresentacao_id, unidade_comercial, quantidade_apresentacao,
         fator_conversao, unidade_base, quantidade_base, valor_total, natureza
       ) VALUES (1, ?, 'KG', 2, ?, 'UND', ?, 180, 'FISCAL')`,
      [porTipo.KG.id, kg.fatorConversao, kg.quantidadeEstoque]
    );
    await aplicarSaldo(db, 1, 360, true);
    await aplicarSaldo(db, 1, -10, true);
    await aplicarSaldo(db, 1, 1500, false);
    await aplicarSaldo(db, 1, -100, false);
    await aplicarSaldo(db, 1, -50, true);
    await aplicarSaldo(db, 1, -50, false);

    const saldo = (await all(
      db,
      'SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual, preco_venda FROM produtos WHERE id = 1'
    ))[0];
    assert.strictEqual(saldo.saldo_fiscal, 300);
    assert.strictEqual(saldo.saldo_nao_fiscal, 1350);
    assert.strictEqual(saldo.estoque_atual, 1650);
    assert.strictEqual(saldo.preco_venda, 1.2);

    await sync(service, 1, arruela.map((item) => (
      item.tipo === 'KG' ? { ...item, id: porTipo.KG.id, quantidade: 200 } : { ...item, id: porTipo[item.tipo === 'UND' ? 'UN' : item.tipo].id }
    )));
    const operacao = (await all(db, 'SELECT fator_conversao, quantidade_base FROM operacoes_apresentacao'))[0];
    assert.strictEqual(operacao.fator_conversao, 180);
    assert.strictEqual(operacao.quantidade_base, 360);
    const kgAtual = (await all(db, `SELECT quantidade FROM produto_embalagens WHERE tipo = 'KG'`))[0];
    assert.strictEqual(kgAtual.quantidade, 200);

    const semBandeja = arruela.filter((item) => item.tipo !== 'BANDEJA');
    await sync(service, 1, semBandeja.map((item) => ({
      ...item,
      id: porTipo[item.tipo === 'UND' ? 'UN' : item.tipo].id
    })));
    const bandejaRow = (await all(db, `SELECT id, ativa, quantidade FROM produto_embalagens WHERE tipo = 'BANDEJA'`))[0];
    assert.strictEqual(bandejaRow.id, porTipo.BANDEJA.id);
    assert.strictEqual(bandejaRow.ativa, 0);
    assert.strictEqual(bandejaRow.quantidade, 8);

    const pdv = fs.readFileSync(path.join(__dirname, '../../frontend/pdv/js/pdv.js'), 'utf8');
    assert.match(pdv, /quantidade_estoque = quantidade \* Number\(item\.fator_conversao\)/);
    assert.match(pdv, /Number\(ap\.venda \?\? 1\) !== 1/);

    console.log('OK  arruela: 2 KG = 360 UND, venda de 10 UND, PCT e saldos fiscal/não fiscal separados');
  } finally {
    await new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
  }
}

main().catch((err) => {
  console.error('FAIL  apresentação compra/venda da arruela');
  console.error(err);
  process.exitCode = 1;
});
