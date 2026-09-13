'use strict';

/**
 * Adapter LAZY SERVICE — publica a partir do lazyLog (observe-only).
 * @module observabilidade/adapters/lazyAdapter
 */

const { CATEGORIAS, EVENT_NAMES, RESULTADOS } = require('../eventTypes');

const MAPA = Object.freeze({
  'LAZY INIT': EVENT_NAMES.LAZY_SERVICE_INIT,
  'SERVICE CREATED': EVENT_NAMES.LAZY_SERVICE_CREATED,
  'SERVICE REUSED': EVENT_NAMES.LAZY_SERVICE_REUSED,
  'SERVICE ERROR': EVENT_NAMES.LAZY_SERVICE_ERROR
});

/**
 * @param {string} lazyEvento
 * @param {object} [extra]
 * @param {{ publish?: Function }} [bus]
 */
function publishLazyEvent(lazyEvento, extra = {}, bus) {
  try {
    const eventBus = bus || require('../eventBus');
    const event_name = MAPA[lazyEvento];
    if (!event_name) return;
    const isError = lazyEvento === 'SERVICE ERROR';
    eventBus.publish({
      event_name,
      categoria: CATEGORIAS.PLATFORM,
      origem: 'boot.lazyService',
      duracao_ms: extra.createdMs != null ? extra.createdMs : null,
      resultado: isError ? RESULTADOS.ERRO : RESULTADOS.OK,
      payload: {
        lazy_evento: lazyEvento,
        service: extra.service || null,
        reuses: extra.reuses != null ? extra.reuses : null,
        erro: extra.erro || null
      }
    });
  } catch (_) {
    /* observe-only */
  }
}

module.exports = {
  publishLazyEvent,
  MAPA
};
