/**
 * Soft refresh helpers (Sprint 6).
 */
(function (global) {
  'use strict';

  function nodeCount(container) {
    try { return container?.querySelectorAll ? container.querySelectorAll('*').length : null; } catch { return null; }
  }

  function descriptor(container) {
    return container
      ? (container.id || container.getAttribute?.('data-component') || container.className || container.tagName)
      : null;
  }

  function perf(type, container, startedAt, extra = {}) {
    const Monitor = global.PerformanceMonitor;
    if (!Monitor || !Monitor.isEnabled || !Monitor.isEnabled()) return;
    const endedAt = (global.performance && typeof global.performance.now === 'function')
      ? global.performance.now()
      : Date.now();
    Monitor.record(`soft-refresh:${type}`, {
      component: String(descriptor(container) || '').slice(0, 120),
      duration: startedAt == null ? null : Math.max(0, endedAt - startedAt),
      focusedInside: !!(global.UIFocusManager && global.UIFocusManager.isInside(container)),
      modalOpen: !!document.querySelector('.modal.show'),
      ...extra
    });
  }

  const UISoftRefresh = {
    /**
     * Atualiza texto/atributos sem recriar o nó.
     */
    patchText(selectorOrEl, text) {
      const el = typeof selectorOrEl === 'string'
        ? document.querySelector(selectorOrEl)
        : selectorOrEl;
      if (!el) return false;
      const next = text == null ? '' : String(text);
      if (el.textContent !== next) el.textContent = next;
      return true;
    },

    patchAttr(selectorOrEl, attr, value) {
      const el = typeof selectorOrEl === 'string'
        ? document.querySelector(selectorOrEl)
        : selectorOrEl;
      if (!el) return false;
      const next = value == null ? '' : String(value);
      if (el.getAttribute(attr) !== next) el.setAttribute(attr, next);
      return true;
    },

    /**
     * Substitui HTML preservando foco/scroll quando o usuário interage na área.
     */
    replaceHtml(container, html) {
      if (!container) return false;
      const startedAt = (global.performance && typeof global.performance.now === 'function')
        ? global.performance.now()
        : Date.now();
      const nodesBefore = nodeCount(container);
      const Focus = global.UIFocusManager;
      const State = global.UIStateManager;
      const scroll = State ? State.captureScroll(container) : null;
      const run = () => {
        container.innerHTML = html;
        if (State && scroll) State.restoreScroll(container, scroll);
      };
      if (Focus && Focus.isInside(container)) {
        Focus.withPreservedFocus(container, run);
      } else if (document.querySelector('.modal.show') && container.contains
        && container.contains(document.querySelector('.modal.show'))) {
        return false;
      } else {
        run();
      }
      perf('replace-html', container, startedAt, {
        updateType: 'full-replace',
        nodesBefore,
        nodesAfter: nodeCount(container),
        htmlBytesApprox: global.PerformanceMonitor?.approximateBytes?.(html) ?? null
      });
      return true;
    },

    /**
     * Soft refresh: se editando/modal → skip full replace; senão aplica.
     */
    softRefresh(container, updateFn, options = {}) {
      if (!container) return false;
      const startedAt = (global.performance && typeof global.performance.now === 'function')
        ? global.performance.now()
        : Date.now();
      const nodesBefore = nodeCount(container);
      const Poll = global.UIPollingManager;
      if (Poll && Poll.shouldSoftUpdate(container) && options.force !== true) {
        if (typeof options.incremental === 'function') {
          const result = options.incremental();
          perf('incremental', container, startedAt, {
            updateType: 'incremental',
            nodesBefore,
            nodesAfter: nodeCount(container),
            duringPolling: !!options.polling
          });
          return result;
        }
        perf('skipped', container, startedAt, {
          updateType: 'skipped',
          nodesBefore,
          nodesAfter: nodesBefore,
          duringPolling: !!options.polling
        });
        return false;
      }
      const Focus = global.UIFocusManager;
      const result = Focus
        ? Focus.withPreservedFocus(container, updateFn)
        : (typeof updateFn === 'function' ? updateFn() : false);
      const finish = (value) => {
        perf('complete', container, startedAt, {
          updateType: options.updateType || 'callback',
          nodesBefore,
          nodesAfter: nodeCount(container),
          duringPolling: !!options.polling
        });
        return value;
      };
      if (result && typeof result.then === 'function') return result.then(finish);
      return finish(result);
    },

    bumpVersion(owner) {
      if (!owner || typeof owner !== 'object') return 1;
      owner.renderVersion = (Number(owner.renderVersion) || 0) + 1;
      return owner.renderVersion;
    }
  };

  global.UISoftRefresh = UISoftRefresh;
  if (typeof module !== 'undefined' && module.exports) module.exports = UISoftRefresh;
})(typeof window !== 'undefined' ? window : global);
