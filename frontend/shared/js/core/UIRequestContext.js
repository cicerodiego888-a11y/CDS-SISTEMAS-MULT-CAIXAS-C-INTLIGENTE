/**
 * UIRequestContext — identidade de requisição + stale (Sprint 6).
 */
(function (global) {
  'use strict';

  const STATUS = Object.freeze({
    ACTIVE: 'ACTIVE',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    STALE: 'STALE'
  });

  let _seq = 0;
  /** @type {Map<string, Object>} */
  const _requests = new Map();
  /** search buckets: key -> latest request_id */
  const _searchLatest = new Map();

  function nextId() {
    _seq += 1;
    return `UIREQ-${Date.now().toString(36)}-${String(_seq).padStart(5, '0')}`;
  }

  function log(detail) {
    if (global.CDS_UI_DEBUG) {
      try { console.debug('[UI-REQUEST]', detail); } catch { /* ignore */ }
    }
  }

  function perf(type, row, extra = {}) {
    const Monitor = global.PerformanceMonitor;
    if (!Monitor || !Monitor.isEnabled || !Monitor.isEnabled()) return;
    const counts = { active: 0, completed: 0, cancelled: 0, stale: 0 };
    for (const item of _requests.values()) {
      const key = String(item.status || '').toLowerCase();
      if (Object.prototype.hasOwnProperty.call(counts, key)) counts[key] += 1;
    }
    Monitor.record(`request-context:${type}`, {
      requestId: row?.request_id || null,
      page: row?.page || null,
      pageToken: row?.page_token || null,
      component: row?.component || null,
      status: row?.status || null,
      reason: row?.reason || null,
      duration: row?.created_ms ? Math.max(0, Date.now() - row.created_ms) : null,
      retained: _requests.size,
      searchBuckets: _searchLatest.size,
      counts,
      ...extra
    });
  }

  const UIRequestContext = {
    STATUS,

    begin(options = {}) {
      const request_id = options.request_id || nextId();
      const page_token = options.page_token
        || (global.UINavigation && global.UINavigation.getToken())
        || null;
      const page = options.page
        || (global.UINavigation && global.UINavigation.getPage())
        || null;
      const row = {
        request_id,
        page_token,
        page,
        component: options.component || null,
        render_version: options.render_version != null ? Number(options.render_version) : null,
        search_key: options.search_key || null,
        created_at: new Date().toISOString(),
        created_ms: Date.now(),
        status: STATUS.ACTIVE,
        abortController: options.abort !== false && typeof AbortController !== 'undefined'
          ? new AbortController()
          : null
      };
      _requests.set(request_id, row);
      if (row.search_key) {
        const prev = _searchLatest.get(row.search_key);
        if (prev && prev !== request_id) {
          this.markStale(prev, 'search_superseded');
        }
        _searchLatest.set(row.search_key, request_id);
      }
      perf('start', row);
      return row;
    },

    get(request_id) {
      return _requests.get(request_id) || null;
    },

    signal(request_id) {
      return _requests.get(request_id)?.abortController?.signal || undefined;
    },

    markCompleted(request_id) {
      const row = _requests.get(request_id);
      if (!row) return null;
      if (row.status === STATUS.ACTIVE) row.status = STATUS.COMPLETED;
      perf('end', row);
      return row;
    },

    markStale(request_id, reason) {
      const row = _requests.get(request_id);
      if (!row) return null;
      if (row.status === STATUS.ACTIVE) {
        row.status = STATUS.STALE;
        row.reason = reason || 'stale';
        try { row.abortController?.abort?.(); } catch { /* ignore */ }
        log({ page: row.page, request: request_id, status: 'STALE', reason: row.reason });
      }
      perf('stale', row);
      return row;
    },

    cancel(request_id, reason) {
      const row = _requests.get(request_id);
      if (!row) return null;
      row.status = STATUS.CANCELLED;
      row.reason = reason || 'cancelled';
      try { row.abortController?.abort?.(); } catch { /* ignore */ }
      perf('cancel', row);
      return row;
    },

    staleByPageToken(token) {
      if (!token) return;
      for (const [id, row] of _requests) {
        if (row.page_token === token && row.status === STATUS.ACTIVE) {
          this.markStale(id, 'page_changed');
        }
      }
    },

    staleByPage(page) {
      if (!page) return;
      for (const [id, row] of _requests) {
        if (row.page === page && row.status === STATUS.ACTIVE) {
          this.markStale(id, 'page_leave');
        }
      }
    },

    /**
     * Retorna true se a resposta ainda pode ser aplicada.
     */
    isFresh(request_id, options = {}) {
      const row = _requests.get(request_id);
      if (!row) return false;
      if (row.status === STATUS.STALE || row.status === STATUS.CANCELLED) return false;
      if (global.UINavigation && !global.UINavigation.guard(row.page_token, options.page || row.page)) {
        this.markStale(request_id, 'page_changed');
        return false;
      }
      if (row.search_key) {
        const latest = _searchLatest.get(row.search_key);
        if (latest && latest !== request_id) {
          this.markStale(request_id, 'search_superseded');
          return false;
        }
      }
      if (options.render_version != null && row.render_version != null
        && Number(options.render_version) > Number(row.render_version)) {
        this.markStale(request_id, 'render_version');
        return false;
      }
      return true;
    },

    getDiagnostics() {
      const counts = { active: 0, completed: 0, cancelled: 0, stale: 0 };
      for (const row of _requests.values()) {
        const key = String(row.status || '').toLowerCase();
        if (Object.prototype.hasOwnProperty.call(counts, key)) counts[key] += 1;
      }
      return {
        retained: _requests.size,
        searchBuckets: _searchLatest.size,
        counts
      };
    },

    /** Helper: begin + fetch guard wrapper */
    async run(options, executor) {
      const ctx = this.begin(options);
      try {
        const result = await executor(ctx);
        if (!this.isFresh(ctx.request_id)) return { stale: true, ctx, result: null };
        this.markCompleted(ctx.request_id);
        return { stale: false, ctx, result };
      } catch (err) {
        if (ctx.abortController?.signal?.aborted) {
          this.markStale(ctx.request_id, 'aborted');
          return { stale: true, ctx, result: null, error: err };
        }
        throw err;
      }
    },

    _resetForTests() {
      _seq = 0;
      _requests.clear();
      _searchLatest.clear();
    }
  };

  global.UIRequestContext = UIRequestContext;
  if (typeof module !== 'undefined' && module.exports) module.exports = UIRequestContext;
})(typeof window !== 'undefined' ? window : global);
