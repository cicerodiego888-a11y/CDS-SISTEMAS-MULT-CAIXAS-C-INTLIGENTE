'use strict';

/**
 * Adapter EquipmentEventBus — apenas subscribe/publish (observe-only).
 * @module observabilidade/adapters/equipmentAdapter
 */

const { CATEGORIAS, EVENT_NAMES, RESULTADOS } = require('../eventTypes');

const MAPA = Object.freeze({
  EquipmentOnline: EVENT_NAMES.EQUIPMENT_ONLINE,
  EquipmentOffline: EVENT_NAMES.EQUIPMENT_OFFLINE,
  EquipmentDiscovered: EVENT_NAMES.EQUIPMENT_DISCOVERED,
  EquipmentHealthChanged: EVENT_NAMES.EQUIPMENT_HEALTH_CHANGED,
  EquipmentSyncStarted: EVENT_NAMES.EQUIPMENT_SYNC_STARTED,
  EquipmentSyncFinished: EVENT_NAMES.EQUIPMENT_SYNC_FINISHED,
  EquipmentDiagnosticGenerated: EVENT_NAMES.EQUIPMENT_DIAGNOSTIC,
  HeartbeatFalhou: EVENT_NAMES.HEARTBEAT_FAILED
});

let unsub = null;

function mapEquipmentEvent(nome) {
  return MAPA[nome] || EVENT_NAMES.EQUIPMENT_EVENT;
}

/**
 * @param {object} registro
 * @param {{ publish?: Function }} [bus]
 */
function publishEquipmentRegistro(registro = {}, bus) {
  try {
    const eventBus = bus || require('../eventBus');
    const nome = registro.evento || registro.event || 'EQUIPMENT_EVENT';
    const isFail = /offline|falhou|fail|error/i.test(String(nome));
    eventBus.publish({
      event_name: mapEquipmentEvent(nome),
      categoria: CATEGORIAS.EQUIPAMENTOS,
      origem: 'equipamentos.eventBus',
      resultado: isFail ? RESULTADOS.ERRO : RESULTADOS.OK,
      correlation_id: registro.correlationId || registro.correlation_id || null,
      payload: {
        evento_origem: nome,
        equipamento_id:
          registro.equipamentoId
          || registro.equipamento_id
          || (registro.payload && (registro.payload.equipamentoId || registro.payload.id))
          || registro.id
          || null,
        status: registro.status || (registro.payload && registro.payload.status) || null,
        ts: registro.em || registro.ts || registro.timestamp || null
      }
    });
  } catch (_) {
    /* observe-only */
  }
}

/**
 * @returns {{ ok: boolean, reason?: string }}
 */
function iniciar() {
  if (unsub) return { ok: true, reason: 'already' };
  try {
    const eqBus = require('../../services/equipamentos-integracao/EquipmentEventBus');
    const handler = (registro) => publishEquipmentRegistro(registro);
    if (typeof eqBus.on === 'function') {
      eqBus.on('*', handler);
      unsub = () => {
        try { eqBus.off('*', handler); } catch (_) { /* ignore */ }
        unsub = null;
      };
      return { ok: true };
    }
    return { ok: false, reason: 'on_ausente' };
  } catch (err) {
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  }
}

function parar() {
  if (typeof unsub === 'function') unsub();
}

module.exports = {
  iniciar,
  parar,
  publishEquipmentRegistro,
  mapEquipmentEvent,
  MAPA
};
