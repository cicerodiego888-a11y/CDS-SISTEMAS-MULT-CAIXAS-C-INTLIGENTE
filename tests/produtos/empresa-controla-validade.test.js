/**
 * Super Usuário — empresa_controla_validade
 * node --test tests/produtos/empresa-controla-validade.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '../..');
const cfg = require('../../backend/services/estoque/empresaControlaValidadeConfig');

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
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function closeDb(db) {
  return new Promise((resolve) => {
    try {
      db.close(() => resolve());
    } catch (_) {
      resolve();
    }
  });
}

function salvarAsync(db, valor) {
  return new Promise((resolve, reject) => {
    cfg.salvar(db, valor, (err, dados) => (err ? reject(err) : resolve(dados)));
  });
}

describe('empresa_controla_validade', () => {
  beforeEach(() => {
    cfg._resetCacheForTests();
  });

  it('padrão ATIVADO e DESATIVADO desmarca produtos na hora', async () => {
    const db = await openDb();
    try {
      await run(db, `CREATE TABLE configuracoes (
        chave TEXT PRIMARY KEY, valor TEXT, tipo TEXT, descricao TEXT, updated_at TEXT
      )`);
      await run(db, `CREATE TABLE produtos (
        id INTEGER PRIMARY KEY, nome TEXT, controlar_validade INTEGER, updated_at TEXT
      )`);
      await run(db, `INSERT INTO produtos (nome, controlar_validade) VALUES ('A', 1)`);
      await run(db, `INSERT INTO produtos (nome, controlar_validade) VALUES ('B', 1)`);
      await run(db, `INSERT INTO produtos (nome, controlar_validade) VALUES ('C', 0)`);

      const ativado = await salvarAsync(db, 'ATIVADO');
      assert.equal(ativado.valor, 'ATIVADO');
      assert.equal(ativado.permitido, true);
      assert.equal(ativado.produtos_desmarcados, 0);
      let comFlag = await all(db, 'SELECT id FROM produtos WHERE controlar_validade = 1');
      assert.equal(comFlag.length, 2);

      const desligado = await salvarAsync(db, 'DESATIVADO');
      assert.equal(desligado.valor, 'DESATIVADO');
      assert.equal(desligado.permitido, false);
      assert.equal(desligado.produtos_desmarcados, 2);
      comFlag = await all(db, 'SELECT id FROM produtos WHERE controlar_validade = 1');
      assert.equal(comFlag.length, 0);

      const religar = await salvarAsync(db, 'ATIVADO');
      assert.equal(religar.permitido, true);
      comFlag = await all(db, 'SELECT id FROM produtos WHERE controlar_validade = 1');
      assert.equal(comFlag.length, 0, 'religar não remarca produtos');
    } finally {
      await closeDb(db);
    }
  });

  it('seed e UI de implantação existem', () => {
    const dbSrc = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
    assert.match(dbSrc, /empresa_controla_validade',\s*'ATIVADO'/);
    const centro = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/cds-centro-configuracoes.js'), 'utf8');
    assert.match(centro, /cfgEmpresaControlaValidade/);
    assert.match(centro, /btnSalvarEmpresaControlaValidade/);
    assert.match(centro, /btnNaoControlarValidadeEmpresa/);
    assert.match(centro, /data-cfg-pane="empresa"/);
    const rotas = fs.readFileSync(path.join(ROOT, 'backend/rotas/configuracoes.js'), 'utf8');
    assert.match(rotas, /\/empresa_controla_validade/);
    const produtosUi = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');
    assert.match(produtosUi, /aplicarPoliticaValidadeEmpresaNoCadastro/);
  });

  it('valor inválido retorna 400', async () => {
    const db = await openDb();
    try {
      await run(db, `CREATE TABLE configuracoes (
        chave TEXT PRIMARY KEY, valor TEXT, tipo TEXT, descricao TEXT, updated_at TEXT
      )`);
      await assert.rejects(
        () => salvarAsync(db, 'TALVEZ'),
        (err) => err && err.status === 400
      );
    } finally {
      await closeDb(db);
    }
  });
});
