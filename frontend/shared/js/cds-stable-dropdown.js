/**
 * CDS Stable Dropdown — lista suspensa controlada (sem <select> nativo na UI).
 * Fecha somente por: seleção, ESC, clique fora, abertura de outro dropdown.
 */
(function cdsStableDropdown(global) {
  'use strict';

  if (global.CdsStableDropdown) return;

  const CLOSE = Object.freeze({
    SELECT: 'select',
    ESCAPE: 'escape',
    OUTSIDE: 'outside',
    OTHER: 'other-open'
  });

  const instances = new Map();
  let docBound = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readOptions(select) {
    return Array.from(select.options || []).map((opt) => ({
      value: String(opt.value == null ? '' : opt.value),
      label: String(opt.textContent || opt.label || '').trim() || String(opt.value || '')
    }));
  }

  function labelForValue(options, value) {
    const found = options.find((o) => o.value === String(value || ''));
    if (found && found.label) return found.label;
    if (options[0]) return options[0].label;
    return 'Selecione';
  }

  function bindDocumentOnce(doc) {
    if (!doc || docBound) return;
    docBound = true;
    doc.addEventListener('click', (e) => {
      instances.forEach((inst) => {
        if (!inst.state.open) return;
        if (inst.root.contains(e.target)) return;
        inst.close(CLOSE.OUTSIDE);
      });
    });
  }

  function closeAllExcept(keep) {
    instances.forEach((inst) => {
      if (inst !== keep && inst.state.open) inst.close(CLOSE.OTHER);
    });
  }

  function mount(select, opts) {
    if (!select) return null;
    const existing = instances.get(select);
    if (existing) {
      existing.refresh();
      return existing;
    }

    const doc = select.ownerDocument || global.document;
    bindDocumentOnce(doc);

    const root = doc.createElement('div');
    root.className = 'cds-stable-dd';
    root.setAttribute('data-open', 'false');

    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'cds-stable-dd__toggle form-control';
    toggle.setAttribute('aria-haspopup', 'listbox');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = `<span class="cds-stable-dd__label"></span><span class="cds-stable-dd__caret" aria-hidden="true">▼</span>`;

    const list = doc.createElement('ul');
    list.className = 'cds-stable-dd__list';
    list.hidden = true;
    list.setAttribute('role', 'listbox');

    root.appendChild(toggle);
    root.appendChild(list);

    select.classList.add('cds-stable-dd__native');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;

    const parent = select.parentNode;
    if (parent) parent.insertBefore(root, select);
    root.appendChild(select);

    const state = {
      open: false,
      value: String(select.value || ''),
      highlightedIndex: -1
    };

    const inst = {
      select,
      root,
      toggle,
      list,
      state,
      refresh,
      open,
      close,
      destroy
    };

    function syncLabel() {
      const options = readOptions(select);
      const labelEl = toggle.querySelector('.cds-stable-dd__label');
      state.value = String(select.value || '');
      if (labelEl) labelEl.textContent = labelForValue(options, state.value);
    }

    function renderList() {
      const options = readOptions(select);
      const current = String(select.value || '');
      list.innerHTML = options.map((opt, index) => {
        const selected = opt.value === current;
        const active = index === state.highlightedIndex;
        const cls = ['cds-stable-dd__option'];
        if (selected) cls.push('is-selected');
        if (active) cls.push('is-active');
        return `<li class="${cls.join(' ')}" role="option" data-index="${index}" data-value="${escapeHtml(opt.value)}" aria-selected="${selected ? 'true' : 'false'}">${escapeHtml(opt.label)}</li>`;
      }).join('');
    }

    function highlight(index) {
      const options = readOptions(select);
      if (!options.length) {
        state.highlightedIndex = -1;
        return;
      }
      state.highlightedIndex = Math.max(0, Math.min(index, options.length - 1));
      list.querySelectorAll('.cds-stable-dd__option').forEach((el, i) => {
        el.classList.toggle('is-active', i === state.highlightedIndex);
      });
      const active = list.querySelector('.cds-stable-dd__option.is-active');
      if (active && typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ block: 'nearest' });
      }
    }

    function open() {
      if (state.open) return;
      closeAllExcept(inst);
      state.open = true;
      root.setAttribute('data-open', 'true');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.querySelector('.cds-stable-dd__caret').textContent = '▲';
      list.hidden = false;
      const options = readOptions(select);
      const current = String(select.value || '');
      const idx = options.findIndex((o) => o.value === current);
      state.highlightedIndex = idx >= 0 ? idx : 0;
      renderList();
      highlight(state.highlightedIndex);
    }

    function close(reason) {
      if (!state.open) return;
      state.open = false;
      root.setAttribute('data-open', 'false');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.querySelector('.cds-stable-dd__caret').textContent = '▼';
      list.hidden = true;
      void reason;
    }

    function selectIndex(index) {
      const options = readOptions(select);
      const opt = options[index];
      if (!opt) return;
      const next = String(opt.value);
      const prev = String(select.value || '');
      select.value = next;
      state.value = next;
      syncLabel();
      renderList();
      close(CLOSE.SELECT);
      if (next !== prev) {
        if (global.jQuery) {
          global.jQuery(select).trigger('change');
        } else if (typeof Event === 'function' && typeof select.dispatchEvent === 'function') {
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }

    function refresh() {
      const keepOpen = state.open;
      const hi = state.highlightedIndex;
      syncLabel();
      if (keepOpen) {
        renderList();
        highlight(hi);
      }
    }

    function destroy() {
      close(CLOSE.OTHER);
      instances.delete(select);
      if (root.parentNode) {
        root.parentNode.insertBefore(select, root);
        root.parentNode.removeChild(root);
      }
      select.classList.remove('cds-stable-dd__native');
    }

    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (state.open) close(CLOSE.OUTSIDE);
      else open();
    });

    toggle.addEventListener('keydown', (e) => {
      const key = e.key;
      if (key === 'ArrowDown') {
        e.preventDefault();
        if (!state.open) open();
        else highlight(state.highlightedIndex + 1);
      } else if (key === 'ArrowUp') {
        e.preventDefault();
        if (!state.open) open();
        else highlight(state.highlightedIndex - 1);
      } else if (key === 'Home') {
        e.preventDefault();
        if (!state.open) open();
        highlight(0);
      } else if (key === 'End') {
        e.preventDefault();
        if (!state.open) open();
        highlight(readOptions(select).length - 1);
      } else if (key === 'Enter' || key === ' ') {
        e.preventDefault();
        if (!state.open) open();
        else selectIndex(state.highlightedIndex);
      } else if (key === 'Escape') {
        e.preventDefault();
        close(CLOSE.ESCAPE);
      }
    });

    list.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    list.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const item = e.target.closest('.cds-stable-dd__option');
      if (!item) return;
      selectIndex(Number(item.getAttribute('data-index')));
    });

    list.addEventListener('mousemove', (e) => {
      const item = e.target.closest('.cds-stable-dd__option');
      if (!item) return;
      highlight(Number(item.getAttribute('data-index')));
    });

    instances.set(select, inst);
    syncLabel();
    return inst;
  }

  function refresh(select) {
    const inst = select && instances.get(select);
    if (inst) inst.refresh();
    return inst || null;
  }

  function isOpen(select) {
    const inst = select && instances.get(select);
    return !!(inst && inst.state.open);
  }

  const api = {
    CLOSE,
    mount,
    refresh,
    isOpen,
    readOptions,
    labelForValue
  };

  global.CdsStableDropdown = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : global);
