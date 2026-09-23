/**
 * Sprint 6 — UI stability (navigation token + request context + search race)
 * node --test tests/frontend/sprint6-ui-stability.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const CORE = path.join(ROOT, 'frontend/shared/js/core');

function loadAllUi() {
  const sandbox = {
    console,
    Date,
    AbortController: global.AbortController,
    module: { exports: {} },
    exports: {},
    CDS_UI_DEBUG: false
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.self = sandbox;

  for (const name of [
    'PerformanceMonitor.js',
    'UIStateManager.js',
    'UINavigation.js',
    'UIRequestContext.js',
    'UIFocusManager.js',
    'UIPollingManager.js',
    'UISoftRefresh.js'
  ]) {
    const code = fs.readFileSync(path.join(CORE, name), 'utf8');
    vm.runInNewContext(code, sandbox, { filename: name });
  }
  return sandbox;
}

describe('Sprint 6 — infraestrutura UI', () => {
  let box;

  beforeEach(() => {
    box = loadAllUi();
    box.UINavigation._resetForTests();
    box.UIRequestContext._resetForTests();
    if (box.UIPollingManager && box.UIPollingManager._resetForTests) {
      box.UIPollingManager._resetForTests();
    }
  });

  it('arquivos da camada existem', () => {
    for (const f of [
      'PerformanceMonitor.js',
      'UIStateManager.js',
      'UINavigation.js',
      'UIRequestContext.js',
      'UIFocusManager.js',
      'UIPollingManager.js',
      'UISoftRefresh.js'
    ]) {
      assert.ok(fs.existsSync(path.join(CORE, f)));
    }
  });

  it('1-3. abre Clientes → Produtos; resposta Clientes é STALE', () => {
    const { UINavigation, UIRequestContext } = box;
    const t1 = UINavigation.enterPage('clientes');
    const req = UIRequestContext.begin({ page: 'clientes', page_token: t1 });
    const t2 = UINavigation.enterPage('produtos');
    assert.notEqual(t1, t2);
    assert.equal(UIRequestContext.isFresh(req.request_id), false);
    assert.equal(UIRequestContext.get(req.request_id).status, 'STALE');
    assert.equal(UINavigation.guard(t1), false);
    assert.equal(UINavigation.guard(t2), true);
  });

  it('4. busca A/B/C — somente C permanece fresh', () => {
    const { UINavigation, UIRequestContext } = box;
    UINavigation.enterPage('clientes');
    const a = UIRequestContext.begin({ search_key: 'busca-cliente', page: 'clientes' });
    const b = UIRequestContext.begin({ search_key: 'busca-cliente', page: 'clientes' });
    const c = UIRequestContext.begin({ search_key: 'busca-cliente', page: 'clientes' });
    assert.equal(UIRequestContext.isFresh(a.request_id), false);
    assert.equal(UIRequestContext.isFresh(b.request_id), false);
    assert.equal(UIRequestContext.isFresh(c.request_id), true);
  });

  it('página abandonada marca requests STALE', () => {
    const { UINavigation, UIRequestContext } = box;
    UINavigation.enterPage('central-entradas');
    const r = UIRequestContext.begin({ page: 'central-entradas' });
    UINavigation.leavePage('central-entradas');
    assert.equal(UIRequestContext.get(r.request_id).status, 'STALE');
  });
});
