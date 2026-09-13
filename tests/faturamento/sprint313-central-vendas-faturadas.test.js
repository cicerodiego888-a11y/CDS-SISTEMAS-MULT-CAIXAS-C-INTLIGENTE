/**
 * Sprint 3.13 — Central de Vendas Faturadas (módulo Faturamento)
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const FatSvc = require('../../backend/services/faturamento/FaturamentoService');
const configService = require('../../backend/services/configuracaoService');

describe('Sprint 3.13 — helpers de aba / F12', () => {
  it('normalizarAbaCentral e abasDisponiveisCentral', () => {
    assert.equal(FatSvc.normalizarAbaCentral('todas'), 'todas');
    assert.equal(FatSvc.normalizarAbaCentral('com-nfe'), 'com_nfe');
    assert.equal(FatSvc.normalizarAbaCentral('SEM_NFE'), 'sem_nfe');
    assert.equal(FatSvc.normalizarAbaCentral('pendentes'), 'pendentes');
    assert.equal(FatSvc.normalizarAbaCentral('canceladas'), 'canceladas');
    assert.equal(FatSvc.normalizarAbaCentral('xyz'), 'todas');
    assert.deepEqual(
      FatSvc.abasDisponiveisCentral(true),
      ['todas', 'com_nfe', 'pendentes', 'canceladas']
    );
    assert.deepEqual(
      FatSvc.abasDisponiveisCentral(false),
      ['todas', 'com_nfe', 'sem_nfe', 'pendentes', 'canceladas']
    );
  });
});

describe('Sprint 3.13 — listarVendasFaturadas (sqlite isolado)', () => {
  let db;
  const databasePath = require.resolve('../../backend/database');
  let originalDbCache;
  let originalRecurso;

  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function cb(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

  before(async () => {
    db = await new Promise((resolve, reject) => {
      const conn = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(conn)));
    });

    await run(`CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT)`);
    await run(`
      CREATE TABLE vendas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT,
        data_venda TEXT,
        created_at TEXT,
        cliente_id INTEGER,
        total REAL,
        valor_fiscal REAL,
        valor_nao_fiscal REAL,
        forma_pagamento TEXT,
        status TEXT,
        pedido_id INTEGER,
        origem TEXT
      )
    `);
    await run(`
      CREATE TABLE nfe_notas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER NOT NULL,
        numero INTEGER,
        serie INTEGER,
        chave_acesso TEXT,
        status TEXT,
        protocolo TEXT
      )
    `);
    await run(`CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);
    await run(`INSERT INTO configuracoes (chave, valor) VALUES ('modo_dashboard_fiscal', '0')`);
    await run(`INSERT INTO clientes (id, nome) VALUES (1, 'Cliente A')`);

    await run(
      `INSERT INTO vendas (id, codigo, data_venda, cliente_id, total, status, pedido_id, origem)
       VALUES (1, 'VF-1', '2026-07-21', 1, 100, 'concluida', 10, 'FATURAMENTO')`
    );
    await run(
      `INSERT INTO vendas (id, codigo, data_venda, cliente_id, total, status, pedido_id, origem)
       VALUES (2, 'VF-2', '2026-07-21', 1, 200, 'concluida', 11, 'FATURAMENTO')`
    );
    await run(
      `INSERT INTO nfe_notas (venda_id, numero, serie, chave_acesso, status)
       VALUES (2, 1, 1, 'CHAVE2', 'autorizada')`
    );
    await run(
      `INSERT INTO vendas (id, codigo, data_venda, cliente_id, total, status, pedido_id, origem)
       VALUES (3, 'VF-3', '2026-07-21', 1, 300, 'concluida', 12, 'FATURAMENTO')`
    );
    await run(
      `INSERT INTO nfe_notas (venda_id, numero, serie, status)
       VALUES (3, 2, 1, 'rejeitada')`
    );
    await run(
      `INSERT INTO vendas (id, codigo, data_venda, cliente_id, total, status, pedido_id, origem)
       VALUES (4, 'VF-4', '2026-07-21', 1, 40, 'cancelada', 13, 'FATURAMENTO')`
    );
    await run(
      `INSERT INTO vendas (id, codigo, data_venda, cliente_id, total, status, origem)
       VALUES (5, 'PDV-5', '2026-07-21', 1, 50, 'concluida', 'PDV')`
    );

    originalDbCache = require.cache[databasePath];
    require.cache[databasePath] = {
      id: databasePath,
      filename: databasePath,
      loaded: true,
      exports: db
    };

    originalRecurso = configService.recursoHabilitado;
    configService.recursoHabilitado = (nome) => nome === 'faturamento' || nome === 'nfe';
  });

  after(async () => {
    configService.recursoHabilitado = originalRecurso;
    if (originalDbCache) require.cache[databasePath] = originalDbCache;
    else delete require.cache[databasePath];
    await new Promise((resolve) => db.close(() => resolve()));
  });

  it('TODAS (F12 OFF) lista fiscais + não fiscais de origem FATURAMENTO', async () => {
    const out = await FatSvc.listarVendasFaturadas({ aba: 'todas', modo_fiscal: '0', page: 1, pageSize: 50 });
    const ids = out.itens.map((r) => r.id).sort((a, b) => a - b);
    assert.deepEqual(ids, [1, 2, 3, 4]);
    assert.equal(out.modo_operacional_fiscal, false);
    assert.ok(out.abas_disponiveis.includes('sem_nfe'));
  });

  it('COM NF-e lista apenas autorizada', async () => {
    const out = await FatSvc.listarVendasFaturadas({ aba: 'com_nfe', modo_fiscal: '0' });
    assert.equal(out.itens.length, 1);
    assert.equal(out.itens[0].id, 2);
    assert.equal(String(out.itens[0].nfe_status).toLowerCase(), 'autorizada');
  });

  it('SEM NF-e lista apenas sem documento', async () => {
    const out = await FatSvc.listarVendasFaturadas({ aba: 'sem_nfe', modo_fiscal: '0' });
    const ids = out.itens.map((r) => r.id).sort((a, b) => a - b);
    assert.deepEqual(ids, [1, 4]);
  });

  it('PENDENTES reutiliza status não autorizados', async () => {
    const out = await FatSvc.listarVendasFaturadas({ aba: 'pendentes', modo_fiscal: '0' });
    assert.equal(out.itens.length, 1);
    assert.equal(out.itens[0].id, 3);
    assert.equal(String(out.itens[0].nfe_status).toLowerCase(), 'rejeitada');
  });

  it('CANCELADAS usa status da venda', async () => {
    const out = await FatSvc.listarVendasFaturadas({ aba: 'canceladas', modo_fiscal: '0' });
    assert.equal(out.itens.length, 1);
    assert.equal(out.itens[0].id, 4);
  });

  it('F12 ON: TODAS só fiscais; Sem NF-e some das abas e é remapeada', async () => {
    const out = await FatSvc.listarVendasFaturadas({ aba: 'todas', modo_fiscal: '1' });
    const ids = out.itens.map((r) => r.id).sort((a, b) => a - b);
    assert.deepEqual(ids, [2, 3]);
    assert.equal(out.modo_operacional_fiscal, true);
    assert.ok(!out.abas_disponiveis.includes('sem_nfe'));

    const remap = await FatSvc.listarVendasFaturadas({ aba: 'sem_nfe', modo_fiscal: '1' });
    assert.equal(remap.aba, 'todas');
    assert.deepEqual(
      remap.itens.map((r) => r.id).sort((a, b) => a - b),
      [2, 3]
    );
  });

  it('F12 ON: Canceladas só se houver NF-e (venda fiscal)', async () => {
    const out = await FatSvc.listarVendasFaturadas({ aba: 'canceladas', modo_fiscal: '1' });
    assert.equal(out.itens.length, 0);
  });
});

describe('Sprint 3.13 — artefatos e isolamento', () => {
  it('rota e UI possuem Central de Vendas Faturadas', () => {
    const rota = fs.readFileSync(
      path.resolve(__dirname, '../../backend/rotas/faturamento.js'),
      'utf8'
    );
    assert.match(rota, /\/vendas-faturadas/);
    assert.match(rota, /listarVendasFaturadas/);

    const svc = fs.readFileSync(
      path.resolve(__dirname, '../../backend/services/faturamento/FaturamentoService.js'),
      'utf8'
    );
    assert.match(svc, /listarVendasFaturadas/);
    assert.match(svc, /nfe_notas/);

    const ui = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/erp/js/faturamento.js'),
      'utf8'
    );
    assert.match(ui, /Vendas faturadas/);
    assert.match(ui, /vendas-faturadas/);
    assert.match(ui, /sem_nfe/);
    assert.match(ui, /Pedidos aguardando/);
    assert.match(ui, /atualizarTudo/);
  });

  it('não altera /api/vendas nem núcleos proibidos (smoke)', () => {
    const vendasRota = fs.readFileSync(
      path.resolve(__dirname, '../../backend/rotas/vendas.js'),
      'utf8'
    );
    assert.ok(!vendasRota.includes('vendas-faturadas'));

    const files = [
      'backend/services/distribuidorEstoqueVenda.js',
      'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js',
      'backend/services/vendas/VendaApplicationService.js',
      'backend/services/vendas/VendaPagamentoService.js',
      'frontend/pdv/js/pdv.js',
      'backend/services/fiscal/nfeEmissorVenda.js'
    ];
    for (const rel of files) {
      assert.ok(fs.existsSync(path.resolve(__dirname, '../..', rel)), rel);
    }
  });
});
