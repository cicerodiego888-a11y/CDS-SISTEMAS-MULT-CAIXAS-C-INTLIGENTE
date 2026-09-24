/**
 * UIFocusManager — preservar foco/caret (Sprint 6 + Foco Global V2).
 */
(function (global) {
  'use strict';

  function log(msg) {
    if (global.CDS_UI_DEBUG) {
      try { console.debug('[UI-FOCUS]', msg); } catch { /* ignore */ }
    }
  }

  function tagOf(el) {
    return String(el && el.tagName || '').toLowerCase();
  }

  function isEditableNode(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = tagOf(el);
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') {
      const type = String(el.type || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'hidden', 'range', 'color'].includes(type)) {
        return false;
      }
      return true;
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function stableSelector(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return `#${global.CSS && CSS.escape ? CSS.escape(el.id) : el.id}`;
    const dataKey = el.getAttribute && (
      el.getAttribute('data-focus-id')
      || el.getAttribute('data-index')
      || el.getAttribute('data-id')
    );
    if (dataKey && el.className) {
      const cls = String(el.className).split(/\s+/).filter(Boolean)[0];
      if (cls) {
        const attr = el.getAttribute('data-focus-id')
          ? 'data-focus-id'
          : (el.getAttribute('data-index') ? 'data-index' : 'data-id');
        return `.${cls}[${attr}="${String(dataKey).replace(/"/g, '\\"')}"]`;
      }
    }
    if (el.name) {
      const tag = tagOf(el);
      return `${tag}[name="${String(el.name).replace(/"/g, '\\"')}"]`;
    }
    const State = global.UIStateManager;
    if (State && typeof State.cssPath === 'function') return State.cssPath(el);
    return null;
  }

  const UIFocusManager = {
    getActive() {
      return document.activeElement || null;
    },

    isEditableNode,

    isInside(container) {
      const active = document.activeElement;
      if (!container || !active) return false;
      return container === active || (container.contains && container.contains(active));
    },

    isEditingElement(el) {
      return isEditableNode(el || document.activeElement);
    },

    isEditing(container) {
      const active = document.activeElement;
      if (!isEditableNode(active)) return false;
      if (container && !this.isInside(container)) return false;
      return true;
    },

    shouldPreserveFocus(container) {
      if (this.isEditing(container || null)) return true;
      if (document.querySelector('.modal.show') && this.isEditing(document.querySelector('.modal.show'))) {
        return true;
      }
      return false;
    },

    captureFocusState(container) {
      const State = global.UIStateManager;
      const active = document.activeElement;
      const editing = this.isEditing(container || null);
      const base = State
        ? State.capture(container || (editing ? active : null))
        : {};
      const selector = editing ? stableSelector(active) : (base.focusSelector || null);
      return {
        ...base,
        focusSelector: selector || base.focusSelector || null,
        editing: !!editing,
        tag: editing ? tagOf(active) : null,
        name: editing && active ? active.name || null : null,
        dataIndex: editing && active && active.getAttribute
          ? (active.getAttribute('data-index') || active.getAttribute('data-id') || null)
          : null,
        page_token: global.UINavigation ? global.UINavigation.getToken() : null,
        page: global.UINavigation
          ? global.UINavigation.getPage()
          : (global.currentPage || null)
      };
    },

    restoreFocusState(state, options = {}) {
      if (!state || !state.editing) return false;
      if (state.page_token && global.UINavigation
        && !global.UINavigation.isActiveToken(state.page_token)) {
        log('skip restore — stale page_token');
        return false;
      }
      if (state.page && global.UINavigation
        && !global.UINavigation.isActivePage(state.page)
        && options.requireSamePage !== false) {
        log('skip restore — page changed');
        return false;
      }
      const State = global.UIStateManager;
      if (!State) return false;
      return State.restore(state, {
        preferUserFocus: options.preferUserFocus !== false,
        restoreValue: options.restoreValue === true
      });
    },

    /**
     * Executa update preservando foco se o usuário estiver editando na área.
     * options.restoreValue (default true): reaplicar valor capturado após remount.
     */
    withPreservedFocus(container, updateFn, options = {}) {
      const should = this.shouldPreserveFocus(container);
      const snapshot = should ? this.captureFocusState(container) : null;
      const beforeActive = document.activeElement;
      const result = typeof updateFn === 'function' ? updateFn() : null;
      const after = () => {
        if (!snapshot) return result;
        const now = document.activeElement;
        if (now && now !== beforeActive && now !== document.body
          && (!container || !container.contains(now))
          && this.isEditingElement(now)) {
          log('skip restore — user moved focus');
          return result;
        }
        this.restoreFocusState(snapshot, {
          preferUserFocus: true,
          restoreValue: options.restoreValue !== false
        });
        return result;
      };
      if (result && typeof result.then === 'function') {
        return result.then(after, (err) => { after(); throw err; });
      }
      return after();
    },

    /** Nunca focar notificações/toasts. */
    assertNoFocusSteal(element) {
      if (!element) return;
      if (element.classList && (
        element.classList.contains('toast')
        || element.classList.contains('alert')
        || element.getAttribute('role') === 'status'
      )) {
        /* no-op intentionally — callers must not focus() */
      }
    }
  };

  global.UIFocusManager = UIFocusManager;
  if (typeof module !== 'undefined' && module.exports) module.exports = UIFocusManager;
})(typeof window !== 'undefined' ? window : global);
