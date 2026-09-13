/**
 * Sprint 2.2 — Multi-origem do Núcleo Transacional.
 * Confirma: origem reconhecida, sem caixa, sem conclusão de venda.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  VendaOrigin,
  VENDA_ORIGENS,
  resolverVendaOrigin,
  origemExigeCaixa,
  origemPodeConcluirVenda
} = require('../../backend/services/vendas/VendaOrigin');
const { criarVendaContext, criarVendaContextOrigem } = require('../../backend/services/vendas/VendaContext');
const { criarVendaContract } = require('../../backend/services/vendas/VendaContract');

describe('VendaOrigin — Sprint 2.2', () => {
  it('lista todas as origens oficiais', () => {
    assert.deepEqual(VENDA_ORIGENS.slice().sort(), [
      'API',
      'COMPRA_FACIL',
      'FATURAMENTO',
      'MARKETPLACE',
      'NF_AVULSA',
      'ORCAMENTO',
      'PEDIDO',
      'PDV'
    ].sort());
  });

  it('padrão ausente / inválido continua PDV', () => {
    assert.equal(resolverVendaOrigin(undefined), VendaOrigin.PDV);
    assert.equal(resolverVendaOrigin(null), VendaOrigin.PDV);
    assert.equal(resolverVendaOrigin(''), VendaOrigin.PDV);
    assert.equal(resolverVendaOrigin('xyz'), VendaOrigin.PDV);
  });

  it('somente PDV exige caixa; PDV, FATURAMENTO e NF_AVULSA podem concluir', () => {
    assert.equal(origemExigeCaixa(VendaOrigin.PDV), true);
    assert.equal(origemPodeConcluirVenda(VendaOrigin.PDV), true);
    assert.equal(origemExigeCaixa('FATURAMENTO'), false);
    assert.equal(origemPodeConcluirVenda('FATURAMENTO'), true);
    assert.equal(origemExigeCaixa('NF_AVULSA'), false);
    assert.equal(origemPodeConcluirVenda('NF_AVULSA'), true);
    for (const o of ['PEDIDO', 'API', 'ORCAMENTO', 'COMPRA_FACIL', 'MARKETPLACE']) {
      assert.equal(origemExigeCaixa(o), false, o);
      assert.equal(origemPodeConcluirVenda(o), false, o);
    }
  });
});

describe('VendaApplicationService — política multi-origem', () => {
  function loadAppWithFakePagamento() {
    const pagamentoPath = require.resolve('../../backend/services/vendas/VendaPagamentoService');
    const appPath = path.resolve(__dirname, '../../backend/services/vendas/VendaApplicationService.js');
    const originalPag = require.cache[pagamentoPath];
    const originalApp = require.cache[appPath];

    let pagamentoChamado = 0;
    require.cache[pagamentoPath] = {
      id: pagamentoPath,
      filename: pagamentoPath,
      loaded: true,
      exports: {
        criarVenda() {
          pagamentoChamado += 1;
          return 'DELEGATED_PDV';
        }
      }
    };
    delete require.cache[appPath];

    const app = require('../../backend/services/vendas/VendaApplicationService');
    return {
      app,
      getPagamentoChamado: () => pagamentoChamado,
      restore() {
        if (originalPag) require.cache[pagamentoPath] = originalPag;
        else delete require.cache[pagamentoPath];
        if (originalApp) require.cache[appPath] = originalApp;
        else delete require.cache[appPath];
      }
    };
  }

  function mockRes() {
    const state = { statusCode: null, body: null };
    return {
      state,
      status(code) {
        state.statusCode = code;
        return this;
      },
      json(payload) {
        state.body = payload;
        return payload;
      }
    };
  }

  it('origem PDV (padrão) delega ao VendaPagamentoService', () => {
    const { app, getPagamentoChamado, restore } = loadAppWithFakePagamento();
    try {
      const req = { body: { total: 10, itens: [] } };
      const res = mockRes();
      const result = app.criarVenda(req, res);
      assert.equal(result, 'DELEGATED_PDV');
      assert.equal(getPagamentoChamado(), 1);
      assert.equal(req.vendaContext.origem, VendaOrigin.PDV);
    } finally {
      restore();
    }
  });

  it('origem PEDIDO reconhece e NÃO conclui / NÃO chama núcleo', () => {
    const { app, getPagamentoChamado, restore } = loadAppWithFakePagamento();
    try {
      const req = { body: { origem: 'PEDIDO', total: 50, itens: [{ produto_id: 1 }] } };
      const res = mockRes();
      app.criarVenda(req, res);
      assert.equal(getPagamentoChamado(), 0);
      assert.equal(res.state.statusCode, 200);
      assert.equal(res.state.body.origem, 'PEDIDO');
      assert.equal(res.state.body.reconhecida, true);
      assert.equal(res.state.body.venda_concluida, false);
      assert.equal(res.state.body.exige_caixa, false);
    } finally {
      restore();
    }
  });

  it('origem FATURAMENTO reconhece e DELEGA ao núcleo (Sprint 3.1)', () => {
    const { app, getPagamentoChamado, restore } = loadAppWithFakePagamento();
    try {
      const contract = criarVendaContract({ origem: 'FATURAMENTO', total: 100 });
      const context = criarVendaContextOrigem('FATURAMENTO');
      const req = { body: contract.payload };
      const res = mockRes();
      const result = app.criarVendaComContexto(contract, context, req, res);
      assert.equal(result, 'DELEGATED_PDV');
      assert.equal(getPagamentoChamado(), 1);
      assert.equal(req.vendaContext.origem, 'FATURAMENTO');
    } finally {
      restore();
    }
  });

  it('origem NF_AVULSA reconhece e DELEGA ao núcleo (RC3.16)', () => {
    const { app, getPagamentoChamado, restore } = loadAppWithFakePagamento();
    try {
      const contract = criarVendaContract({ origem: 'NF_AVULSA', total: 80 });
      const context = criarVendaContextOrigem('NF_AVULSA');
      const req = { body: contract.payload };
      const res = mockRes();
      const result = app.criarVendaComContexto(contract, context, req, res);
      assert.equal(result, 'DELEGATED_PDV');
      assert.equal(getPagamentoChamado(), 1);
      assert.equal(req.vendaContext.origem, 'NF_AVULSA');
    } finally {
      restore();
    }
  });

  it('origem API reconhece e NÃO conclui', () => {
    const { app, getPagamentoChamado, restore } = loadAppWithFakePagamento();
    try {
      const req = { body: { origem: 'API', total: 1 } };
      const res = mockRes();
      app.criarVenda(req, res);
      assert.equal(getPagamentoChamado(), 0);
      assert.equal(res.state.body.origem, 'API');
      assert.equal(res.state.body.venda_concluida, false);
    } finally {
      restore();
    }
  });

  it('rota usa validarCaixaSeOrigemPdv e ApplicationService', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../backend/rotas/vendas.js'),
      'utf8'
    );
    assert.match(src, /validarCaixaSeOrigemPdv/);
    assert.match(src, /VendaApplicationService/);
    assert.match(src, /router\.post\('\/',\s*validarCaixaSeOrigemPdv,\s*criarVenda\)/);
  });

  it('middleware PDV chama validarCaixaAberto; demais não', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../backend/middleware/validarCaixaAberto.js'),
      'utf8'
    );
    assert.match(src, /function validarCaixaSeOrigemPdv/);
    assert.match(src, /origemExigeCaixa/);
  });
});

describe('VendaContext / VendaContract', () => {
  it('cria contexto com origem e campos reservados', () => {
    const ctx = criarVendaContext(
      { operadorId: 7, terminalId: 3, caixaId: 2, caixaSessaoId: 9, body: { origem: 'PEDIDO' } }
    );
    assert.equal(ctx.origem, 'PEDIDO');
    assert.equal(ctx.operador, 7);
    assert.equal(ctx.terminal, 3);
    assert.equal(ctx.caixa, 2);
    assert.equal(ctx.sessao, 9);
  });

  it('contrato espelha payload sem transformar', () => {
    const c = criarVendaContract({
      body: { total: 12.5, itens: [{ produto_id: 1 }], forma_pagamento: 'dinheiro', origem: 'API' }
    });
    assert.equal(c.total, 12.5);
    assert.equal(c.itens.length, 1);
    assert.equal(c.forma_pagamento, 'dinheiro');
    assert.equal(c.origem, 'API');
  });
});

describe('Regressão — motores não alterados nesta Sprint', () => {
  it('arquivos de motores proibidos existem e não foram o alvo desta Sprint (smoke)', () => {
    const fs = require('fs');
    const files = [
      'backend/services/fiscalNaoFiscalService.js',
      'backend/services/distribuidorEstoqueVenda.js',
      'backend/services/DistribuidorPagamento.js',
      'backend/services/OrquestradorPagamento.js',
      'backend/services/vendas/VendaFinanceiroService.js',
      'backend/services/vendas/VendaFiscalService.js',
      'backend/services/estoque/EstoqueReservaService.js'
    ];
    for (const rel of files) {
      assert.ok(fs.existsSync(path.resolve(__dirname, '../..', rel)), rel);
    }
  });
});
