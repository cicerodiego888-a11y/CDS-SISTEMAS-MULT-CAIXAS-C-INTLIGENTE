/**
 * AgentSDK — cliente do CDS Intelligence Agent (CIA)
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-CDS-Origem': global.CDS_MODULE || 'erp',
      'X-CDS-Session': localStorage.getItem('cia_sessao') || 'erp-default'
    };
  }

  async function request(path, opts) {
    const resp = await fetch(`${apiBase()}${path}`, {
      ...opts,
      headers: { ...headers(), ...(opts && opts.headers) }
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  }

  const CdsAgentSDK = {
    chat(params) {
      return request('/agent/chat', {
        method: 'POST',
        body: JSON.stringify(params || {})
      });
    },
    execute(params) {
      return request('/agent/execute', {
        method: 'POST',
        body: JSON.stringify(params || {})
      });
    },
    history(limite) {
      return request(`/agent/history?limite=${limite || 20}`);
    },
    tools() {
      return request('/agent/tools');
    },
    status() {
      return request('/agent/status');
    }
  };

  global.CdsAgentSDK = CdsAgentSDK;
  global.AgentSDK = CdsAgentSDK;
})(typeof window !== 'undefined' ? window : globalThis);
