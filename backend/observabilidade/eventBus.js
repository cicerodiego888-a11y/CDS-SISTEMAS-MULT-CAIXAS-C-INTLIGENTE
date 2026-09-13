'use strict';

/**
 * RC12.1 — CDS Observability Bus
 *
 * Barramento interno observe-only. publish() nunca bloqueia a aplicação.
 * @module observabilidade/eventBus
 */

const { buildEnvelope } = require('./eventEnvelope');
const { createEventRouter } = require('./eventRouter');
const { shouldLogPublish } = require('./eventPolicies');
const { NIVEIS } = require('./eventTypes');

function obsLog(evento, extra = {}) {
  console.log(JSON.stringify({
    tag: 'OBS',
    evento,
    ts: new Date().toISOString(),
    ...extra
  }));
}

function createEventBus(deps = {}) {
  const router = deps.router || createEventRouter();
  let enabled = deps.enabled !== false;
  const stats = {
    published: 0,
    dropped: 0,
    errors: 0,
    sanitized: 0
  };

  /**
   * Pipeline: validate → sanitize → policy → route (async).
   * @param {object} input
   * @returns {{ accepted: boolean, envelope?: object, errors?: string[] }}
   */
  function processInput(input) {
    if (!enabled) {
      stats.dropped += 1;
      obsLog('OBS DROP', { reason: 'disabled' });
      return { accepted: false, errors: ['disabled'] };
    }

    try {
      const built = buildEnvelope(input || {});
      if (!built.ok) {
        stats.dropped += 1;
        obsLog('OBS DROP', {
          reason: built.dropReason || 'validation',
          errors: built.errors,
          event_name: input && input.event_name
        });
        return { accepted: false, errors: built.errors };
      }

      if (built.sanitized) {
        stats.sanitized += 1;
        obsLog('OBS SANITIZED', {
          event_name: built.envelope.event_name,
          origem: built.envelope.origem
        });
      }

      if (shouldLogPublish(built.envelope) || built.envelope.nivel !== NIVEIS.DEBUG) {
        if (built.envelope.nivel !== NIVEIS.DEBUG || process.env.CDS_OBS_DEBUG === '1') {
          obsLog('OBS PUBLISH', {
            event_name: built.envelope.event_name,
            categoria: built.envelope.categoria,
            nivel: built.envelope.nivel,
            origem: built.envelope.origem,
            duracao_ms: built.envelope.duracao_ms
          });
        }
      }

      stats.published += 1;
      router.route(built.envelope, { sanitized: built.sanitized });
      return { accepted: true, envelope: built.envelope };
    } catch (err) {
      stats.errors += 1;
      obsLog('OBS ERROR', {
        fase: 'publish',
        erro: err && err.message ? err.message : String(err)
      });
      return { accepted: false, errors: [err && err.message ? err.message : String(err)] };
    }
  }

  /**
   * Publicação síncrona na API, entrega assíncrona (setImmediate).
   * Nunca lança; nunca bloqueia o caller além do enqueue.
   * @param {object} input
   * @returns {{ queued: boolean }}
   */
  function publish(input) {
    try {
      setImmediate(() => {
        processInput(input);
      });
      return { queued: true };
    } catch (err) {
      stats.errors += 1;
      obsLog('OBS ERROR', {
        fase: 'enqueue',
        erro: err && err.message ? err.message : String(err)
      });
      return { queued: false };
    }
  }

  /**
   * Publicação assíncrona (Promise). Resolve após processar; não rejeita.
   * @param {object} input
   * @returns {Promise<{ accepted: boolean, envelope?: object, errors?: string[] }>}
   */
  function publishAsync(input) {
    return new Promise((resolve) => {
      setImmediate(() => {
        resolve(processInput(input));
      });
    });
  }

  function subscribe(eventName, handler) {
    return router.subscribe(eventName, handler);
  }

  function unsubscribe(eventName, handler) {
    return router.unsubscribe(eventName, handler);
  }

  function getStats() {
    return { ...stats, enabled };
  }

  function getRecent(limit) {
    return router.getRecent(limit);
  }

  function setEnabled(value) {
    enabled = value !== false;
  }

  /** Apenas testes */
  function _resetForTests() {
    stats.published = 0;
    stats.dropped = 0;
    stats.errors = 0;
    stats.sanitized = 0;
    enabled = true;
    router.clearForTests();
  }

  /** Processa imediatamente (testes) */
  function _publishSyncForTests(input) {
    return processInput(input);
  }

  return {
    publish,
    publishAsync,
    subscribe,
    unsubscribe,
    getStats,
    getRecent,
    setEnabled,
    _resetForTests,
    _publishSyncForTests
  };
}

const eventBus = createEventBus();

module.exports = eventBus;
module.exports.createEventBus = createEventBus;
module.exports.publish = eventBus.publish;
module.exports.publishAsync = eventBus.publishAsync;
module.exports.subscribe = eventBus.subscribe;
module.exports.unsubscribe = eventBus.unsubscribe;
module.exports.getStats = eventBus.getStats;
module.exports.getRecent = eventBus.getRecent;
module.exports.setEnabled = eventBus.setEnabled;
module.exports._resetForTests = eventBus._resetForTests;
module.exports._publishSyncForTests = eventBus._publishSyncForTests;
