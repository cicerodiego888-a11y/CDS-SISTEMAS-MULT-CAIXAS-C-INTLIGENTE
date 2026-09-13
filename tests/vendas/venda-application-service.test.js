/**
 * Sprint 2.0 / 2.2 — VendaApplicationService.
 * Garante delegação integral no caminho PDV sem transformação.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

describe('VendaApplicationService — Sprint 2.0 / 2.2', () => {
  it('criarVenda (PDV) delega integralmente para VendaPagamentoService.criarVenda', () => {
    const pagamentoPath = require.resolve('../../backend/services/vendas/VendaPagamentoService');
    const appPath = path.resolve(__dirname, '../../backend/services/vendas/VendaApplicationService.js');

    const originalCache = require.cache[pagamentoPath];
    const originalAppCache = require.cache[appPath];

    let calledWith = null;
    const fakeCriarVenda = function fakeCriarVenda(req, res) {
      calledWith = { req, res, thisArg: this };
      return 'DELEGATED_OK';
    };

    require.cache[pagamentoPath] = {
      id: pagamentoPath,
      filename: pagamentoPath,
      loaded: true,
      exports: { criarVenda: fakeCriarVenda }
    };
    delete require.cache[appPath];

    try {
      const VendaApplicationService = require('../../backend/services/vendas/VendaApplicationService');
      const req = { body: { total: 10 } };
      const res = { statusCode: 200 };
      const result = VendaApplicationService.criarVenda(req, res);

      assert.equal(result, 'DELEGATED_OK');
      assert.equal(calledWith.req, req);
      assert.equal(calledWith.res, res);
      assert.ok(typeof VendaApplicationService.criarVenda === 'function');
      assert.ok(typeof VendaApplicationService.criarVendaComContexto === 'function');
      assert.equal(req.vendaContext.origem, 'PDV');
    } finally {
      if (originalCache) require.cache[pagamentoPath] = originalCache;
      else delete require.cache[pagamentoPath];
      if (originalAppCache) require.cache[appPath] = originalAppCache;
      else delete require.cache[appPath];
    }
  });

  it('rota de vendas importa criarVenda da ApplicationService', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../backend/rotas/vendas.js'),
      'utf8'
    );
    assert.match(src, /VendaApplicationService/);
    assert.match(src, /const \{\s*criarVenda\s*\} = VendaApplicationService/);
    assert.doesNotMatch(
      src,
      /const \{\s*[^}]*criarVenda[^}]*\} = VendaPagamentoService/
    );
  });
});
