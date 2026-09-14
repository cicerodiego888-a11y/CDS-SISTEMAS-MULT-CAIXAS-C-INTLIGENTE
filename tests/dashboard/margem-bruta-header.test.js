'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const {
  calcularResumoMargemBrutaAsync,
  resolverPeriodoOperacional
} = require('../../backend/services/dashboard/MargemBrutaRealService');

const ROOT = path.join(__dirname, '../..');
const HOJE = '2026-09-13';

function abrirDb(comEmpresa, cb) {
  const db = new sqlite3.Database(':memory:');
  db.serialize(() => {
    db.run(`CREATE TABLE produtos (
      id INTEGER PRIMARY KEY,
      nome TEXT,
      preco_compra REAL
    )`);
    db.run(`CREATE TABLE vendas (
      id INTEGER PRIMARY KEY,
      data_venda TEXT,
      status TEXT,
      cancelada INTEGER DEFAULT 0
      ${comEmpresa ? ', empresa_id INTEGER' : ''}
    )`);
    db.run(`CREATE TABLE vendas_itens (
      id INTEGER PRIMARY KEY,
      venda_id INTEGER,
      produto_id INTEGER,
      quantidade REAL,
      preco_unitario REAL,
      custo_unitario REAL,
      quantidade_fiscal REAL DEFAULT 0,
      quantidade_nao_fiscal REAL DEFAULT 0
    )`);
    db.run(`CREATE TABLE vendas_devolucoes (
      id INTEGER PRIMARY KEY,
      venda_id INTEGER,
      venda_item_id INTEGER,
      quantidade REAL
    )`, cb);
  });
  return db;
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

describe('Margem Bruta Real — header / resumo', () => {
  it('TESTE 01 — sem vendas zera faturamento, CMV, lucro e margem', async () => {
    const db = await new Promise((resolve, reject) => {
      const inst = abrirDb(false, (err) => (err ? reject(err) : resolve(inst)));
    });
    const resumo = await calcularResumoMargemBrutaAsync(db, { inicio: HOJE, fim: HOJE });
    assert.equal(resumo.faturamento_bruto, 0);
    assert.equal(resumo.custo_mercadoria, 0);
    assert.equal(resumo.lucro_bruto, 0);
    assert.equal(resumo.margem_bruta, 0);
    db.close();
  });

  it('TESTE 02 — venda 100 / custo histórico 60 = margem 40%', async () => {
    const db = await new Promise((resolve, reject) => {
      const inst = abrirDb(false, (err) => (err ? reject(err) : resolve(inst)));
    });
    await run(db, `INSERT INTO produtos (id, nome, preco_compra) VALUES (1, 'A', 60)`);
    await run(db, `INSERT INTO vendas (id, data_venda, status) VALUES (1, ?, 'concluida')`, [HOJE]);
    await run(db, `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, custo_unitario)
      VALUES (1, 1, 1, 100, 60)`);
    const resumo = await calcularResumoMargemBrutaAsync(db, { inicio: HOJE, fim: HOJE });
    assert.equal(resumo.faturamento_bruto, 100);
    assert.equal(resumo.custo_mercadoria, 60);
    assert.equal(resumo.lucro_bruto, 40);
    assert.equal(resumo.margem_bruta, 40);
    db.close();
  });

  it('TESTE 03 — alterar custo atual do produto não muda o card', async () => {
    const db = await new Promise((resolve, reject) => {
      const inst = abrirDb(false, (err) => (err ? reject(err) : resolve(inst)));
    });
    await run(db, `INSERT INTO produtos (id, nome, preco_compra) VALUES (1, 'A', 60)`);
    await run(db, `INSERT INTO vendas (id, data_venda, status) VALUES (1, ?, 'concluida')`, [HOJE]);
    await run(db, `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, custo_unitario)
      VALUES (1, 1, 1, 100, 60)`);
    await run(db, `UPDATE produtos SET preco_compra = 10 WHERE id = 1`);
    const resumo = await calcularResumoMargemBrutaAsync(db, { inicio: HOJE, fim: HOJE });
    assert.equal(resumo.custo_mercadoria, 60);
    assert.equal(resumo.lucro_bruto, 40);
    assert.equal(resumo.margem_bruta, 40);
    db.close();
  });

  it('TESTE 04 — duas vendas com custos históricos diferentes são agregadas', async () => {
    const db = await new Promise((resolve, reject) => {
      const inst = abrirDb(false, (err) => (err ? reject(err) : resolve(inst)));
    });
    await run(db, `INSERT INTO produtos (id, nome, preco_compra) VALUES (1, 'A', 999)`);
    await run(db, `INSERT INTO vendas (id, data_venda, status) VALUES (1, ?, 'concluida'), (2, ?, 'concluida')`, [HOJE, HOJE]);
    await run(db, `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, custo_unitario) VALUES
      (1, 1, 1, 100, 60),
      (2, 1, 1, 200, 80)`);
    const resumo = await calcularResumoMargemBrutaAsync(db, { inicio: HOJE, fim: HOJE });
    assert.equal(resumo.faturamento_bruto, 300);
    assert.equal(resumo.custo_mercadoria, 140);
    assert.equal(resumo.lucro_bruto, 160);
    assert.equal(resumo.margem_bruta, 53.33);
    db.close();
  });

  it('TESTE 05 — venda cancelada deixa de compor o resumo', async () => {
    const db = await new Promise((resolve, reject) => {
      const inst = abrirDb(false, (err) => (err ? reject(err) : resolve(inst)));
    });
    await run(db, `INSERT INTO produtos (id, nome, preco_compra) VALUES (1, 'A', 60)`);
    await run(db, `INSERT INTO vendas (id, data_venda, status) VALUES
      (1, ?, 'concluida'),
      (2, ?, 'cancelada')`, [HOJE, HOJE]);
    await run(db, `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, custo_unitario) VALUES
      (1, 1, 1, 100, 60),
      (2, 1, 1, 500, 10)`);
    const resumo = await calcularResumoMargemBrutaAsync(db, { inicio: HOJE, fim: HOJE });
    assert.equal(resumo.faturamento_bruto, 100);
    assert.equal(resumo.custo_mercadoria, 60);
    assert.equal(resumo.lucro_bruto, 40);
    db.close();
  });

  it('TESTE 05b — devolução reduz faturamento e CMV pela regra existente', async () => {
    const db = await new Promise((resolve, reject) => {
      const inst = abrirDb(false, (err) => (err ? reject(err) : resolve(inst)));
    });
    await run(db, `INSERT INTO produtos (id, nome, preco_compra) VALUES (1, 'A', 60)`);
    await run(db, `INSERT INTO vendas (id, data_venda, status) VALUES (1, ?, 'concluida')`, [HOJE]);
    await run(db, `INSERT INTO vendas_itens (id, venda_id, produto_id, quantidade, preco_unitario, custo_unitario)
      VALUES (10, 1, 1, 2, 100, 60)`);
    await run(db, `INSERT INTO vendas_devolucoes (venda_id, venda_item_id, quantidade) VALUES (1, 10, 1)`);
    const resumo = await calcularResumoMargemBrutaAsync(db, { inicio: HOJE, fim: HOJE });
    assert.equal(resumo.faturamento_bruto, 100);
    assert.equal(resumo.custo_mercadoria, 60);
    db.close();
  });

  it('TESTE 06 — nova venda no período entra no próximo cálculo', async () => {
    const db = await new Promise((resolve, reject) => {
      const inst = abrirDb(false, (err) => (err ? reject(err) : resolve(inst)));
    });
    await run(db, `INSERT INTO produtos (id, nome, preco_compra) VALUES (1, 'A', 60)`);
    const vazio = await calcularResumoMargemBrutaAsync(db, { inicio: HOJE, fim: HOJE });
    assert.equal(vazio.faturamento_bruto, 0);
    await run(db, `INSERT INTO vendas (id, data_venda, status) VALUES (1, ?, 'concluida')`, [HOJE]);
    await run(db, `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, custo_unitario)
      VALUES (1, 1, 1, 100, 60)`);
    const depois = await calcularResumoMargemBrutaAsync(db, { inicio: HOJE, fim: HOJE });
    assert.equal(depois.faturamento_bruto, 100);
    db.close();
  });

  it('TESTE 07 — poller único de 10s sem timers concorrentes', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/dashboard-margem-bruta.js'), 'utf8');
    assert.match(src, /const POLL_MS = 10000/);
    assert.match(src, /TIMER_KEY = '__CDS_MARGEM_BRUTA_TIMER__'/);
    assert.match(src, /if \(global\[TIMER_KEY\]\) return/);
    assert.match(src, /INFLIGHT_KEY/);
    assert.match(src, /SEQ_KEY/);
    assert.match(src, /clearInterval/);
    assert.doesNotMatch(src, /setInterval\([\s\S]*setInterval/);
  });

  it('TESTE 08 — empresa A não vê margem da empresa B', async () => {
    const db = await new Promise((resolve, reject) => {
      const inst = abrirDb(true, (err) => (err ? reject(err) : resolve(inst)));
    });
    await run(db, `INSERT INTO produtos (id, nome, preco_compra) VALUES (1, 'A', 10)`);
    await run(db, `INSERT INTO vendas (id, data_venda, status, empresa_id) VALUES
      (1, ?, 'concluida', 1),
      (2, ?, 'concluida', 2)`, [HOJE, HOJE]);
    await run(db, `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, custo_unitario) VALUES
      (1, 1, 1, 100, 40),
      (2, 1, 1, 900, 10)`);
    const a = await calcularResumoMargemBrutaAsync(db, { inicio: HOJE, fim: HOJE, empresa_id: 1 });
    const b = await calcularResumoMargemBrutaAsync(db, { inicio: HOJE, fim: HOJE, empresa_id: 2 });
    assert.equal(a.faturamento_bruto, 100);
    assert.equal(a.custo_mercadoria, 40);
    assert.equal(b.faturamento_bruto, 900);
    assert.equal(b.custo_mercadoria, 10);
    db.close();
  });

  it('TESTE 09 — card e dashboard usam o mesmo serviço/período', () => {
    const rota = fs.readFileSync(path.join(ROOT, 'backend/rotas/dashboard.js'), 'utf8');
    const page = fs.readFileSync(path.join(ROOT, 'frontend/erp/pages/dashboard.html'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/dashboard-margem-bruta.js'), 'utf8');
    assert.match(rota, /\/margem-bruta\/resumo/);
    assert.match(rota, /calcularResumoMargemBrutaAsync/);
    assert.match(rota, /resolverPeriodoOperacional/);
    assert.doesNotMatch(page, /ccMargemBrutaCard/);
    assert.match(page, /ccMargemBrutaDashboardKpi/);
    assert.match(page, /Margem Bruta Real/);
    assert.match(js, /dashboardMargemBrutaLucro/);
    assert.match(js, /\/dashboard\/margem-bruta\/resumo/);
    const periodo = resolverPeriodoOperacional({ inicio: '2026-09-01', fim: '2026-09-13' });
    assert.equal(periodo.inicio, '2026-09-01');
    assert.equal(periodo.fim, '2026-09-13');
  });

  it('TESTE 10 — não altera motores comercial/fiscal/financeiro', () => {
    const svc = fs.readFileSync(
      path.join(ROOT, 'backend/services/dashboard/MargemBrutaRealService.js'),
      'utf8'
    );
    assert.match(svc, /COALESCE\(vi\.custo_unitario, 0\)/);
    assert.doesNotMatch(svc, /p\.preco_compra|produtos p/);
    assert.doesNotMatch(svc, /Motor Comercial/);
    const pagamento = fs.readFileSync(
      path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'),
      'utf8'
    );
    assert.doesNotMatch(pagamento, /custo_unitario/);
  });
});
