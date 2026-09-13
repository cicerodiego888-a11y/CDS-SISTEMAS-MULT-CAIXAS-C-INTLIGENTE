/**
 * RC15.1 — Enviar Produtos para Balança (tela + rota)
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC15.1 — rota upload-plus', () => {
  it('registra POST /:id/upload-plus → PluController.uploadPlus', () => {
    const rotas = read('backend/rotas/equipamentos.js');
    assert.match(rotas, /upload-plus/);
    assert.match(rotas, /PluController\.uploadPlus/);
  });

  it('uploadPlus reutiliza ToledoPluEngine.uploadMany', () => {
    const src = read('backend/motores/equipamentos/drivers/toledo/plu/PluController.js');
    assert.match(src, /async function uploadPlus/);
    assert.match(src, /toledoPluEngine\.uploadMany/);
    assert.match(src, /carregarProdutosPorPlus/);
    assert.match(src, /UploadPluOperation|UPLOAD_PLU/);
    // não instancia driver direto
    assert.doesNotMatch(src, /new ToledoPrixIVDriver|require\(.*ToledoPrixIVDriver/);
  });
});

describe('RC15.1 — front', () => {
  it('página e menu existem', () => {
    const page = read('frontend/erp/js/enviar-produtos-balanca.js');
    assert.match(page, /loadEnviarProdutosBalanca/);
    assert.match(page, /upload-plus/);
    assert.match(page, /Enviar Selecionados/);
    assert.match(page, /epbLog/);

    const html = read('frontend/erp/index.html');
    assert.match(html, /enviar-produtos-balanca/);
    assert.match(html, /Enviar Produtos/);
    assert.match(html, /Toledo Prix IV/);

    const app = read('frontend/erp/js/app.js');
    assert.match(app, /enviar-produtos-balanca/);
    assert.match(app, /loadEnviarProdutosBalanca/);
  });
});

describe('RC15.2 — somente produtos pesáveis', () => {
  it('front filtra produto_fracionado / vendido_por_peso e badge Produtos Pesáveis', () => {
    const page = read('frontend/erp/js/enviar-produtos-balanca.js');
    assert.match(page, /epbEhPesavel|epbElegivelBalanca/);
    assert.match(page, /produto_fracionado|vendido_por_peso|produto_pesavel/);
    assert.match(page, /Produtos Pesáveis/);
    assert.match(page, /Selecione pelo menos um produto/);
  });

  it('upload-plus SQL restringe a produto_fracionado=1 e ativo', () => {
    const src = read('backend/motores/equipamentos/drivers/toledo/plu/PluController.js');
    assert.match(src, /produto_fracionado/);
    assert.match(src, /COALESCE\(p\.ativo,\s*1\)\s*=\s*1/);
  });
});
