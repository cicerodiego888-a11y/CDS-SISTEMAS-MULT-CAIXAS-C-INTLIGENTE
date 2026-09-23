/**
 * UINavigation — tokens de página + lifecycle (Sprint 6).
 */
(function (global) {
  'use strict';

  let _seq = 0;
  let _token = null;
  let _page = null;
  let _phase = 'IDLE';
  const _leaveHandlers = new Map();

  function log(msg, detail) {
    if (global.CDS_UI_DEBUG) {
      try { console.debug('[UI-NAV]', msg, detail || ''); } catch { /* ignore */ }
    }
  }

  function nextToken(page) {
    _seq += 1;
    const p = String(page || 'page').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24) || 'PAGE';
    return `PAGE-${p}-${String(_seq).padStart(4, '0')}`;
  }

  const UINavigation = {
    enterPage(page) {
      const previous = _page;
      const previousToken = _token;
      const Monitor = global.PerformanceMonitor;
      if (Monitor?.isEnabled?.()) Monitor.navigationPhase('cleanup:start', { previousPage: previous });
      if (previous && previous !== page) {
        this.leavePage(previous);
      }
      _page = page;
      _token = nextToken(page);
      _phase = 'PAGE_ENTER';
      log('enter', { page, token: _token, previousToken });
      if (global.UIRequestContext) global.UIRequestContext.staleByPageToken(previousToken);
      if (global.UIPollingManager) global.UIPollingManager.stopByPage(previous);
      _phase = 'PAGE_ACTIVE';
      if (Monitor?.isEnabled?.()) {
        Monitor.navigationPhase('cleanup:end', {
          previousPage: previous,
          pageToken: _token,
          previousToken
        });
      }
      return _token;
    },

    leavePage(page) {
      const p = page || _page;
      const Monitor = global.PerformanceMonitor;
      const operationId = Monitor?.start?.('navigation:leave', { page: p, pageToken: _token });
      _phase = 'PAGE_LEAVE';
      log('leave', { page: p, token: _token });
      const handlers = _leaveHandlers.get(p) || [];
      handlers.forEach((fn) => {
        try { fn(); } catch { /* ignore */ }
      });
      if (global.UIRequestContext) global.UIRequestContext.staleByPage(p);
      if (global.UIPollingManager) global.UIPollingManager.stopByPage(p);
      _phase = 'PAGE_DESTROY';
      if (operationId) Monitor.end(operationId, { handlers: handlers.length });
    },

    getToken() { return _token; },
    getPage() { return _page; },
    getPhase() { return _phase; },

    isActiveToken(token) {
      return !!token && token === _token;
    },

    isActivePage(page) {
      return !!page && page === _page;
    },

    onPageLeave(page, fn) {
      if (!page || typeof fn !== 'function') return () => {};
      if (!_leaveHandlers.has(page)) _leaveHandlers.set(page, []);
      _leaveHandlers.get(page).push(fn);
      return () => {
        const list = _leaveHandlers.get(page) || [];
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      };
    },

    /** Guard O(1): resposta ainda pertence à página ativa? */
    guard(token, page) {
      if (token != null && token !== _token) return false;
      if (page != null && page !== _page) return false;
      return true;
    },

    _resetForTests() {
      _seq = 0;
      _token = null;
      _page = null;
      _phase = 'IDLE';
      _leaveHandlers.clear();
    }
  };

  global.UINavigation = UINavigation;
  if (typeof module !== 'undefined' && module.exports) module.exports = UINavigation;
})(typeof window !== 'undefined' ? window : global);
