'use strict';

/**
 * Adapter MiipTelemetry — envolve finalizarExecucao sem alterar retorno.
 * Não altera Decision/Explain/Canonical engines.
 * @module observabilidade/adapters/miipAdapter
 */

const { CATEGORIAS, EVENT_NAMES, RESULTADOS } = require('../eventTypes');

let patched = false;

/**
 * @param {object} report
 * @param {{ publish?: Function }} [bus]
 */
function publishFromReport(report, bus) {
  try {
    if (!report) return;
    const eventBus = bus || require('../eventBus');
    const json = typeof report.toJSON === 'function' ? report.toJSON() : report;
    const health = json.health || report.health || null;
    const tempoTotal = json.tempoTotal ?? report.tempoTotal ?? null;
    const errors = json.errors || report.errors || [];
    const warnings = json.warnings || report.warnings || [];

    let resultado = RESULTADOS.OK;
    if (errors.length) resultado = RESULTADOS.ERRO;
    else if (warnings.length) resultado = RESULTADOS.PARCIAL;

    eventBus.publish({
      event_name: EVENT_NAMES.MIIP_IDENTIFY_FINISHED,
      categoria: CATEGORIAS.MIIP,
      origem: 'miip.telemetry',
      request_id: json.requestId || report.requestId || null,
      duracao_ms: tempoTotal,
      resultado,
      payload: {
        health,
        engines: json.enginesExecutados || report.enginesExecutados || [],
        quantidade_candidatos: json.quantidadeCandidatos ?? report.quantidadeCandidatos ?? 0,
        score_final: json.scoreFinal ?? report.scoreFinal ?? null,
        nivel_confianca: json.nivelConfianca ?? report.nivelConfianca ?? null,
        warnings_count: Array.isArray(warnings) ? warnings.length : 0,
        errors_count: Array.isArray(errors) ? errors.length : 0
      }
    });

    if (health && String(health).toUpperCase() !== 'OK' && String(health).toUpperCase() !== 'HEALTHY') {
      eventBus.publish({
        event_name: EVENT_NAMES.MIIP_HEALTH_DEGRADED,
        categoria: CATEGORIAS.MIIP,
        origem: 'miip.telemetry',
        request_id: json.requestId || report.requestId || null,
        duracao_ms: tempoTotal,
        resultado: RESULTADOS.PARCIAL,
        payload: { health, errors_count: Array.isArray(errors) ? errors.length : 0 }
      });
    }
  } catch (_) {
    /* observe-only */
  }
}

/**
 * @returns {{ ok: boolean, reason?: string }}
 */
function iniciar() {
  if (patched) return { ok: true, reason: 'already' };
  try {
    const MiipTelemetryService = require('../../motores/miip/services/MiipTelemetryService');
    const proto = MiipTelemetryService.prototype;
    if (!proto || typeof proto.finalizarExecucao !== 'function') {
      return { ok: false, reason: 'finalizarExecucao_ausente' };
    }
    const original = proto.finalizarExecucao;
    proto.finalizarExecucao = function finalizarExecucaoObs() {
      const report = original.apply(this, arguments);
      publishFromReport(report);
      return report;
    };
    patched = true;
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  iniciar,
  publishFromReport
};
