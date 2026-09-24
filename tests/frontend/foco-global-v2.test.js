/**
 * Foco Global V2 — infraestrutura + proteções das 6 telas críticas.
 * node --test tests/frontend/foco-global-v2.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const CORE = path.join(ROOT, 'frontend/shared/js/core');

function makeEl(tag, attrs = {}) {
  const children = [];
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    id: attrs.id || '',
    name: attrs.name || '',
    className: attrs.className || '',
    type: attrs.type || (tag === 'input' ? 'text' : ''),
    value: attrs.value != null ? String(attrs.value) : '',
    isContentEditable: !!attrs.contentEditable,
    dataset: Object.assign({}, attrs.dataset || {}),
    attributes: {},
    parentElement: null,
    children,
    selectionStart: 0,
    selectionEnd: 0,
    scrollTop: 0,
    scrollLeft: 0,
    tabIndex: 0,
    classList: {
      _set: new Set(String(attrs.className || '').split(/\s+/).filter(Boolean)),
      contains(c) { return this._set.has(c); },
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); }
    },
    getAttribute(name) {
      if (name === 'id') return this.id || null;
      if (name === 'name') return this.name || null;
      if (name === 'class') return this.className || null;
      if (name === 'data-index') return this.dataset.index || null;
      if (name === 'data-id') return this.dataset.id || null;
      if (name === 'data-focus-id') return this.dataset.focusId || null;
      return this.attributes[name] != null ? this.attributes[name] : null;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'id') this.id = String(value);
      if (name === 'name') this.name = String(value);
    },
    contains(other) {
      if (!other) return false;
      if (other === this) return true;
      let n = other;
      while (n) {
        if (n === this) return true;
        n = n.parentElement;
      }
      return false;
    },
    appendChild(child) {
      child.parentElement = this;
      children.push(child);
      return child;
    },
    querySelector(sel) {
      return queryIn(this, sel);
    },
    querySelectorAll(sel) {
      const out = [];
      walk(this, (node) => {
        if (matches(node, sel)) out.push(node);
      });
      return out;
    },
    focus() {
      documentActive = this;
    },
    blur() {
      if (documentActive === this) documentActive = documentBody;
    },
    setSelectionRange(a, b) {
      this.selectionStart = a;
      this.selectionEnd = b;
    }
  };
  if (attrs['data-index'] != null) el.dataset.index = String(attrs['data-index']);
  return el;
}

let documentActive = null;
let documentBody = null;
let documentRoot = null;

function walk(node, fn) {
  fn(node);
  for (const c of node.children || []) walk(c, fn);
}

function matches(node, sel) {
  if (!sel || !node || node.nodeType !== 1) return false;
  if (sel.startsWith('#')) return node.id === sel.slice(1);
  const dataMatch = sel.match(/^\.([a-zA-Z0-9_-]+)\[data-index="([^"]+)"\]$/);
  if (dataMatch) {
    return node.classList.contains(dataMatch[1])
      && String(node.dataset.index || '') === dataMatch[2];
  }
  if (sel === '.modal.show') {
    return node.classList.contains('modal') && node.classList.contains('show');
  }
  if (sel.includes('[')) return false;
  if (sel.startsWith('.')) return node.classList.contains(sel.slice(1));
  return String(node.tagName || '').toLowerCase() === sel.toLowerCase();
}

function queryIn(root, sel) {
  let found = null;
  walk(root, (node) => {
    if (!found && matches(node, sel)) found = node;
  });
  return found;
}

function createDomSandbox() {
  documentBody = makeEl('body');
  documentRoot = makeEl('html');
  documentRoot.appendChild(documentBody);
  documentActive = documentBody;

  const sandbox = {
    console,
    Date,
    AbortController: global.AbortController,
    module: { exports: {} },
    exports: {},
    CDS_UI_DEBUG: false,
    CSS: { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
    setInterval: global.setInterval.bind(global),
    clearInterval: global.clearInterval.bind(global),
    setTimeout: global.setTimeout.bind(global),
    clearTimeout: global.clearTimeout.bind(global),
    performance: { now: () => Date.now() },
    document: {
      body: documentBody,
      documentElement: documentRoot,
      get activeElement() { return documentActive; },
      getElementById(id) {
        return queryIn(documentRoot, `#${id}`);
      },
      querySelector(sel) {
        return queryIn(documentRoot, sel);
      },
      querySelectorAll(sel) {
        const out = [];
        walk(documentRoot, (n) => { if (matches(n, sel)) out.push(n); });
        return out;
      },
      createElement(tag) {
        return makeEl(tag);
      }
    },
    window: null,
    scrollY: 0,
    scrollX: 0,
    scrollTo() {}
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.self = sandbox;
  return sandbox;
}

function loadAllUi(sandbox) {
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

describe('Foco Global V2 — infraestrutura', () => {
  let box;

  beforeEach(() => {
    box = loadAllUi(createDomSandbox());
    box.UINavigation._resetForTests();
    box.UIRequestContext._resetForTests();
    if (box.UIPollingManager._resetForTests) box.UIPollingManager._resetForTests();
  });

  it('1. captureFocusState captura id, caret e page_token', () => {
    box.UINavigation.enterPage('faturamento');
    const input = makeEl('input', { id: 'cfBusca', value: '12345' });
    input.selectionStart = 3;
    input.selectionEnd = 3;
    documentBody.appendChild(input);
    input.focus();

    const state = box.UIFocusManager.captureFocusState(documentBody);
    assert.equal(state.editing, true);
    assert.equal(state.focusSelector, '#cfBusca');
    assert.equal(state.value, '12345');
    assert.equal(state.selectionStart, 3);
    assert.ok(state.page_token);
  });

  it('2. isEditingElement distingue input editável de botão', () => {
    const input = makeEl('input', { id: 'username', type: 'text' });
    const btn = makeEl('input', { id: 'btn-entrar', type: 'button' });
    const button = makeEl('button', { id: 'ok' });
    assert.equal(box.UIFocusManager.isEditingElement(input), true);
    assert.equal(box.UIFocusManager.isEditingElement(btn), false);
    assert.equal(box.UIFocusManager.isEditingElement(button), false);
    assert.equal(box.UIFocusManager.isEditableNode(makeEl('textarea')), true);
    assert.equal(box.UIFocusManager.isEditableNode(makeEl('select')), true);
  });

  it('3. restoreFocusState restaura caret após remount', () => {
    box.UINavigation.enterPage('produtos');
    const input = makeEl('input', { id: 'buscaProduto', value: 'abc' });
    input.selectionStart = 2;
    input.selectionEnd = 2;
    documentBody.appendChild(input);
    input.focus();
    const snap = box.UIFocusManager.captureFocusState(documentBody);

    documentBody.children.length = 0;
    documentActive = documentBody;
    const novo = makeEl('input', { id: 'buscaProduto', value: 'xyz' });
    documentBody.appendChild(novo);

    const ok = box.UIFocusManager.restoreFocusState(snap, { restoreValue: true });
    assert.equal(ok, true);
    assert.equal(documentActive, novo);
    assert.equal(novo.value, 'abc');
    assert.equal(novo.selectionStart, 2);
  });

  it('4. elemento recriado via seletor estável data-index', () => {
    box.UINavigation.enterPage('pdv');
    const qtd = makeEl('input', {
      className: 'quantidade-item',
      'data-index': '1',
      value: '2'
    });
    qtd.dataset.index = '1';
    qtd.selectionStart = 1;
    qtd.selectionEnd = 1;
    documentBody.appendChild(qtd);
    qtd.focus();
    const snap = box.UIFocusManager.captureFocusState(documentBody);
    assert.match(snap.focusSelector || '', /quantidade-item/);

    documentBody.children.length = 0;
    documentActive = documentBody;
    const novo = makeEl('input', { className: 'quantidade-item', value: '9' });
    novo.dataset.index = '1';
    documentBody.appendChild(novo);

    box.UIFocusManager.restoreFocusState(snap, { restoreValue: false });
    assert.equal(documentActive, novo);
    assert.equal(novo.value, '9');
  });

  it('5. shouldPreserveFocus / softRefresh não destrói enquanto edita', () => {
    const wrap = makeEl('div', { id: 'cfFiltros' });
    const busca = makeEl('input', { id: 'cfBusca', value: '12' });
    wrap.appendChild(busca);
    documentBody.appendChild(wrap);
    busca.focus();

    assert.equal(box.UIFocusManager.shouldPreserveFocus(wrap), true);
    const applied = box.UISoftRefresh.replaceHtml(wrap, '<span>x</span>', { skipIfEditing: true });
    assert.equal(applied, false);
    assert.equal(documentBody.querySelector('#cfBusca'), busca);
  });

  it('6. página stale — restore não aplica', () => {
    const t1 = box.UINavigation.enterPage('clientes');
    const input = makeEl('input', { id: 'buscaCliente', value: 'a' });
    documentBody.appendChild(input);
    input.focus();
    const snap = box.UIFocusManager.captureFocusState(documentBody);
    assert.equal(snap.page_token, t1);

    box.UINavigation.enterPage('produtos');
    documentBody.children.length = 0;
    documentBody.appendChild(makeEl('input', { id: 'buscaCliente', value: '' }));
    assert.equal(box.UIFocusManager.restoreFocusState(snap), false);
  });

  it('7. callback stale — isFresh false após leavePage', () => {
    box.UINavigation.enterPage('clientes');
    const ctx = box.UIRequestContext.begin({ page: 'clientes', component: 'lista' });
    box.UINavigation.leavePage('clientes');
    assert.equal(box.UIRequestContext.isFresh(ctx.request_id), false);
  });

  it('8. polling encerrado ao sair da página', () => {
    let ticks = 0;
    box.UINavigation.enterPage('central-faturamento');
    box.UIPollingManager.start({
      id: 'central-faturamento-refresh',
      page: 'central-faturamento',
      interval: 500,
      fn: () => { ticks += 1; }
    });
    assert.equal(box.UIPollingManager.list().length, 1);
    box.UINavigation.leavePage('central-faturamento');
    assert.equal(box.UIPollingManager.list().length, 0);
    assert.equal(ticks, 0);
  });

  it('9. withPreservedFocus não transfere foco para botão', () => {
    const wrap = makeEl('div', { id: 'login' });
    const user = makeEl('input', { id: 'username', value: 'a' });
    const btn = makeEl('button', { id: 'btn-entrar' });
    wrap.appendChild(user);
    wrap.appendChild(btn);
    documentBody.appendChild(wrap);
    user.focus();

    box.UIFocusManager.withPreservedFocus(wrap, () => {
      documentBody.children.length = 0;
      const novoWrap = makeEl('div', { id: 'login' });
      const novoUser = makeEl('input', { id: 'username', value: '' });
      const novoBtn = makeEl('button', { id: 'btn-entrar' });
      novoWrap.appendChild(novoUser);
      novoWrap.appendChild(novoBtn);
      documentBody.appendChild(novoWrap);
      novoBtn.focus();
    }, { restoreValue: true });

    assert.equal(documentActive && documentActive.id, 'username');
  });

  it('10. modal aberto — softRefresh não destrói container com modal', () => {
    const wrap = makeEl('div', { id: 'pdv' });
    const modal = makeEl('div', { className: 'modal show' });
    wrap.appendChild(modal);
    documentBody.appendChild(wrap);
    const ok = box.UISoftRefresh.replaceHtml(wrap, '<p>gone</p>');
    assert.equal(ok, false);
    assert.ok(wrap.querySelector('.modal.show'));
  });
});

describe('Foco Global V2 — integração estática nas 6 telas', () => {
  const files = {
    login: path.join(ROOT, 'frontend/shared/js/login.js'),
    faturamento: path.join(ROOT, 'frontend/erp/js/central-faturamento.js'),
    pdv: path.join(ROOT, 'frontend/pdv/js/pdv.js'),
    caixa: path.join(ROOT, 'frontend/erp/js/caixa.js'),
    fechamento: path.join(ROOT, 'frontend/shared/js/fechamentoCaixaV2Ui.js'),
    produtos: path.join(ROOT, 'frontend/erp/js/produtos.js'),
    clientes: path.join(ROOT, 'frontend/erp/js/clientes.js')
  };

  it('Login bloqueia focus automático após interação', () => {
    const src = fs.readFileSync(files.login, 'utf8');
    assert.match(src, /loginUsuarioInteragiu/);
    assert.match(src, /focarCampoLoginPronto/);
    assert.match(src, /removerOverlayResidualLogin/);
    assert.match(src, /if \(loginUsuarioInteragiu\) return/);
  });

  it('Faturamento usa SoftRefresh + PollingManager', () => {
    const src = fs.readFileSync(files.faturamento, 'utf8');
    assert.match(src, /UISoftRefresh/);
    assert.match(src, /skipIfEditing/);
    assert.match(src, /UIPollingManager/);
    assert.match(src, /UIRequestContext/);
    assert.match(src, /central-faturamento-refresh/);
  });

  it('PDV preserva foco no carrinho e não força busca durante edição', () => {
    const src = fs.readFileSync(files.pdv, 'utf8');
    assert.match(src, /withPreservedFocus/);
    assert.match(src, /quantidade-item/);
    assert.match(src, /isEditingElement\(ativo\)/);
  });

  it('Caixa/Fechamento não sobrescreve campo monetário em edição', () => {
    const caixa = fs.readFileSync(files.caixa, 'utf8');
    const fech = fs.readFileSync(files.fechamento, 'utf8');
    assert.match(caixa, /userTouched|digitaram/);
    assert.match(fech, /isEditing\(el\)/);
    assert.match(fech, /atualizarValoresResumo/);
  });

  it('Produtos soft-list-refresh e Clientes soft tbody', () => {
    const prod = fs.readFileSync(files.produtos, 'utf8');
    const cli = fs.readFileSync(files.clientes, 'utf8');
    assert.match(prod, /atualizarListagemProdutosSemRemontarShell/);
    assert.match(prod, /shellListagemProdutosMontado/);
    assert.match(cli, /clientes-tbody/);
    assert.match(cli, /UIRequestContext/);
    assert.match(cli, /buscaExistente && tbodyExistente/);
  });
});
