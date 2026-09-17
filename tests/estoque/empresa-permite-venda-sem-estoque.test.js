/**
 * Super Usuário — empresa_permite_venda_sem_estoque
 * node --test tests/estoque/empresa-permite-venda-sem-estoque.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '../..');
const cfg = require('../../backend/services/estoque/empresaPermiteVendaSemEstoqueConfig');
const {
  obterFaixaQuantidadeFiscal,
  distribuirQuantidadeVenda
} = require('../../backend/services/distribuidorEstoqueVenda');

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

describe('empresa_permite_venda_sem_estoque', () => {
  beforeEach(() => {
    cfg._resetCacheForTests();
  });

  it('padrão DESATIVADO e ATIVADO não altera produtos', async () => {
    const db = await openDb();
    try {
      await run(db, `CREATE TABLE configuracoes (
        chave TEXT PRIMARY KEY, valor TEXT, tipo TEXT, descricao TEXT, updated_at TEXT
      )`);
      await run(db, `CREATE TABLE produtos (
        id INTEGER PRIMARY KEY, nome TEXT, controla_estoque INTEGER
      )`);
      await run(db, `INSERT INTO produtos (nome, controla_estoque) VALUES ('A', 1)`);

      const desligado = await salvarAsync(db, 'DESATIVADO');
      assert.equal(desligado.valor, 'DESATIVADO');
      assert.equal(desligado.permitido, false);

      const ligado = await salvarAsync(db, 'ATIVADO');
      assert.equal(ligado.valor, 'ATIVADO');
      assert.equal(ligado.permitido, true);
      assert.equal(cfg.estaAtivadaSync(), true);

      const row = await new Promise((resolve, reject) => {
        db.get('SELECT controla_estoque FROM produtos WHERE id = 1', (err, r) => (
          err ? reject(err) : resolve(r)
        ));
      });
      assert.equal(Number(row.controla_estoque), 1);
    } finally {
      await closeDb(db);
    }
  });

  it('motor distribui extra no saldo prioritário sem bloquear', () => {
    const faixaOff = obterFaixaQuantidadeFiscal(10, 2, 3);
    assert.equal(faixaOff.sucesso, false);

    const faixa = obterFaixaQuantidadeFiscal(10, 2, 3, { permitirVendaSemEstoque: true });
    assert.equal(faixa.sucesso, true);
    assert.equal(faixa.quantidadeFiscalMin, 2);
    assert.equal(faixa.quantidadeFiscalMax, 7);

    const fiscal = distribuirQuantidadeVenda(10, 2, 3, true, { permitirVendaSemEstoque: true });
    assert.equal(fiscal.sucesso, true);
    assert.equal(fiscal.quantidadeFiscal, 7);
    assert.equal(fiscal.quantidadeNaoFiscal, 3);

    const naoFiscal = distribuirQuantidadeVenda(10, 2, 3, false, { permitirVendaSemEstoque: true });
    assert.equal(naoFiscal.sucesso, true);
    assert.equal(naoFiscal.quantidadeFiscal, 2);
    assert.equal(naoFiscal.quantidadeNaoFiscal, 8);
  });

  it('seed e UI existem no Centro de Configurações', () => {
    const dbSrc = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
    assert.match(dbSrc, /empresa_permite_venda_sem_estoque',\s*'DESATIVADO'/);
    const centro = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/cds-centro-configuracoes.js'), 'utf8');
    assert.match(centro, /cfgEmpresaPermiteVendaSemEstoque/);
    assert.match(centro, /btnPermitirVendaSemEstoque/);
    assert.match(centro, /btnSalvarEmpresaPermiteVendaSemEstoque/);
    const rotas = fs.readFileSync(path.join(ROOT, 'backend/rotas/configuracoes.js'), 'utf8');
    assert.match(rotas, /\/empresa_permite_venda_sem_estoque/);
    const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
    assert.match(pdv, /pdvPermitirVendaSemEstoque/);
    assert.match(pdv, /carregarFlagVendaSemEstoquePdv/);
    assert.match(pdv, /modalVendaSemEstoquePdv/);
    assert.match(pdv, /btnVendaSemEstoqueSim/);
    assert.match(pdv, /Deseja continuar\?/);
    assert.match(pdv, /confirmarSemEstoque/);
    assert.match(pdv, /btnSim\.focus/);
    const motor = fs.readFileSync(path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');
    assert.match(motor, /permitirVendaSemEstoque: cfgVendaSemEstoque\.estaAtivadaSync\(\)/);
    assert.doesNotMatch(motor, /UPDATE produtos SET controla_estoque = 0/);
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
