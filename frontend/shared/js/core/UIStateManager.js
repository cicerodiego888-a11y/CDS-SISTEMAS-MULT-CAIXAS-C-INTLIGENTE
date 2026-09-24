/**
 * UIStateManager — estado transitório da interface (Sprint 6 + Foco Global V2).
 * NÃO armazena dados fiscais/financeiros/estoque/negócio.
 */
(function (global) {
  'use strict';

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return `#${CSS.escape ? CSS.escape(el.id) : el.id}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let sel = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`#${CSS.escape ? CSS.escape(node.id) : node.id}`);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) {
          sel += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      parts.unshift(sel);
      node = parent;
      if (parts.length > 6) break;
    }
    return parts.join(' > ');
  }

  const UIStateManager = {
    cssPath,

    capture(element) {
      const root = element || document.activeElement;
      const active = document.activeElement;
      const inside = root && active && (root === active || (root.contains && root.contains(active)));
      const target = inside ? active : null;
      const state = {
        focusSelector: target ? (target.id ? `#${target.id}` : cssPath(target)) : null,
        cursorStart: null,
        cursorEnd: null,
        selectionStart: null,
        selectionEnd: null,
        scrollTop: root && root.scrollTop != null ? root.scrollTop : (window.scrollY || 0),
        scrollLeft: root && root.scrollLeft != null ? root.scrollLeft : (window.scrollX || 0),
        value: null,
        activeTab: null,
        modal: !!document.querySelector('.modal.show'),
        page: global.UINavigation ? global.UINavigation.getPage() : (global.currentPage || null),
        page_token: global.UINavigation ? global.UINavigation.getToken() : null,
        capturedAt: Date.now()
      };
      if (target && typeof target.selectionStart === 'number') {
        state.cursorStart = target.selectionStart;
        state.cursorEnd = target.selectionEnd;
        state.selectionStart = target.selectionStart;
        state.selectionEnd = target.selectionEnd;
        state.value = target.value;
      }
      const tab = document.querySelector('[data-active-tab].active, .nav-tabs .nav-link.active');
      if (tab) state.activeTab = tab.getAttribute('data-bs-target') || tab.id || tab.textContent;
      return state;
    },

    restore(state, options = {}) {
      if (!state) return false;
      if (state.page_token && global.UINavigation
        && !global.UINavigation.isActiveToken(state.page_token)
        && options.requireSamePage !== false) {
        return false;
      }
      const preferUser = options.preferUserFocus !== false;
      const current = document.activeElement;
      const Focus = global.UIFocusManager;
      const currentIsEditable = Focus
        ? Focus.isEditingElement(current)
        : !!(current && (
          /^(INPUT|TEXTAREA|SELECT)$/i.test(current.tagName || '')
          || current.isContentEditable
        ) && !/^(button|submit|reset|checkbox|radio|file|image|hidden)$/i.test(String(current.type || '')));
      // Só respeitar "usuário mudou o foco" se o destino atual for editável.
      // Botões / body / elementos meramente focáveis NÃO bloqueiam o restore.
      if (preferUser && currentIsEditable
        && current !== document.body && current !== document.documentElement) {
        const currentSel = current.id ? `#${current.id}` : cssPath(current);
        if (currentSel && state.focusSelector && currentSel !== state.focusSelector) {
          return false;
        }
        if (!state.focusSelector && current) return false;
      }
      let el = null;
      if (state.focusSelector) {
        try { el = document.querySelector(state.focusSelector); } catch { el = null; }
      }
      if (!el) return false;
      try {
        if (options.restoreValue === true
          && state.value != null
          && typeof el.value === 'string'
          && el.value !== state.value
          && (el.tagName || '').toLowerCase() !== 'select') {
          el.value = state.value;
        }
        el.focus({ preventScroll: true });
        if (typeof el.setSelectionRange === 'function'
          && state.selectionStart != null
          && state.selectionEnd != null
          && typeof el.value === 'string') {
          const max = el.value.length;
          el.setSelectionRange(
            Math.min(state.selectionStart, max),
            Math.min(state.selectionEnd, max)
          );
        }
      } catch { /* ignore */ }
      return true;
    },

    captureScroll(element) {
      if (!element) return { scrollTop: window.scrollY || 0, scrollLeft: window.scrollX || 0 };
      return { scrollTop: element.scrollTop || 0, scrollLeft: element.scrollLeft || 0 };
    },

    restoreScroll(element, scroll) {
      if (!scroll) return;
      if (element) {
        element.scrollTop = scroll.scrollTop || 0;
        element.scrollLeft = scroll.scrollLeft || 0;
      } else {
        window.scrollTo(scroll.scrollLeft || 0, scroll.scrollTop || 0);
      }
    }
  };

  global.UIStateManager = UIStateManager;
  if (typeof module !== 'undefined' && module.exports) module.exports = UIStateManager;
})(typeof window !== 'undefined' ? window : global);
