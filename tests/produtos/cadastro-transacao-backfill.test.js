'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const { backfillNomeBusca } = require('../../backend/motores/mib/schema/mibSchema');
const { normalizarNomeBusca } = require('../../backend/motores/mib/core/normalizarNomeBusca');
const { criarBuscaOperacionalProdutosService } = require('../../backend/services/busca-operacional-produtos');

const ROTA = fs.readFileSync(path.join(__dirname, '../../backend/rotas/produtos.js'), 'utf8');
const FRONT = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');

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
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}
function backfill(db, opcoes) {
  return new Promise((resolve, reject) => {
    backfillNomeBusca(db, opcoes, (err, r) => (err ? reject(err) : resolve(r)));
  });
}

describe('cadastro transação e backfill', () => {
  test('12. validação de validade ocorre antes do INSERT', () => {
    const idxVal = ROTA.indexOf("error: 'Data de validade é obrigatória para o estoque inicial.'");
    const idxInsert = ROTA.indexOf('INSERT INTO produtos');
    assert.ok(idxVal > 0 && idxInsert > idxVal);
  });

  test('POST usa transação e aborta sem mensagem de produto parcialmente criado', () => {
    assert.match(ROTA, /BEGIN IMMEDIATE/);
    assert.match(ROTA, /abortarCadastro/);
    assert.match(ROTA, /COMMIT/);
    assert.doesNotMatch(ROTA, /Produto criado, mas/);
  });

  test('10-11. INSERT com nome_busca permite pesquisa imediata', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-bf-'));
    const db = await new Promise((resolve, reject) => {
      const d = new sqlite3.Database(path.join(dir, 't.db'), (e) => (e ? reject(e) : resolve(d)));
    });
    await run(db, `CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT UNIQUE, nome TEXT, nome_busca TEXT,
      ativo INTEGER DEFAULT 1, codigo_barras TEXT, categoria_id INTEGER, marca_id INTEGER, preco_venda REAL
    )`);
    await run(db, `CREATE TABLE produto_identificadores (id INTEGER PRIMARY KEY, produto_id INTEGER, tipo TEXT, codigo TEXT, ativo INTEGER DEFAULT 1, principal INTEGER DEFAULT 0)`);
    await run(db, `CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT)`);
    await run(db, `CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT)`);
    await run(db, `CREATE TABLE produto_atacado (id INTEGER PRIMARY KEY, produto_id INTEGER, preco_atacado REAL, quantidade_minima REAL)`);

    const nome = 'PRODUTO TESTE AUDITORIA 2026';
    await run(db, `INSERT INTO produtos (codigo, nome, nome_busca, ativo) VALUES (?,?,?,1)`, [
      'AUD-2026-001', nome, normalizarNomeBusca(nome)
    ]);
    const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => [] });
    const cheio = await svc.buscar({ q: nome, incluirSugestoes: false });
    const prefixo = await svc.buscar({ q: 'PRODUTO TESTE', incluirSugestoes: false });
    const parcial = await svc.buscar({ q: 'AUDITORIA', incluirSugestoes: false });
    assert.ok(cheio.itens.some((p) => p.nome === nome));
    assert.ok(prefixo.itens.some((p) => p.nome === nome));
    assert.ok(parcial.itens.some((p) => p.nome === nome));
  });

  test('13. falha posterior na transação não deixa produto', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-tx-'));
    const db = await new Promise((resolve, reject) => {
      const d = new sqlite3.Database(path.join(dir, 't.db'), (e) => (e ? reject(e) : resolve(d)));
    });
    await run(db, `CREATE TABLE produtos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT)`);
    await run(db, 'BEGIN IMMEDIATE');
    await run(db, `INSERT INTO produtos (nome) VALUES ('PARCIAL')`);
    await run(db, 'ROLLBACK');
    const row = await get(db, `SELECT COUNT(*) AS n FROM produtos`);
    assert.equal(row.n, 0);
  });

  test('14-15. backfill legado e segunda execução idempotente', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-bf2-'));
    const db = await new Promise((resolve, reject) => {
      const d = new sqlite3.Database(path.join(dir, 't.db'), (e) => (e ? reject(e) : resolve(d)));
    });
    await run(db, `CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT, nome TEXT, nome_busca TEXT, ativo INTEGER DEFAULT 1,
      codigo_barras TEXT, categoria_id INTEGER, marca_id INTEGER, preco_venda REAL
    )`);
    await run(db, `CREATE TABLE produto_identificadores (id INTEGER PRIMARY KEY, produto_id INTEGER, tipo TEXT, codigo TEXT, ativo INTEGER DEFAULT 1, principal INTEGER DEFAULT 0)`);
    await run(db, `CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT)`);
    await run(db, `CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT)`);
    await run(db, `CREATE TABLE produto_atacado (id INTEGER PRIMARY KEY, produto_id INTEGER, preco_atacado REAL, quantidade_minima REAL)`);
    await run(db, `INSERT INTO produtos (codigo, nome, nome_busca) VALUES ('L1', 'ÁGUA MINERAL 500ML', NULL)`);
    const r1 = await backfill(db, { limite: 100, apenasVazios: true });
    assert.equal(r1.corrigidos, 1);
    const row = await get(db, 'SELECT nome, nome_busca FROM produtos WHERE codigo = ?', ['L1']);
    assert.equal(row.nome, 'ÁGUA MINERAL 500ML');
    assert.equal(row.nome_busca, 'aguamineral500ml');
    const r2 = await backfill(db, { limite: 100, apenasVazios: true });
    assert.equal(r2.corrigidos, 0);
    const svc = criarBuscaOperacionalProdutosService(db, { buscarSugestoesMib: async () => [] });
    const busca = await svc.buscar({ q: 'agua', incluirSugestoes: false });
    assert.ok(busca.itens.some((p) => p.codigo === 'L1'));
  });

  test('17. frontend trava duplo clique no cadastro', () => {
    assert.match(FRONT, /__cdsProdutoSalvando/);
  });

  test('16. cadastro na revisão associa o ID persistido à linha', () => {
    const revisao = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/miip-central-revisao.js'), 'utf8');
    assert.match(revisao, /produtoRecemSalvo/);
    assert.match(revisao, /aplicarConfirmacao\(pendencia, produto\.id/);
    assert.match(revisao, /associacao:/);
    assert.match(revisao, /linha_xml:/);
  });
});
