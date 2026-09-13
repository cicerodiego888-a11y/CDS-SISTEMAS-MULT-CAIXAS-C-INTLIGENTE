/**
 * Super Usuário — pdv_permitir_transferencia_nao_fiscal_fiscal
 * npm run test:pdv-transferencia-estoque
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '../..');
const cfg = require('../../backend/services/estoque/pdvTransferenciaNaoFiscalFiscalConfig');
const {
  avaliarFluxoInclusaoPdv,
  prepararEntradasMotorComTransferenciaPdv
} = require('../../backend/services/estoque/transferenciaNaoFiscalParaFiscalPdv');

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

async function setupCfgDb() {
  const db = await openDb();
  await run(db, `
    CREATE TABLE configuracoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chave VARCHAR(100) UNIQUE NOT NULL,
      valor TEXT,
      tipo VARCHAR(50),
      descricao TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return db;
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

describe('Configuração pdv_permitir_transferencia_nao_fiscal_fiscal', () => {
  beforeEach(() => {
    cfg._resetCacheForTests();
  });

  it('nova instalação / valor ausente = DESATIVADO', async () => {
    const db = await setupCfgDb();
    try {
      const dados = await new Promise((resolve, reject) => {
        cfg.ler(db, (err, row) => (err ? reject(err) : resolve(row)));
      });
      assert.equal(dados.valor, 'DESATIVADO');
      assert.equal(dados.permitido, false);
      assert.equal(cfg.estaAtivadaSync(), false);
    } finally {
      await closeDb(db);
    }
  });

  it('Super Usuário ativa e desativa', async () => {
    const db = await setupCfgDb();
    try {
      const on = await new Promise((resolve, reject) => {
        cfg.salvar(db, 'ATIVADO', (err, row) => (err ? reject(err) : resolve(row)));
      });
      assert.equal(on.valor, 'ATIVADO');
      assert.equal(on.permitido, true);
      assert.equal(cfg.estaAtivadaSync(), true);

      const off = await new Promise((resolve, reject) => {
        cfg.salvar(db, 'DESATIVADO', (err, row) => (err ? reject(err) : resolve(row)));
      });
      assert.equal(off.valor, 'DESATIVADO');
      assert.equal(cfg.estaAtivadaSync(), false);
    } finally {
      await closeDb(db);
    }
  });

  it('API rejeita alteração sem SUPER_ADMIN (ADMIN e usuário comum)', () => {
    const nextCalls = [];
    const next = () => nextCalls.push(true);

    const resAdmin = mockRes();
    cfg.exigirSuperAdminAlteracao({ user: { perfil: 'ADMIN' } }, resAdmin, next);
    assert.equal(resAdmin.statusCode, 403);
    assert.match(String(resAdmin.body.error || resAdmin.body.erro), /SUPER USUÁRIO/);

    const resUser = mockRes();
    cfg.exigirSuperAdminAlteracao({ user: { perfil: 'USUARIO', role: 'admin' } }, resUser, next);
    assert.equal(resUser.statusCode, 403);

    const resSuper = mockRes();
    cfg.exigirSuperAdminAlteracao({ user: { perfil: 'SUPER_ADMIN' } }, resSuper, next);
    assert.equal(resSuper.statusCode, 200);
    assert.equal(nextCalls.length, 1);
  });

  it('OFF: não pergunta e ignora intenção no prepare', () => {
    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 5,
      saldoFiscal: 0,
      saldoNaoFiscal: 20,
      modoFiscal: true,
      permitido: false
    });
    assert.equal(fluxo.acao, 'INCLUIR');
    assert.equal(fluxo.devePerguntar, false);
    assert.equal(fluxo.quantidadeTransferir, 0);

    const prep = prepararEntradasMotorComTransferenciaPdv([{
      item: {
        produto_id: 1,
        quantidade: 5,
        transferencia_nao_fiscal_para_fiscal: 5
      },
      saldoFiscal: 0,
      saldoNaoFiscal: 20
    }], { permitido: false });
    assert.equal(prep.sucesso, true);
    assert.equal(prep.aplicacoes.length, 0);
    assert.equal(prep.entradas[0].saldoFiscal, 0);
    assert.equal(prep.entradas[0].saldoNaoFiscal, 20);
  });

  it('ON: fluxo atual pergunta e transfere no prepare', () => {
    const fluxo = avaliarFluxoInclusaoPdv({
      quantidade: 5,
      saldoFiscal: 0,
      saldoNaoFiscal: 20,
      modoFiscal: true,
      permitido: true
    });
    assert.equal(fluxo.acao, 'PERGUNTAR');
    assert.equal(fluxo.quantidadeTransferir, 5);

    const prep = prepararEntradasMotorComTransferenciaPdv([{
      item: {
        produto_id: 1,
        quantidade: 5,
        transferencia_nao_fiscal_para_fiscal: 5
      },
      saldoFiscal: 0,
      saldoNaoFiscal: 20
    }], { permitido: true });
    assert.equal(prep.sucesso, true);
    assert.equal(prep.aplicacoes.length, 1);
    assert.equal(prep.aplicacoes[0].quantidade, 5);
    assert.equal(prep.entradas[0].saldoFiscal, 5);
  });

  it('seed no database.js é DESATIVADO; PUT genérico exige Super Usuário', () => {
    const databaseJs = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
    assert.match(
      databaseJs,
      /pdv_permitir_transferencia_nao_fiscal_fiscal',\s*'DESATIVADO'/
    );

    const rotas = fs.readFileSync(path.join(ROOT, 'backend/rotas/configuracoes.js'), 'utf8');
    assert.match(rotas, /exigirSuperAdminAlteracao/);
    assert.match(rotas, /ehChave\(chave\)/);

    const pag = fs.readFileSync(path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');
    assert.match(pag, /estaAtivadaSync\(\)/);
    assert.doesNotMatch(pag, /distribuirQuantidadeVenda/);

    const motor = fs.readFileSync(path.join(ROOT, 'backend/services/distribuidorEstoqueVenda.js'), 'utf8');
    assert.doesNotMatch(motor, /pdv_permitir_transferencia_nao_fiscal_fiscal/);

    const mts = fs.readFileSync(path.join(ROOT, 'backend/motores/mts/MtsService.js'), 'utf8');
    assert.doesNotMatch(mts, /pdv_permitir_transferencia_nao_fiscal_fiscal/);
  });

  it('OFF no PDV: análise não pergunta Transferir estoque?', () => {
    const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
    const fn = pdv.slice(
      pdv.indexOf('function pdvAnalisarTransferenciaEstoque'),
      pdv.indexOf('function abrirModalTransferirEstoquePdv')
    );
    assert.match(fn, /pdvPermitirTransferenciaNaoFiscalFiscal\(\)/);
    assert.match(pdv, /function carregarFlagTransferenciaNaoFiscalFiscalPdv/);

    const centro = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/cds-centro-configuracoes.js'), 'utf8');
    assert.match(centro, /id="cfgPdvTransferenciaNfFiscal"/);
    assert.match(centro, /id="btnSalvarPdvTransferenciaNfFiscal"/);
    assert.match(centro, /loadConfiguracoesAvancadas/);
  });
});
