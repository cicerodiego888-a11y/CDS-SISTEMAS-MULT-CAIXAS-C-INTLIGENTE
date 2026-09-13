'use strict';

/**
 * Adapter Fiscal SOAP — subscribe em fiscalSoapTelemetry (observe-only).
 * Não altera SoapTransport nem regras fiscais.
 * @module observabilidade/adapters/fiscalSoapAdapter
 */

const { CATEGORIAS, EVENT_NAMES, RESULTADOS } = require('../eventTypes');

const MAPA = Object.freeze({
  SOAP_INICIADO: EVENT_NAMES.SOAP_INICIADO,
  SOAP_FINALIZADO: EVENT_NAMES.SOAP_FINALIZADO,
  SOAP_FALHA: EVENT_NAMES.SOAP_FALHA,
  SOAP_TIMEOUT: EVENT_NAMES.SOAP_TIMEOUT,
  SOAP_HTTP_ERROR: EVENT_NAMES.SOAP_HTTP_ERROR,
  SOAP_CSTAT: EVENT_NAMES.SOAP_CSTAT
});

/** @type {Array<() => void>} */
const unscribers = [];

/**
 * @param {string} soapEvent
 * @param {object} registro
 * @param {{ publish?: Function }} [bus]
 */
function publishSoapEvent(soapEvent, registro = {}, bus) {
  try {
    const eventBus = bus || require('../eventBus');
    const event_name = MAPA[soapEvent];
    if (!event_name) return;

    let resultado = RESULTADOS.OK;
    if (soapEvent === 'SOAP_TIMEOUT') resultado = RESULTADOS.TIMEOUT;
    else if (soapEvent === 'SOAP_FALHA' || soapEvent === 'SOAP_HTTP_ERROR') resultado = RESULTADOS.ERRO;

    // Payload mínimo — sem XML/SOAP body
    eventBus.publish({
      event_name,
      categoria: CATEGORIAS.FISCAL,
      origem: 'fiscal.soapTelemetry',
      correlation_id: registro.correlationId || registro.correlation_id || null,
      request_id: registro.requestId || registro.request_id || null,
      duracao_ms: registro.tempoTotalMs != null
        ? registro.tempoTotalMs
        : (registro.tempoSoapMs != null ? registro.tempoSoapMs : null),
      resultado,
      payload: {
        soap_evento: soapEvent,
        operacao: registro.operacao || registro.operation || null,
        endpoint_host: safeHost(registro.endpoint),
        cStat: registro.cStat || null,
        xMotivo: registro.xMotivo ? String(registro.xMotivo).slice(0, 120) : null,
        resultado_soap: registro.resultado || null,
        retry: registro.retry != null ? registro.retry : null,
        transport_success: registro.transportSuccess != null ? !!registro.transportSuccess : null
      }
    });
  } catch (_) {
    /* observe-only */
  }
}

function safeHost(endpoint) {
  if (!endpoint) return null;
  try {
    const u = new URL(String(endpoint));
    return u.host || null;
  } catch {
    return null;
  }
}

/**
 * @returns {{ ok: boolean, reason?: string }}
 */
function iniciar() {
  if (unscribers.length) return { ok: true, reason: 'already' };
  try {
    const { fiscalSoapTelemetry, FiscalSoapTelemetryEvents } = require('../../services/fiscal/core/FiscalSoapTelemetry');
    const events = Object.values(FiscalSoapTelemetryEvents || MAPA);
    for (const ev of events) {
      const handler = (registro) => publishSoapEvent(ev, registro);
      const unsub = fiscalSoapTelemetry.on(ev, handler);
      if (typeof unsub === 'function') {
        unscribers.push(unsub);
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  }
}

function parar() {
  while (unscribers.length) {
    const fn = unscribers.pop();
    try { fn(); } catch (_) { /* ignore */ }
  }
}

module.exports = {
  iniciar,
  parar,
  publishSoapEvent,
  MAPA
};
