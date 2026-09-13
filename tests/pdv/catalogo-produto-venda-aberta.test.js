/**
 * Produto cadastrado com PDV/venda em aberto deve entrar no catálogo na hora.
 * npm run test:pdv-catalogo-venda-aberta
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

describe('Catálogo PDV — produto novo com venda em aberto', () => {
  it('ERP publica o produto no save', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');
    assert.match(src, /CdsCatalogoProdutoSync\.publicarProdutoSalvo/);
  });

  it('PDV faz upsert sem limpar carrinho e recarrega no foco', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
    assert.match(src, /function upsertProdutoNoCatalogoPdv/);
    assert.match(src, /function recarregarCatalogoPdv/);
    assert.match(src, /function garantirProdutoNoCatalogoPdv/);
    assert.match(src, /visibilitychange/);
    assert.match(src, /CdsCatalogoProdutoSync\.ouvir/);
    assert.match(src, /await garantirProdutoNoCatalogoPdv/);
    assert.doesNotMatch(src, /carrinho\s*=\s*\[\s*\]\s*;[^\n]*recarregarCatalogoPdv/);
  });

  it('HTML ERP e PDV carregam o canal de sync', () => {
    const erp = fs.readFileSync(path.join(ROOT, 'frontend/erp/index.html'), 'utf8');
    const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/index.html'), 'utf8');
    assert.match(erp, /catalogoProdutoSync\.js/);
    assert.match(pdv, /catalogoProdutoSync\.js/);
  });

  it('backend invalida MIP, notifica MIB e expõe versão do catálogo', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/produtos.js'), 'utf8');
    assert.match(src, /function publicarProdutoNoCatalogoOperacional/);
    assert.match(src, /limparCacheCatalogo/);
    assert.match(src, /publicarProdutoNoCatalogoOperacional\(row\)/);
    assert.match(src, /router\.get\('\/catalogo-versao'/);
  });

  it('PDV consulta versão do catálogo e hidrata último SKU salvo', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
    assert.match(src, /function verificarVersaoCatalogoPdv/);
    assert.match(src, /produtos\/catalogo-versao/);
    assert.match(src, /hidratarUltimoProdutoCatalogoPdv/);
    assert.match(src, /consumirUltimoProdutoSalvo/);
  });

  it('helper publica e escuta produto-salvo', () => {
    const mensagens = [];
    global.BroadcastChannel = class {
      constructor() {
        this._h = [];
      }
      postMessage(data) {
        this._h.forEach((fn) => fn({ data }));
      }
      addEventListener(_ev, fn) {
        this._h.push(fn);
      }
      removeEventListener(_ev, fn) {
        this._h = this._h.filter((x) => x !== fn);
      }
    };
    const store = {};
    global.localStorage = {
      setItem(k, v) { store[k] = String(v); },
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      removeItem(k) { delete store[k]; }
    };
    global.addEventListener = () => {};
    global.removeEventListener = () => {};
    global.dispatchEvent = () => {};

    delete require.cache[require.resolve('../../frontend/shared/js/catalogoProdutoSync.js')];
    require('../../frontend/shared/js/catalogoProdutoSync.js');
    const Sync = global.CdsCatalogoProdutoSync;
    assert.ok(Sync);
    const off = Sync.ouvir((msg) => mensagens.push(msg));
    const ok = Sync.publicarProdutoSalvo({ id: 99, nome: 'Novo SKU', codigo: '99001' });
    assert.equal(ok, true);
    assert.equal(mensagens.length, 1);
    assert.equal(mensagens[0].tipo, 'produto-salvo');
    assert.equal(mensagens[0].produto.id, 99);
    const ultimo = Sync.consumirUltimoProdutoSalvo();
    assert.equal(ultimo.produto.id, 99);
    off();
  });
});
