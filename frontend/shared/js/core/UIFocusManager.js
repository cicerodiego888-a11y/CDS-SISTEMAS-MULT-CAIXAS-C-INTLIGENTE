/**
 * UIFocusManager — preservar foco/cursor sem roubar foco (Sprint 6).
 */
(function (global) {
  'use strict';

  function log(msg) {
    if (global.CDS_UI_DEBUG) {
      try { console.debug('[UI-FOCUS]', msg); } catch { /* ignore */ }
    }
  }

  const UIFocusManager = {
    getActive() {
      return document.activeElement || null;
    },

    isInside(container) {
      const active = document.activeElement;
      if (!container || !active) return false;
      return container === active || (container.contains && container.contains(active));
    },

    isEditing(container) {
      const active = document.activeElement;
      if (!active) return false;
      if (container && !this.isInside(container)) return false;
      const tag = (active.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (active.isContentEditable) return true;
      return false;
    },

    /**
     * Executa update preservando foco se o usuário estiver na área.
     * Se o usuário mudar o foco durante o update, o foco novo vence.
     */
    withPreservedFocus(container, updateFn) {
      const State = global.UIStateManager;
      const wasEditing = this.isInside(container);
      const snapshot = wasEditing && State ? State.capture(container) : null;
      const beforeActive = document.activeElement;
      const result = typeof updateFn === 'function' ? updateFn() : null;
      const after = () => {
        if (!snapshot || !State) return result;
        const now = document.activeElement;
        if (now && now !== beforeActive && now !== document.body
          && (!container || !container.contains(now))) {
          log('skip restore — user moved focus');
          return result;
        }
        State.restore(snapshot, { preferUserFocus: true });
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
