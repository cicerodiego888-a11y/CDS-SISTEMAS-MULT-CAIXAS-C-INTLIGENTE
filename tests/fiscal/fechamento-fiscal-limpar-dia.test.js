'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const fs = require('node:fs');
const path = require('node:path');
const {
  limparTudoDoDia
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalService');
const {
  garantirSchemaFechamentoFiscal
} = require('../../backend/services/fechamento-fiscal/schema/fechamentoFiscalSchema');

function executar(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function obter(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function garantirSchema(db) {
  return new Promise((resolve, reject) => {
    garantirSchemaFechamentoFiscal(db, (err) => (err ? reject(err) : resolve()));
  });
}

test('limpar tudo remove dados temporários do dia e preserva documentos autorizados e saldos', async () => {
  const db = new sqlite3.Database(':memory:');
  try {
    await garantirSchema(db);
    await executar(db, `INSERT INTO fechamentos_fiscais
      (id, data_fechamento, cnpj, status, valor_informado, valor_distribuido, diferenca, quantidade_maquinas)
      VALUES
      (1, '2026-10-02', '111', 'PREVIA', 100, 100, 0, 1),
      (2, '2026-10-02', '222', 'AUTORIZADO', 80, 80, 0, 1),
      (3, '2026-10-01', '333', 'PREVIA', 60, 60, 0, 1),
      (4, '2026-10-02', '444', 'ERRO', 40, 40, 0, 1)`);
    await executar(db, `INSERT INTO fechamentos_fiscais_previa_vendas
      (id, fechamento_fiscal_id, sequencia, valor) VALUES (10, 1, 1, 100)`);
    await executar(db, `INSERT INTO fechamentos_fiscais_previa_itens
      (id, previa_venda_id, fechamento_fiscal_id, produto_id, quantidade)
      VALUES (20, 10, 1, 7, 2)`);
    await executar(db, `INSERT INTO fechamentos_fiscais_itens
      (id, fechamento_fiscal_id, produto_id, quantidade_disponivel)
      VALUES (30, 1, 7, 2)`);
    await executar(db, `INSERT INTO fechamentos_fiscais_recebimentos
      (id, fechamento_fiscal_id, operadora, valor) VALUES (40, 1, 'POS', 100)`);
    await executar(db, `INSERT INTO fechamentos_fiscais_recebimentos_comprovantes
      (id, fechamento_fiscal_id, valor, ordem) VALUES (50, 1, 100, 1)`);
    await executar(db, `INSERT INTO fechamentos_fiscais_recebimentos_vendas
      (id, fechamento_fiscal_id, venda_id, valor_venda, valor_comprovante, diferenca)
      VALUES (60, 1, 5, 100, 100, 0)`);
    await executar(db, `INSERT INTO fechamentos_fiscais_complementacao
      (id, fechamento_fiscal_id, data_fechamento) VALUES (70, 1, '2026-10-02')`);
    await executar(db, `INSERT INTO fechamentos_fiscais_complementacao_itens
      (id, complementacao_id, fechamento_fiscal_id, produto_id)
      VALUES (80, 70, 1, 7)`);
    await executar(db, `INSERT INTO fechamentos_fiscais_documentos
      (id, fechamento_fiscal_id, status, valor_total) VALUES (90, 2, 'AUTORIZADO', 80)`);
    await executar(db, `INSERT INTO fechamentos_fiscais_documentos
      (id, fechamento_fiscal_id, status, valor_total) VALUES (91, 1, 'RASCUNHO', 100)`);
    await executar(db, `INSERT INTO fechamentos_fiscais_documentos_itens
      (id, documento_id, fechamento_fiscal_id, produto_id) VALUES (92, 91, 1, 7)`);
    await executar(db, `INSERT INTO fechamentos_fiscais_transmissoes
      (id, fechamento_fiscal_id, status, erro_tecnico) VALUES (93, 4, 'REJEITADO', 'erro teste')`);
    await executar(db, `CREATE TABLE produtos (id INTEGER PRIMARY KEY, saldo_fiscal REAL)`);
    await executar(db, `INSERT INTO produtos VALUES (7, 12)`);
    await executar(db, `CREATE TABLE vendas (id INTEGER PRIMARY KEY, total REAL)`);
    await executar(db, `INSERT INTO vendas VALUES (5, 100)`);

    const resultado = await limparTudoDoDia('2026-10-02', { db, moduloOn: true });
    const previaItens = await obter(db, 'SELECT COUNT(*) AS n FROM fechamentos_fiscais_previa_itens WHERE fechamento_fiscal_id = 1');
    const previaVendas = await obter(db, 'SELECT COUNT(*) AS n FROM fechamentos_fiscais_previa_vendas WHERE fechamento_fiscal_id = 1');
    const recebimentos = await obter(db, 'SELECT COUNT(*) AS n FROM fechamentos_fiscais_recebimentos WHERE fechamento_fiscal_id = 1');
    const complemento = await obter(db, 'SELECT COUNT(*) AS n FROM fechamentos_fiscais_complementacao WHERE fechamento_fiscal_id = 1');
    const draft = await obter(db, 'SELECT id FROM fechamentos_fiscais WHERE id = 1');
    const autorizado = await obter(db, `SELECT ff.status, d.status AS documento_status
      FROM fechamentos_fiscais ff JOIN fechamentos_fiscais_documentos d ON d.fechamento_fiscal_id = ff.id
      WHERE ff.id = 2`);
    const documentoRascunho = await obter(db, 'SELECT id FROM fechamentos_fiscais_documentos WHERE id = 91');
    const transmissaoAuditada = await obter(db, 'SELECT id FROM fechamentos_fiscais_transmissoes WHERE id = 93');
    const fechamentoComTransmissao = await obter(db, 'SELECT status FROM fechamentos_fiscais WHERE id = 4');
    const outroDia = await obter(db, 'SELECT status FROM fechamentos_fiscais WHERE id = 3');
    const produto = await obter(db, 'SELECT saldo_fiscal FROM produtos WHERE id = 7');
    const venda = await obter(db, 'SELECT total FROM vendas WHERE id = 5');

    assert.equal(resultado.fechamentos_limpos, 1);
    assert.equal(resultado.fechamentos_preservados, 2);
    assert.equal(previaItens.n, 0);
    assert.equal(previaVendas.n, 0);
    assert.equal(recebimentos.n, 0);
    assert.equal(complemento.n, 0);
    assert.equal(draft, null);
    assert.deepEqual(autorizado, { status: 'AUTORIZADO', documento_status: 'AUTORIZADO' });
    assert.equal(documentoRascunho, null);
    assert.ok(transmissaoAuditada);
    assert.equal(fechamentoComTransmissao.status, 'ERRO');
    assert.equal(outroDia.status, 'PREVIA');
    assert.equal(produto.saldo_fiscal, 12);
    assert.equal(venda.total, 100);
  } finally {
    await new Promise((resolve) => db.close(resolve));
  }
});

test('limpar tudo rejeita data inválida sem alterar registros', async () => {
  const db = new sqlite3.Database(':memory:');
  try {
    await garantirSchema(db);
    await assert.rejects(
      limparTudoDoDia('02-10-2026', { db, moduloOn: true }),
      { statusCode: 400 }
    );
  } finally {
    await new Promise((resolve) => db.close(resolve));
  }
});

test('tela confirma e chama a limpeza do dia selecionado', () => {
  const frontend = fs.readFileSync(
    path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'),
    'utf8'
  );
  assert.match(frontend, /id="ffdBtnLimparTudo">Limpar tudo do dia/);
  assert.match(frontend, /async function ffdLimparTudoDoDia\(\)/);
  assert.match(frontend, /\/fiscal\/fechamentos\/limpar-dia/);
  assert.match(frontend, /ffdConfirm\([\s\S]*?saldo fiscal dos produtos serão preservados/);
});
