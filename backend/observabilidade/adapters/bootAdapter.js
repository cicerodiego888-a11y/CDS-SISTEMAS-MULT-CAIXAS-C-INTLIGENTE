'use strict';

/**
 * Adapter BOOT — publica eventos a partir do bootLog (observe-only).
 * @module observabilidade/adapters/bootAdapter
 */

const { CATEGORIAS, EVENT_NAMES, RESULTADOS } = require('../eventTypes');

const MAPA = Object.freeze({
  BOOT: EVENT_NAMES.BOOT_STARTED,
  'DATABASE READY': EVENT_NAMES.BOOT_DATABASE_READY,
  'DATABASE ERROR': EVENT_NAMES.BOOT_DATABASE_ERROR,
  'HTTP LISTENING': EVENT_NAMES.BOOT_HTTP_LISTENING,
  'BACKGROUND START': EVENT_NAMES.BOOT_BACKGROUND_START,
  'BACKGROUND STEP OK': EVENT_NAMES.BOOT_BACKGROUND_STEP,
  'BACKGROUND READY': EVENT_NAMES.BOOT_BACKGROUND_READY,
  'BACKGROUND ERROR': EVENT_NAMES.BOOT_BACKGROUND_ERROR,
  'MIP FLAG READY': EVENT_NAMES.BOOT_MIP_FLAG_READY
});

/**
 * @param {string} bootEvento
 * @param {object} [extra]
 * @param {{ publish?: Function }} [bus]
 */
function publishBootEvent(bootEvento, extra = {}, bus) {
  try {
    const eventBus = bus || require('../eventBus');
    const event_name = MAPA[bootEvento] || EVENT_NAMES.BOOT_STARTED;
    const isError = /ERROR/i.test(String(bootEvento));
    eventBus.publish({
      event_name,
      categoria: CATEGORIAS.PLATFORM,
      origem: 'server.boot',
      duracao_ms: extra.ms != null ? extra.ms : (extra.stepMs != null ? extra.stepMs : (extra.backgroundMs != null ? extra.backgroundMs : null)),
      resultado: isError ? RESULTADOS.ERRO : RESULTADOS.OK,
      payload: {
        boot_evento: bootEvento,
        step: extra.step || null,
        port: extra.port != null ? extra.port : null,
        enabled: extra.enabled != null ? extra.enabled : null,
        erro: extra.erro || null
      }
    });
  } catch (_) {
    /* observe-only: nunca propaga */
  }
}

module.exports = {
  publishBootEvent,
  MAPA
};
