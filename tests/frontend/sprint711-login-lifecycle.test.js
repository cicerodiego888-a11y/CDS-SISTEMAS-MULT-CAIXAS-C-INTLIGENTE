/**
 * Sprint 7.1.1 — lifecycle logout → login sem overlay residual.
 * node --test tests/frontend/sprint711-login-lifecycle.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const CORE = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/core.js'), 'utf8');
const LOGIN = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/login.js'), 'utf8');
const INTRO = fs.readFileSync(path.join(ROOT, 'frontend/shared/intro/intro.js'), 'utf8');
const LX = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/login-experience.js'), 'utf8');
const ACCESS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/access-control.js'), 'utf8');
const PRODUTOS = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');

describe('Sprint 7.1.1 — logout entrega login interativo', () => {
  it('logout não navega no mesmo tick do confirm nativo', () => {
    const fn = CORE.slice(CORE.indexOf('function logout()'));
    assert.match(fn, /irParaLoginAposSaida\('logout'\)/);
    assert.match(CORE, /function urlLoginAposSaida/);
    assert.match(CORE, /from['\"]?\s*,\s*motivo/);
    assert.match(CORE, /requestAnimationFrame/);
    assert.equal(/window\.location\.href\s*=\s*['\"]\/login['\"]/.test(fn.slice(0, 500)), false);
  });

  it('sessão expirada também marca from=sessao', () => {
    assert.match(CORE, /irParaLoginAposSaida\('sessao'\)/);
    assert.match(ACCESS, /from=sessao|irParaLoginAposSaida\('sessao'\)/);
  });

  it('intro não monta overlay após logout/sessão', () => {
    assert.match(INTRO, /devePularIntro/);
    assert.match(INTRO, /from === 'logout'/);
    assert.match(INTRO, /removerOverlayIntro/);
    assert.match(INTRO, /removeChild\(root\)/);
  });

  it('login libera overlay, loading e foco só depois da tela pronta', () => {
    assert.match(LOGIN, /function liberarTelaLogin/);
    assert.match(LOGIN, /function removerOverlayResidualLogin/);
    assert.match(LOGIN, /cdsIntroRoot/);
    assert.match(LOGIN, /loginBootSplash/);
    assert.match(LOGIN, /setBotaoLoading\(false\)/);
    assert.match(LOGIN, /requestAnimationFrame/);
    assert.equal(LOGIN.includes("$('*').css('pointer-events'"), false);
    assert.equal(/setTimeout\(\s*\(\)\s*=>\s*.*focus\(\).*1000/.test(LOGIN), false);
  });

  it('login-experience não espera 2s após logout', () => {
    assert.match(LX, /veioDeSaidaSessao/);
    assert.match(LX, /iniciarIntroLogin\(\)/);
    assert.match(LX, /intro-done/);
  });
});

describe('Sprint 7.1.1 — não regressa a Sprint 7.1', () => {
  it('reuso de catálogo, update local e debounce 180 permanecem', () => {
    assert.match(PRODUTOS, /catalogoProdutosSessaoValido/);
    assert.match(PRODUTOS, /aplicarAtualizacaoLocalCatalogoProdutos/);
    assert.match(PRODUTOS, /__cdsProdutosArvoreCache/);
    assert.match(PRODUTOS, /UISoftRefresh\.replaceHtml/);
    assert.match(PRODUTOS, /debounceOperacionalMs:\s*180/);
  });
});
