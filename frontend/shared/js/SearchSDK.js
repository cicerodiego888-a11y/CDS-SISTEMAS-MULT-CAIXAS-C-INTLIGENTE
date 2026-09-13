/**
 * SearchSDK — cliente Enterprise Search (MIB-RC3.0)
 * Uso: CdsSearchSDK.search({ entity: 'produto', query: 'coca' })
 */
(function (global) {
  'use strict';

  function apiBase() {
    return global.API_URL || '/api';
  }

  function headers() {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  async function request(path, opts) {
    const resp = await fetch(`${apiBase()}${path}`, {
      method: (opts && opts.method) || 'GET',
      body: opts && opts.body,
      signal: opts && opts.signal,
      headers: { ...headers(), ...(opts && opts.headers) }
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  }

  const CdsSearchSDK = {
    /**
     * @param {object} params
     * @param {{ signal?: AbortSignal }} [opts]
     */
    search(params, opts) {
      return request('/search', {
        method: 'POST',
        body: JSON.stringify(params || {}),
        signal: opts && opts.signal
      });
    },
    learn(payload) {
      return request('/search/learn', {
        method: 'POST',
        body: JSON.stringify(payload || {})
      });
    },
    rebuild() {
      return request('/search/rebuild', { method: 'POST', body: '{}' });
    },
    statistics() {
      return request('/search/statistics');
    },
    providers() {
      return request('/search/providers');
    },
    dashboard() {
      return request('/search/enterprise');
    },
    benchmark(entities) {
      return request('/search/benchmark', {
        method: 'POST',
        body: JSON.stringify({ entities })
      });
    }
  };

  global.CdsSearchSDK = CdsSearchSDK;
  global.SearchSDK = CdsSearchSDK;
})(typeof window !== 'undefined' ? window : globalThis);
