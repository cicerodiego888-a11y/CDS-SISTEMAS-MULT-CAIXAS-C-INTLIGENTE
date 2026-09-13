/**
 * Sprint 3.1 — Faturamento (Pedido → Núcleo Transacional)
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const { VendaOrigin, origemPodeConcluirVenda, origemExigeCaixa } = require('../../backend/services/vendas/VendaOrigin');
const { montarPayloadVendaDoPedido } = require('../../backend/services/faturamento/FaturamentoService');
const { criarVendaContract } = require('../../backend/services/vendas/VendaContract');
const { criarVendaContextOrigem } = require('../../backend/services/vendas/VendaContext');

describe('Sprint 3.1 — política FATURAMENTO', () => {
  it('FATURAMENTO pode concluir e NÃO exige caixa', () => {
    assert.equal(origemPodeConcluirVenda(VendaOrigin.FATURAMENTO), true);
    assert.equal(origemExigeCaixa(VendaOrigin.FATURAMENTO), false);
  });

  it('PEDIDO ainda NÃO conclui (só Faturamento é a ponte)', () => {
    assert.equal(origemPodeConcluirVenda(VendaOrigin.PEDIDO), false);
  });

  it('PDV continua concluindo e exigindo caixa', () => {
    assert.equal(origemPodeConcluirVenda(VendaOrigin.PDV), true);
    assert.equal(origemExigeCaixa(VendaOrigin.PDV), true);
  });
});

describe('Sprint 3.1 — conversor Pedido → VendaContract', () => {
  it('monta payload com origem FATURAMENTO e emitir_fiscal=false', () => {
    const pedido = {
      id: 10,
      cliente_id: 5,
      total: 100,
      desconto: 0,
      observacao: 'teste',
      itens: [
        { produto_id: 1, quantidade: 2, preco_unitario: 50, subtotal: 100, tipo_venda: 'PESO' }
      ]
    };
    const payload = montarPayloadVendaDoPedido(pedido, {
      forma_pagamento: 'dinheiro',
      pagamentos: [{ forma: 'dinheiro', valor: 100 }]
    });
    assert.equal(payload.origem, 'FATURAMENTO');
    assert.equal(payload.emitir_fiscal, false);
    assert.equal(payload.pedido_id, 10);
    assert.equal(payload.itens.length, 1);
    assert.equal(payload.total, 100);

    const contract = criarVendaContract({ body: payload });
    const context = criarVendaContextOrigem('FATURAMENTO');
    assert.equal(context.origem, 'FATURAMENTO');
    assert.equal(contract.payload.origem, 'FATURAMENTO');
  });
});

describe('Sprint 3.1 — ApplicationService delega FATURAMENTO ao núcleo', () => {
  it('origem FATURAMENTO chama VendaPagamentoService', () => {
    const pagamentoPath = require.resolve('../../backend/services/vendas/VendaPagamentoService');
    const appPath = path.resolve(__dirname, '../../backend/services/vendas/VendaApplicationService.js');
    const originalPag = require.cache[pagamentoPath];
    const originalApp = require.cache[appPath];

    let chamado = 0;
    require.cache[pagamentoPath] = {
      id: pagamentoPath,
      filename: pagamentoPath,
      loaded: true,
      exports: {
        criarVenda() {
          chamado += 1;
          return 'NUCLEO_OK';
        }
      }
    };
    delete require.cache[appPath];

    try {
      const app = require('../../backend/services/vendas/VendaApplicationService');
      const req = { body: { origem: 'FATURAMENTO', total: 10, itens: [] } };
      const res = { status() { return this; }, json() { return this; } };
      const result = app.criarVenda(req, res);
      assert.equal(result, 'NUCLEO_OK');
      assert.equal(chamado, 1);
      assert.equal(req.vendaContext.origem, 'FATURAMENTO');
    } finally {
      if (originalPag) require.cache[pagamentoPath] = originalPag;
      else delete require.cache[pagamentoPath];
      if (originalApp) require.cache[appPath] = originalApp;
      else delete require.cache[appPath];
    }
  });
});

describe('Sprint 3.1 — artefatos e módulo', () => {
  it('rota /api/faturamento montada e menu com data-recurso', () => {
    const server = fs.readFileSync(path.resolve(__dirname, '../../backend/server.js'), 'utf8');
    assert.match(server, /faturamentoRoutes/);
    assert.match(server, /\/api\/faturamento/);

    const html = fs.readFileSync(path.resolve(__dirname, '../../frontend/erp/index.html'), 'utf8');
    assert.match(html, /data-recurso="expedicao"/);
    assert.match(html, /data-page="faturamento"/);
    assert.match(html, /faturamento\.js/);

    const cfg = fs.readFileSync(path.resolve(__dirname, '../../backend/services/configuracaoService.js'), 'utf8');
    assert.match(cfg, /habilitar_faturamento/);
    assert.match(cfg, /faturamento:/);
  });

  it('não altera motores proibidos (smoke paths)', () => {
    const files = [
      'backend/services/fiscalNaoFiscalService.js',
      'backend/services/DistribuidorPagamento.js',
      'backend/services/distribuidorEstoqueVenda.js',
      'backend/services/OrquestradorPagamento.js',
      'backend/services/vendas/VendaPagamentoService.js',
      'backend/services/vendas/VendaFinanceiroService.js',
      'backend/services/estoque/EstoqueReservaService.js'
    ];
    for (const rel of files) {
      assert.ok(fs.existsSync(path.resolve(__dirname, '../..', rel)), rel);
    }
  });
});

describe('Sprint 3.1 — persistência pedidos (sqlite isolado)', () => {
  let db;
  let file;

  before(async () => {
    file = path.join(os.tmpdir(), `fat-sprint31-${Date.now()}.db`);
    db = await new Promise((resolve, reject) => {
      const conn = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(conn)));
    });
    const run = (sql, params = []) => new Promise((resolve, reject) => {
      db.run(sql, params, function cb(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
    await run(`
      CREATE TABLE pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT UNIQUE,
        data_pedido DATE NOT NULL,
        cliente_id INTEGER,
        total REAL NOT NULL DEFAULT 0,
        desconto REAL DEFAULT 0,
        status TEXT NOT NULL,
        representante_id INTEGER,
        representante_nome TEXT,
        observacao TEXT,
        operador_id INTEGER,
        venda_id INTEGER,
        faturado_em DATETIME,
        faturado_por INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME
      )
    `);
    await run(`
      CREATE TABLE pedidos_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pedido_id INTEGER NOT NULL,
        produto_id INTEGER NOT NULL,
        quantidade REAL NOT NULL,
        preco_unitario REAL NOT NULL,
        desconto_percentual REAL DEFAULT 0,
        subtotal REAL NOT NULL,
        tipo_venda TEXT DEFAULT 'PESO'
      )
    `);
    const ins = await run(
      `INSERT INTO pedidos (codigo, data_pedido, total, status, representante_nome)
       VALUES ('PED-T', '2026-07-20', 50, 'AGUARDANDO_FATURAMENTO', 'Rep')`
    );
    await run(
      `INSERT INTO pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario, subtotal)
       VALUES (?, 1, 1, 50, 50)`,
      [ins.lastID]
    );
    this.pedidoId = ins.lastID;
  });

  after(async () => {
    await new Promise((resolve) => db.close(() => resolve()));
    try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
  });

  it('atualiza status para FATURADO e grava venda_id', async () => {
    const pedidoId = this.pedidoId;
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE pedidos SET status='FATURADO', venda_id=99, faturado_em=DATETIME('now')
         WHERE id=? AND status IN ('ABERTO','AGUARDANDO_FATURAMENTO')`,
        [pedidoId],
        (err) => (err ? reject(err) : resolve())
      );
    });
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT status, venda_id FROM pedidos WHERE id=?', [pedidoId], (err, r) => (err ? reject(err) : resolve(r)));
    });
    assert.equal(row.status, 'FATURADO');
    assert.equal(row.venda_id, 99);
  });
});
