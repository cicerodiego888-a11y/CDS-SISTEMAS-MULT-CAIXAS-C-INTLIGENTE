/**
 * CDS SmartSelect — componente reutilizável de pesquisa + criação rápida.
 * Primeira implementação: Marca (UX/INFRA 05).
 *
 * Uso:
 *   CdsSmartSelect.mount({
 *     container: '#host',
 *     hiddenInput: '#marca_id',
 *     placeholder: 'Buscar ou criar marca...',
 *     allowClear: true,
 *     fetchItems: async (query) => [{ id, label }],
 *     createItem: async (label) => ({ id, label }),
 *     initialItem: { id, label } | null
 *   });
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    placeholder: 'Buscar...',
    allowClear: true,
    clearLabel: 'Limpar seleção',
    emptyHint: 'Digite para pesquisar',
    createPrefix: 'Criar',
    debounceMs: 180,
    minCharsCreate: 1,
    minCharsSuggest: 1,
    maxSuggestions: 12,
    noResultsLabel: 'Nenhum resultado',
    deleteTitle: 'Excluir',
    confirmDeleteMessage: (item) => `Excluir "${item.label}"? Essa marca sai da lista, mas produtos já vinculados permanecem.`
  };

  function debounce(fn, wait) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeLabel(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function mount(options = {}) {
    const opts = { ...DEFAULTS, ...options };
    const container = typeof opts.container === 'string'
      ? document.querySelector(opts.container)
      : opts.container;
    if (!container) {
      throw new Error('CdsSmartSelect: container não encontrado');
    }

    const hiddenInput = typeof opts.hiddenInput === 'string'
      ? document.querySelector(opts.hiddenInput)
      : opts.hiddenInput;

    container.innerHTML = `
      <div class="cds-smart-select" data-open="false">
        <div class="cds-smart-select__control">
          <input
            type="text"
            class="form-control cds-smart-select__input"
            ${opts.inputId ? `id="${escapeHtml(opts.inputId)}"` : ''}
            placeholder="${escapeHtml(opts.placeholder)}"
            autocomplete="off"
            spellcheck="false"
          >
          <button type="button" class="cds-smart-select__clear" title="${escapeHtml(opts.clearLabel)}" hidden>&times;</button>
        </div>
        <div class="cds-smart-select__dropdown" hidden role="listbox"></div>
      </div>
    `;

    const root = container.querySelector('.cds-smart-select');
    const input = root.querySelector('.cds-smart-select__input');
    const dropdown = root.querySelector('.cds-smart-select__dropdown');
    const clearBtn = root.querySelector('.cds-smart-select__clear');

    let selected = opts.initialItem && opts.initialItem.id != null
      ? { id: opts.initialItem.id, label: opts.initialItem.label || String(opts.initialItem.id) }
      : null;
    let items = [];
    let highlightIndex = -1;
    let creating = false;
    let fetchSeq = 0;

    function setHidden(value) {
      if (hiddenInput) {
        hiddenInput.value = value == null || value === '' ? '' : String(value);
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    function syncSelectedUi() {
      if (selected) {
        input.value = selected.label;
        setHidden(selected.id);
        clearBtn.hidden = !opts.allowClear;
      } else {
        if (document.activeElement !== input) {
          input.value = '';
        }
        setHidden('');
        clearBtn.hidden = true;
      }
    }

    function closeDropdown() {
      dropdown.hidden = true;
      root.setAttribute('data-open', 'false');
      highlightIndex = -1;
    }

    function openDropdown() {
      dropdown.hidden = false;
      root.setAttribute('data-open', 'true');
    }

    function renderDropdown(query) {
      const q = normalizeLabel(query);
      const exactMatch = items.some(
        (item) => normalizeLabel(item.label).toLocaleLowerCase('pt-BR') === q.toLocaleLowerCase('pt-BR')
      );

      let html = '';
      if (!items.length && !q) {
        html = `<div class="cds-smart-select__hint">${escapeHtml(opts.emptyHint)}</div>`;
      }

      items.slice(0, opts.maxSuggestions).forEach((item, index) => {
        const podeExcluir = typeof opts.deleteItem === 'function';
        html += `
          <div class="cds-smart-select__row">
            <button type="button" class="cds-smart-select__option" data-index="${index}" data-id="${escapeHtml(item.id)}" role="option">
              ${escapeHtml(item.label)}
            </button>
            ${podeExcluir ? `
              <button type="button" class="cds-smart-select__option-delete" data-delete-id="${escapeHtml(item.id)}" title="${escapeHtml(opts.deleteTitle)}" aria-label="${escapeHtml(opts.deleteTitle)} ${escapeHtml(item.label)}">
                &times;
              </button>
            ` : ''}
          </div>
        `;
      });

      if (q.length >= opts.minCharsCreate && !exactMatch) {
        html += `
          <button type="button" class="cds-smart-select__option cds-smart-select__option--create" data-create="1" role="option">
            <span class="cds-smart-select__create-icon">➕</span>
            ${escapeHtml(opts.createPrefix)} "${escapeHtml(q)}"
          </button>
        `;
      } else if (!items.length && q) {
        html += `<div class="cds-smart-select__hint">${escapeHtml(opts.noResultsLabel)}</div>`;
      }

      dropdown.innerHTML = html || `<div class="cds-smart-select__hint">${escapeHtml(opts.noResultsLabel)}</div>`;
      openDropdown();
      highlightIndex = -1;
    }

    function queryProntoParaLista(rawQuery) {
      return normalizeLabel(rawQuery).length >= Number(opts.minCharsSuggest || 1);
    }

    async function refreshSuggestions(rawQuery) {
      const query = normalizeLabel(rawQuery);
      if (!queryProntoParaLista(query)) {
        fetchSeq += 1;
        items = [];
        closeDropdown();
        return;
      }
      const seq = ++fetchSeq;
      try {
        const result = await opts.fetchItems(query);
        if (seq !== fetchSeq) return;
        items = Array.isArray(result) ? result.map((row) => ({
          id: row.id,
          label: row.label != null ? String(row.label) : String(row.nome || row.name || row.id)
        })) : [];
        renderDropdown(query);
      } catch (err) {
        if (seq !== fetchSeq) return;
        console.error('[CdsSmartSelect] fetchItems:', err);
        items = [];
        dropdown.innerHTML = `<div class="cds-smart-select__hint">Erro ao carregar sugestões</div>`;
        openDropdown();
      }
    }

    const refreshDebounced = debounce((value) => {
      refreshSuggestions(value);
    }, opts.debounceMs);

    async function selectItem(item) {
      selected = { id: item.id, label: item.label };
      syncSelectedUi();
      closeDropdown();
      if (typeof opts.onChange === 'function') {
        opts.onChange(selected);
      }
    }

    async function createFromQuery(rawQuery) {
      if (creating) return;
      const label = normalizeLabel(rawQuery);
      if (!label) return;
      creating = true;
      try {
        const created = await opts.createItem(label);
        if (!created || created.id == null) {
          throw new Error('createItem não retornou id');
        }
        await selectItem({
          id: created.id,
          label: created.label != null ? String(created.label) : label
        });
        if (typeof opts.onCreated === 'function') {
          opts.onCreated(selected);
        }
      } catch (err) {
        console.error('[CdsSmartSelect] createItem:', err);
        if (typeof opts.onError === 'function') {
          opts.onError(err);
        }
      } finally {
        creating = false;
      }
    }

    async function removeItem(item) {
      if (!item || typeof opts.deleteItem !== 'function') return;
      const mensagem = typeof opts.confirmDeleteMessage === 'function'
        ? opts.confirmDeleteMessage(item)
        : `Excluir "${item.label}"?`;
      if (!window.confirm(mensagem)) return;
      try {
        await opts.deleteItem(item);
        items = items.filter((row) => String(row.id) !== String(item.id));
        if (selected && String(selected.id) === String(item.id)) {
          selected = null;
          input.value = '';
          syncSelectedUi();
          if (typeof opts.onChange === 'function') {
            opts.onChange(null);
          }
        }
        renderDropdown(input.value);
        if (typeof opts.onDeleted === 'function') {
          opts.onDeleted(item);
        }
      } catch (err) {
        console.error('[CdsSmartSelect] deleteItem:', err);
        if (typeof opts.onError === 'function') {
          opts.onError(err);
        }
      }
    }

    function clearSelection() {
      selected = null;
      input.value = '';
      syncSelectedUi();
      closeDropdown();
      if (typeof opts.onChange === 'function') {
        opts.onChange(null);
      }
      input.focus();
    }

    input.addEventListener('focus', () => {
      // Lista só aparece depois que o usuário começar a digitar
      if (selected) return;
      if (queryProntoParaLista(input.value)) {
        refreshSuggestions(input.value);
      } else {
        closeDropdown();
      }
    });

    input.addEventListener('input', () => {
      selected = null;
      setHidden('');
      clearBtn.hidden = true;
      refreshDebounced(input.value);
    });

    input.addEventListener('keydown', (e) => {
      const options = Array.from(dropdown.querySelectorAll('.cds-smart-select__option'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (dropdown.hidden && queryProntoParaLista(input.value)) refreshSuggestions(input.value);
        highlightIndex = Math.min(highlightIndex + 1, options.length - 1);
        options.forEach((el, i) => el.classList.toggle('is-active', i === highlightIndex));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightIndex = Math.max(highlightIndex - 1, 0);
        options.forEach((el, i) => el.classList.toggle('is-active', i === highlightIndex));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const active = options[highlightIndex] || options.find((el) => el.dataset.create === '1');
        if (active) active.click();
      } else if (e.key === 'Escape') {
        closeDropdown();
        if (selected) input.value = selected.label;
      }
    });

    dropdown.addEventListener('mousedown', (e) => {
      // evita blur antes do click
      e.preventDefault();
    });

    dropdown.addEventListener('click', (e) => {
      const del = e.target.closest('.cds-smart-select__option-delete');
      if (del) {
        e.preventDefault();
        e.stopPropagation();
        const id = del.getAttribute('data-delete-id');
        const item = items.find((row) => String(row.id) === String(id));
        if (item) removeItem(item);
        return;
      }
      const btn = e.target.closest('.cds-smart-select__option');
      if (!btn) return;
      if (btn.dataset.create === '1') {
        createFromQuery(input.value);
        return;
      }
      const id = btn.getAttribute('data-id');
      const item = items.find((row) => String(row.id) === String(id));
      if (item) selectItem(item);
    });

    clearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      clearSelection();
    });

    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) {
        closeDropdown();
        if (selected) input.value = selected.label;
        else if (!normalizeLabel(input.value)) input.value = '';
      }
    });

    syncSelectedUi();

    return {
      getValue: () => (selected ? selected.id : null),
      getSelected: () => selected,
      setValue: (item) => {
        selected = item && item.id != null
          ? { id: item.id, label: item.label || String(item.id) }
          : null;
        syncSelectedUi();
      },
      clear: clearSelection,
      destroy: () => {
        container.innerHTML = '';
      }
    };
  }

  const api = { mount, normalizeLabel };
  global.CdsSmartSelect = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : global);
