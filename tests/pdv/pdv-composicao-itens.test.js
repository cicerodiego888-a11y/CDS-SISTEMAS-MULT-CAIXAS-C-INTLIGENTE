/**
 * Sprint — Configurações do PDV V1 + Composição de Itens
 * node --test tests/pdv/pdv-composicao-itens.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '../..');
const cfg = require('../../backend/services/estoque/pdvComposicaoItensConfig');
const Composition = require('../../backend/services/pdv/PDVItemCompositionService');

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

function lerAsync(db) {
  return new Promise((resolve, reject) => {
    cfg.ler(db, (err, dados) => (err ? reject(err) : resolve(dados)));
  });
}

function linhaBase(overrides = {}) {
  return Object.assign({
    linha_id: Composition.gerarLinhaId(),
    id: 20,
    produto_id: 20,
    tipo_venda: 'PESO',
    preco_unitario: 15,
    tipo_preco: 'varejo',
    desconto_percentual: 0,
    desconto_valor: 0,
    desconto_manual: 0,
    promocao_id: null,
    desconto_atacado: 0,
    preco_manual: 0,
    quantidade: 1,
    subtotal: 15
  }, overrides);
}

describe('PDV composição de itens — configuração', () => {
  beforeEach(() => {
    cfg._resetCacheForTests();
    Composition._resetSeqForTests();
  });

  it('1. configuração padrão = UNIFICAR', async () => {
    const db = await openDb();
    try {
      await run(db, `CREATE TABLE configuracoes (
        chave TEXT PRIMARY KEY, valor TEXT, tipo TEXT, descricao TEXT, updated_at TEXT
      )`);
      const dados = await lerAsync(db);
      assert.equal(dados.valor, 'UNIFICAR');
      assert.equal(dados.modo, 'UNIFICAR');
      assert.equal(cfg.modoAtualSync(), 'UNIFICAR');
    } finally {
      await closeDb(db);
    }
  });

  it('chave, seed, rotas e Centro de Configurações', () => {
    const cfgSrc = fs.readFileSync(
      path.join(ROOT, 'backend/services/estoque/pdvComposicaoItensConfig.js'),
      'utf8'
    );
    assert.match(cfgSrc, /pdv_composicao_itens/);
    assert.match(cfgSrc, /UNIFICAR/);
    assert.match(cfgSrc, /SEPARAR/);
    assert.match(cfgSrc, /AUTOMATICO/);

    const dbSrc = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
    assert.match(dbSrc, /pdv_composicao_itens',\s*'UNIFICAR'/);

    const rotas = fs.readFileSync(path.join(ROOT, 'backend/rotas/configuracoes.js'), 'utf8');
    assert.match(rotas, /\/pdv_composicao_itens/);
    assert.match(rotas, /cfgComposicaoItensPdv/);

    const centro = fs.readFileSync(
      path.join(ROOT, 'frontend/erp/js/cds-centro-configuracoes.js'),
      'utf8'
    );
    assert.match(centro, /configuracoesPdv/);
    assert.match(centro, /Configurações do PDV/);
    assert.match(centro, /cfgPdvComposicaoUnificar/);
    assert.match(centro, /cfgPdvComposicaoSeparar/);
    assert.match(centro, /cfgPdvComposicaoAutomatico/);
    assert.match(centro, /btnSalvarPdvComposicaoItens/);
    assert.match(centro, /Composição da Venda/);
    assert.match(centro, /Preços e Descontos/);
    assert.match(centro, /Cadastro durante a Venda/);
    assert.match(centro, /Comportamento Fiscal/);
    assert.match(centro, /cfgPdvEditarPrecoUnitario/);
    assert.match(centro, /cfgEmpresaPermiteVendaSemEstoque/);
    assert.match(centro, /cfgPdvTransferenciaNfFiscal/);
    assert.match(centro, /cfgPdvExigirNcmCadastro/);
    assert.match(centro, /cfgPdvImprimirCupom/);

    const motoresPane = centro.slice(
      centro.indexOf('data-cfg-pane="motores"'),
      centro.indexOf('data-cfg-pane="configuracoesPdv"')
    );
    assert.doesNotMatch(motoresPane, /cfgPdvEditarPrecoUnitario/);
    assert.doesNotMatch(motoresPane, /cfgPdvImprimirCupom/);

    const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
    assert.match(pdv, /carregarFlagComposicaoItensPdv/);
    assert.match(pdv, /pdvObterModoComposicaoItens/);
    assert.match(pdv, /PDVItemCompositionService/);
    assert.match(pdv, /linha_id/);
    assert.doesNotMatch(pdv, /cfgPdvComposicaoUnificar/);

    const html = fs.readFileSync(path.join(ROOT, 'frontend/pdv/index.html'), 'utf8');
    assert.match(html, /PDVItemCompositionService\.js/);

    const svc = fs.readFileSync(
      path.join(ROOT, 'backend/services/pdv/PDVItemCompositionService.js'),
      'utf8'
    );
    assert.match(svc, /decidirComposicao/);
    assert.match(svc, /linhasCompativeisAutomatico/);

    const conf = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/configuracoes.js'), 'utf8');
    assert.match(conf, /pdv_composicao_itens/);
  });
});

describe('PDV composição de itens — motor', () => {
  beforeEach(() => {
    Composition._resetSeqForTests();
  });

  it('2. mesmo produto + UNIFICAR → uma linha', () => {
    const carrinho = [linhaBase({ quantidade: 1, subtotal: 10 })];
    const d = Composition.decidirComposicao(
      carrinho,
      linhaBase({ quantidade: 1 }),
      Composition.MODOS.UNIFICAR
    );
    assert.equal(d.acao, Composition.ACAO.UNIFICAR);
    assert.equal(d.index, 0);
  });

  it('3. mesmo produto + SEPARAR → duas linhas', () => {
    const carrinho = [linhaBase({ quantidade: 1, subtotal: 10 })];
    const d = Composition.decidirComposicao(
      carrinho,
      linhaBase({ quantidade: 1 }),
      Composition.MODOS.SEPARAR
    );
    assert.equal(d.acao, Composition.ACAO.CRIAR);
    assert.ok(d.linha_id);
    assert.notEqual(d.linha_id, carrinho[0].linha_id);
  });

  it('4. produto pesado + SEPARAR → pesos preservados (identidade por linha)', () => {
    const l1 = linhaBase({
      quantidade: 2,
      preco_unitario: 15,
      subtotal: 30,
      tipo_venda: 'PESO'
    });
    const d = Composition.decidirComposicao(
      [l1],
      linhaBase({ quantidade: 1, preco_unitario: 15, subtotal: 15, tipo_venda: 'PESO' }),
      Composition.MODOS.SEPARAR
    );
    assert.equal(d.acao, Composition.ACAO.CRIAR);
    assert.equal(l1.quantidade, 2);
    assert.equal(l1.subtotal, 30);
    const soma = Composition.somarQuantidadeProduto([l1, { ...l1, quantidade: 1 }], 20, 'PESO');
    assert.equal(soma, 3);
  });

  it('5. mesmo produto com preços diferentes → não unificar no AUTOMATICO', () => {
    const carrinho = [linhaBase({ preco_unitario: 10 })];
    const d = Composition.decidirComposicao(
      carrinho,
      linhaBase({ preco_unitario: 12 }),
      Composition.MODOS.AUTOMATICO
    );
    assert.equal(d.acao, Composition.ACAO.CRIAR);
  });

  it('6. mesmo produto com desconto diferente → não unificar', () => {
    const carrinho = [linhaBase({ desconto_percentual: 0 })];
    const d = Composition.decidirComposicao(
      carrinho,
      linhaBase({ desconto_percentual: 5 }),
      Composition.MODOS.AUTOMATICO
    );
    assert.equal(d.acao, Composition.ACAO.CRIAR);
  });

  it('7. mesmo produto com promoção diferente → não unificar', () => {
    const carrinho = [linhaBase({ promocao_id: 1, preco_unitario: 8 })];
    const d = Composition.decidirComposicao(
      carrinho,
      linhaBase({ promocao_id: 2, preco_unitario: 8 }),
      Composition.MODOS.AUTOMATICO
    );
    assert.equal(d.acao, Composition.ACAO.CRIAR);
  });

  it('8. Fiscal + Não Fiscal — composição não altera item_fiscal da linha', () => {
    const fiscal = linhaBase({ item_fiscal: 1, quantidade: 1 });
    const d = Composition.decidirComposicao(
      [fiscal],
      linhaBase({ item_fiscal: 0, quantidade: 1 }),
      Composition.MODOS.UNIFICAR
    );
    assert.equal(d.acao, Composition.ACAO.UNIFICAR);
    assert.equal(Number(fiscal.item_fiscal), 1);
  });

  it('9. Estoque — soma correta das quantidades entre linhas', () => {
    const carrinho = [
      linhaBase({ quantidade: 2, linha_id: 'a' }),
      linhaBase({ quantidade: 1, linha_id: 'b' })
    ];
    assert.equal(Composition.somarQuantidadeProduto(carrinho, 20, 'PESO'), 3);
  });

  it('10. Persistência — duas linhas do mesmo produto permitidas (sem UNIQUE)', async () => {
    const db = await openDb();
    try {
      await run(db, `CREATE TABLE vendas_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER,
        produto_id INTEGER,
        quantidade REAL NOT NULL,
        preco_unitario REAL NOT NULL,
        subtotal REAL
      )`);
      await run(db, `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal)
        VALUES (100, 20, 2, 15, 30)`);
      await run(db, `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal)
        VALUES (100, 20, 1, 15, 15)`);
      const rows = await all(db, 'SELECT id, produto_id, quantidade, subtotal FROM vendas_itens WHERE venda_id = 100 ORDER BY id');
      assert.equal(rows.length, 2);
      assert.equal(Number(rows[0].produto_id), 20);
      assert.equal(Number(rows[1].produto_id), 20);
      assert.equal(Number(rows[0].quantidade), 2);
      assert.equal(Number(rows[1].quantidade), 1);
      assert.notEqual(rows[0].id, rows[1].id);
    } finally {
      await closeDb(db);
    }
  });

  it('11. Venda existente — comportamento UNIFICAR preservado (padrão)', () => {
    assert.equal(Composition.normalizarModo(null), 'UNIFICAR');
    assert.equal(Composition.normalizarModo(''), 'UNIFICAR');
    assert.equal(Composition.normalizarModo('lixo'), 'UNIFICAR');
    const d = Composition.decidirComposicao(
      [linhaBase()],
      linhaBase(),
      null
    );
    assert.equal(d.acao, Composition.ACAO.UNIFICAR);
  });

  it('12. Atacado — AUTOMATICO unifica quando condições comerciais iguais', () => {
    const carrinho = [linhaBase({ tipo_preco: 'atacado', desconto_atacado: 2, preco_unitario: 9 })];
    const dOk = Composition.decidirComposicao(
      carrinho,
      linhaBase({ tipo_preco: 'atacado', desconto_atacado: 2, preco_unitario: 9 }),
      Composition.MODOS.AUTOMATICO
    );
    assert.equal(dOk.acao, Composition.ACAO.UNIFICAR);
    const dDiff = Composition.decidirComposicao(
      carrinho,
      linhaBase({ tipo_preco: 'varejo', desconto_atacado: 0, preco_unitario: 9 }),
      Composition.MODOS.AUTOMATICO
    );
    assert.equal(dDiff.acao, Composition.ACAO.CRIAR);
  });

  it('13. Etiqueta de balança — subtotal fixo impede unificação automática indevida', () => {
    const comEtiqueta = linhaBase({
      preco_unitario: 15,
      subtotal_fixo: 30,
      etiqueta_balanca: { tipoPayload: 'VALOR', subtotalFixo: 30 }
    });
    const semEtiqueta = linhaBase({
      preco_unitario: 15,
      subtotal_fixo: null
    });
    const d = Composition.decidirComposicao(
      [comEtiqueta],
      semEtiqueta,
      Composition.MODOS.AUTOMATICO
    );
    assert.equal(d.acao, Composition.ACAO.CRIAR);
  });

  it('14. Cancelamento — linhas preservam linha_id próprio', () => {
    const a = Composition.garantirLinhaId(linhaBase({ linha_id: undefined }));
    const b = Composition.garantirLinhaId(linhaBase({ linha_id: undefined }));
    assert.ok(a.linha_id);
    assert.ok(b.linha_id);
    assert.notEqual(a.linha_id, b.linha_id);
  });

  it('15. Devolução — item individual identificável (ids distintos)', async () => {
    const db = await openDb();
    try {
      await run(db, `CREATE TABLE vendas_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER,
        produto_id INTEGER,
        quantidade REAL NOT NULL,
        preco_unitario REAL NOT NULL,
        subtotal REAL
      )`);
      await run(db, `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal)
        VALUES (100, 20, 2, 15, 30)`);
      await run(db, `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal)
        VALUES (100, 20, 1, 15, 15)`);
      const rows = await all(db, 'SELECT id FROM vendas_itens WHERE venda_id = 100 ORDER BY id');
      assert.equal(rows[0].id, 1);
      assert.equal(rows[1].id, 2);
    } finally {
      await closeDb(db);
    }
  });

  it('salvar valores válidos e rejeitar inválidos', async () => {
    const db = await openDb();
    try {
      await run(db, `CREATE TABLE configuracoes (
        chave TEXT PRIMARY KEY, valor TEXT, tipo TEXT, descricao TEXT, updated_at TEXT
      )`);
      const sep = await salvarAsync(db, 'SEPARAR');
      assert.equal(sep.valor, 'SEPARAR');
      const auto = await salvarAsync(db, 'AUTOMATICO');
      assert.equal(auto.valor, 'AUTOMATICO');
      await assert.rejects(() => salvarAsync(db, 'INVALIDO'));
    } finally {
      await closeDb(db);
    }
  });

  it('schema vendas_itens sem UNIQUE (venda_id, produto_id)', () => {
    const dbSrc = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
    const bloco = dbSrc.slice(
      dbSrc.indexOf('CREATE TABLE IF NOT EXISTS vendas_itens'),
      dbSrc.indexOf('CREATE TABLE IF NOT EXISTS vendas_itens') + 1200
    );
    assert.doesNotMatch(bloco, /UNIQUE\s*\(\s*venda_id\s*,\s*produto_id\s*\)/i);
  });

  it('frontend espelha o motor de composição', () => {
    const front = fs.readFileSync(
      path.join(ROOT, 'frontend/shared/js/PDVItemCompositionService.js'),
      'utf8'
    );
    assert.match(front, /decidirComposicao/);
    assert.match(front, /linhasCompativeisAutomatico/);
    assert.match(front, /gerarLinhaId/);
    assert.match(front, /PDVItemCompositionService/);
  });
});
