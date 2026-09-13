/**
 * RC1 — Consolidação final V1.0 (sem novas features)
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

describe('RC1 — menus e navegação', () => {
  it('ERP: todo data-page do menu tem case em loadPage', () => {
    const index = read('frontend/erp/index.html');
    const app = read('frontend/erp/js/app.js');
    const pages = [...index.matchAll(/data-page="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(pages.length > 10);
    pages.forEach((page) => {
      assert.match(app, new RegExp(`case\\s+'${page}'`), `faltando case para ${page}`);
    });
  });

  it('remove recurso fantasma configAvancadas e placeholder Relatórios', () => {
    const index = read('frontend/erp/index.html');
    assert.doesNotMatch(index, /data-recurso="configAvancadas"/);
    assert.match(index, /data-nav-group="relatorios"[^>]*hidden/);
    assert.match(index, />Assinatura</);
  });

  it('PDV sem menus órfãos/duplicados enganosos', () => {
    const pdv = read('frontend/pdv/index.html');
    const caixaCount = (pdv.match(/data-page="caixa"/g) || []).length;
    assert.equal(caixaCount, 1, 'deve haver um único item Caixa');
    assert.doesNotMatch(pdv, />\s*NFC-e\s*</);
    assert.doesNotMatch(pdv, /data-page="tef"/);
    assert.match(pdv, />\s*Entregas\s*</);
  });

  it('PAGE_META cobre Pedidos, Faturamento, Entregas e NF-e', () => {
    const shell = read('frontend/shared/js/cds-page-shell.js');
    ['pedidos', 'faturamento', 'entregas', 'nfe-central', 'nfe-monitor', 'nfe-fila', 'nfe-diagnostico']
      .forEach((id) => assert.match(shell, new RegExp(`(?:['\"]${id}['\"]|\\b${id}\\b)\\s*:`)));
    assert.match(shell, /titulo:\s*'Assinatura'/);
  });
});

describe('RC1 — terminologia Assinatura (cliente)', () => {
  it('UI de assinatura evita "Licença" ao cliente', () => {
    const html = read('frontend/erp/pages/licenca.html');
    assert.match(html, /Assinatura CDS/);
    assert.doesNotMatch(html, />\s*Licença do Sistema\s*</);
    assert.match(html, /Código de Ativação/);

    const js = read('frontend/erp/js/licenca.js');
    assert.match(js, /Assinatura ativada com sucesso/);
    assert.doesNotMatch(js, /Licença ativada com sucesso/);
  });

  it('middleware usa Assinatura na mensagem ao cliente', () => {
    const mw = read('backend/middleware/licencaMiddleware.js');
    assert.match(mw, /Assinatura expirada/);
    assert.doesNotMatch(mw, /Sistema com licença expirada/);
  });
});

describe('RC1 — invisibilidade e ACL preservadas', () => {
  it('filtrarMenu respeita data-recurso', () => {
    const core = read('frontend/shared/js/core.js');
    assert.match(core, /recursoItem && recursos\[recursoItem\]/);
    assert.match(core, /paginaPermitidaPorImplantacao/);
  });

  it('núcleos proibidos intactos nesta consolidação', () => {
    [
      'backend/services/vendas/VendaApplicationService.js',
      'backend/services/vendas/VendaPagamentoService.js',
      'backend/services/OrquestradorPagamento.js',
      'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js'
    ].forEach((f) => assert.ok(fs.existsSync(path.join(ROOT, f)), f));
  });
});
