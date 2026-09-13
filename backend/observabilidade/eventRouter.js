'use strict';

/**
 * RC12.1 — Roteamento interno de eventos (memória + subscribers).
 * Não persiste em banco (RC12.1). Não bloqueia a aplicação.
 * @module observabilidade/eventRouter
 */

const { NIVEIS } = require('./eventTypes');

const MAX_RING = 500;

/**
 * @param {{ ring?: object[], onRoute?: Function }} [deps]
 */
function createEventRouter(deps = {}) {
  /** @type {object[]} */
  const ring = deps.ring || [];
  /** @type {Map<string, Set<Function>>} */
  const subscribers = new Map();
  /** @type {Set<Function>} */
  const wildcards = new Set();

  function obsLog(evento, extra = {}) {
    console.log(JSON.stringify({
      tag: 'OBS',
      evento,
      ts: new Date().toISOString(),
      ...extra
    }));
  }

  /**
   * @param {string} eventName
   * @param {Function} handler
   * @returns {() => void}
   */
  function subscribe(eventName, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('handler deve ser function');
    }
    if (eventName === '*' || eventName === 'all') {
      wildcards.add(handler);
      return () => wildcards.delete(handler);
    }
    if (!subscribers.has(eventName)) {
      subscribers.set(eventName, new Set());
    }
    subscribers.get(eventName).add(handler);
    return () => {
      const set = subscribers.get(eventName);
      if (set) {
        set.delete(handler);
        if (set.size === 0) subscribers.delete(eventName);
      }
    };
  }

  function unsubscribe(eventName, handler) {
    if (eventName === '*' || eventName === 'all') {
      wildcards.delete(handler);
      return;
    }
    subscribers.get(eventName)?.delete(handler);
  }

  /**
   * Entrega envelope aos subscribers e ao ring buffer.
   * Erros de subscriber são isolados.
   * @param {object} envelope
   * @param {{ sanitized?: boolean }} [meta]
   */
  function route(envelope, meta = {}) {
    try {
      ring.push(envelope);
      if (ring.length > MAX_RING) {
        ring.splice(0, ring.length - MAX_RING);
      }

      if (envelope.nivel !== NIVEIS.DEBUG || process.env.CDS_OBS_DEBUG === '1') {
        obsLog('OBS ROUTE', {
          event_name: envelope.event_name,
          categoria: envelope.categoria,
          nivel: envelope.nivel,
          origem: envelope.origem,
          sanitized: meta.sanitized === true
        });
      }

      const handlers = [
        ...(subscribers.get(envelope.event_name) || []),
        ...wildcards
      ];

      for (const handler of handlers) {
        try {
          handler(envelope);
        } catch (err) {
          obsLog('OBS ERROR', {
            fase: 'subscriber',
            event_name: envelope.event_name,
            erro: err && err.message ? err.message : String(err)
          });
        }
      }
    } catch (err) {
      obsLog('OBS ERROR', {
        fase: 'route',
        erro: err && err.message ? err.message : String(err)
      });
    }
  }

  function getRecent(limit = 50) {
    const n = Math.max(0, Number(limit) || 50);
    return ring.slice(-n);
  }

  function clearForTests() {
    ring.length = 0;
    subscribers.clear();
    wildcards.clear();
  }

  return {
    subscribe,
    unsubscribe,
    route,
    getRecent,
    clearForTests,
    MAX_RING
  };
}

module.exports = {
  createEventRouter,
  MAX_RING
};
