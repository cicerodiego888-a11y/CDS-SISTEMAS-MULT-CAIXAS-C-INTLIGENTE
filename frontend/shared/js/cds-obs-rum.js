/**
 * RC12.2 — Cliente RUM frontend (obs.v1 → POST /api/observabilidade/rum).
 * Não envia tokens, XML, dados fiscais ou PII no payload.
 */
(function (global) {
  'use strict';

  const ALLOWED = Object.freeze({
    AUTH_LOGIN_DURATION: 'AUTH_LOGIN_DURATION',
    MODULE_OPEN: 'MODULE_OPEN',
    MODULE_LAZY_CREATED: 'MODULE_LAZY_CREATED',
    MODULE_LAZY_REUSED: 'MODULE_LAZY_REUSED',
    MODULE_LAZY_ERROR: 'MODULE_LAZY_ERROR'
  });

  const PAYLOAD_ALLOW = Object.freeze([
    'page',
    'module',
    'scripts',
    'new_scripts',
    'first_open',
    'reuse',
    'ok',
    'error_code',
    'error_kind',
    'source',
    'phase',
    'loads',
    'total_ms'
  ]);

  function apiBase() {
    if (typeof global.API_URL === 'string' && global.API_URL.trim()) {
      return global.API_URL.replace(/\/$/, '');
    }
    return `${global.location.origin}/api`;
  }

  function slimPayload(payload) {
    const out = { source: 'frontend.rum' };
    if (!payload || typeof payload !== 'object') return out;
    for (let i = 0; i < PAYLOAD_ALLOW.length; i += 1) {
      const key = PAYLOAD_ALLOW[i];
      if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
      const v = payload[key];
      if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out[key] = v;
      }
    }
    return out;
  }

  function publish(eventName, opts) {
    try {
      const name = String(eventName || '').trim();
      if (!ALLOWED[name] && !Object.values(ALLOWED).includes(name)) return false;

      const options = opts || {};
      const body = {
        event_name: name,
        origem: String(options.origem || 'frontend.rum').slice(0, 120),
        duracao_ms: Number.isFinite(Number(options.duracao_ms))
          ? Number(Number(options.duracao_ms).toFixed(2))
          : undefined,
        resultado: options.resultado || (options.ok === false ? 'erro' : 'ok'),
        correlation_id: options.correlation_id
          ? String(options.correlation_id).slice(0, 64)
          : undefined,
        payload: slimPayload(options.payload)
      };

      const headers = { 'Content-Type': 'application/json' };
      try {
        const token = global.localStorage && global.localStorage.getItem('token');
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch (_) { /* ignore */ }

      const url = `${apiBase()}/observabilidade/rum`;
      if (global.fetch) {
        global.fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          keepalive: true
        }).catch(function () { /* fire-and-forget */ });
        return true;
      }

      if (global.$ && global.$.ajax) {
        global.$.ajax({
          url,
          method: 'POST',
          contentType: 'application/json',
          headers,
          data: JSON.stringify(body)
        });
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  function now() {
    if (global.performance && typeof global.performance.now === 'function') {
      return global.performance.now();
    }
    return Date.now();
  }

  global.CdsObsRum = Object.freeze({
    EVENT: ALLOWED,
    publish,
    now
  });
})(typeof window !== 'undefined' ? window : this);
