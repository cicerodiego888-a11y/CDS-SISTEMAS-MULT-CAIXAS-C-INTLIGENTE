'use strict';

/**
 * RC12 — CDS Observability Bus (fachada pública)
 *
 * Observe-only. Não altera regras de negócio, APIs públicas de domínio ou motores.
 * @module observabilidade
 */

const eventBus = require('./eventBus');
const eventTypes = require('./eventTypes');
const { buildEnvelope, validateEnvelope, CAMPOS_OBRIGATORIOS } = require('./eventEnvelope');
const { sanitizePayload } = require('./eventSanitizer');
const { applyPolicies, RETENCAO_POR_NIVEL } = require('./eventPolicies');
const { iniciarAdapters } = require('./adapters');
const telemetryCollector = require('./telemetryCollector');
const { createResourceSampler } = require('./resourceSampler');
const alertEngine = require('./alertEngine');
const historyService = require('./historyService');

let adaptersIniciados = false;
let resourceSampler = null;

/**
 * Inicializa adapters + collector + sampler + alerts + history (idempotente).
 * @returns {object}
 */
function iniciar() {
  if (adaptersIniciados) {
    return { ok: true, adapters: { already: true } };
  }
  try {
    const resultado = iniciarAdapters();
    const collector = telemetryCollector.start();
    if (!resourceSampler) {
      resourceSampler = createResourceSampler({
        publish: eventBus.publish,
        intervalMs: Number(process.env.CDS_OBS_SAMPLER_MS) || undefined
      });
    }
    const sampler = resourceSampler.start();
    const alerts = alertEngine.start();
    // History start é async; fire-and-forget para não bloquear boot
    let history = { ok: true, pending: true };
    historyService.start().then((h) => {
      history = h;
    }).catch(() => {
      history = { ok: false };
    });
    adaptersIniciados = true;
    return { ...resultado, collector, sampler, alerts, history };
  } catch (err) {
    console.log(JSON.stringify({
      tag: 'OBS',
      evento: 'OBS ERROR',
      ts: new Date().toISOString(),
      fase: 'iniciar',
      erro: err && err.message ? err.message : String(err)
    }));
    return { ok: false };
  }
}

module.exports = {
  ...eventTypes,
  publish: eventBus.publish,
  publishAsync: eventBus.publishAsync,
  subscribe: eventBus.subscribe,
  unsubscribe: eventBus.unsubscribe,
  getStats: eventBus.getStats,
  getRecent: eventBus.getRecent,
  setEnabled: eventBus.setEnabled,
  buildEnvelope,
  validateEnvelope,
  CAMPOS_OBRIGATORIOS,
  sanitizePayload,
  applyPolicies,
  RETENCAO_POR_NIVEL,
  iniciar,
  getSummary: telemetryCollector.getSummary,
  listAlerts: alertEngine.listAlerts,
  getAlertsSummary: alertEngine.getAlertsSummary,
  getHistorySummary: (...args) => historyService.getHistorySummary(...args),
  exportHistory: (...args) => historyService.exportHistory(...args),
  eventBus,
  alertEngine,
  historyService,
  _resetForTests: () => {
    adaptersIniciados = false;
    try {
      if (resourceSampler) resourceSampler.stop();
    } catch (_) { /* ignore */ }
    resourceSampler = null;
    historyService._resetForTests();
    alertEngine._resetForTests();
    telemetryCollector._resetForTests();
    eventBus._resetForTests();
  },
  _publishSyncForTests: eventBus._publishSyncForTests
};
