'use strict';

/**
 * RC12.1 — Políticas de nível, criticidade e retenção.
 * @module observabilidade/eventPolicies
 */

const {
  NIVEIS,
  CRITICIDADES,
  EVENT_NAMES
} = require('./eventTypes');

const RETENCAO_POR_NIVEL = Object.freeze({
  [NIVEIS.DEBUG]: 3,
  [NIVEIS.INFO]: 30,
  [NIVEIS.WARN]: 90,
  [NIVEIS.ERROR]: 180,
  [NIVEIS.CRITICAL]: 365
});

/** Defaults por event_name quando o emitter não informar nível/criticidade */
const EVENT_DEFAULTS = Object.freeze({
  [EVENT_NAMES.BOOT_STARTED]: { nivel: NIVEIS.INFO, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.BOOT_DATABASE_READY]: { nivel: NIVEIS.INFO, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.BOOT_DATABASE_ERROR]: { nivel: NIVEIS.ERROR, criticidade: CRITICIDADES.ALTA },
  [EVENT_NAMES.BOOT_HTTP_LISTENING]: { nivel: NIVEIS.INFO, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.BOOT_BACKGROUND_START]: { nivel: NIVEIS.INFO, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.BOOT_BACKGROUND_STEP]: { nivel: NIVEIS.INFO, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.BOOT_BACKGROUND_READY]: { nivel: NIVEIS.INFO, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.BOOT_BACKGROUND_ERROR]: { nivel: NIVEIS.ERROR, criticidade: CRITICIDADES.ALTA },
  [EVENT_NAMES.BOOT_MIP_FLAG_READY]: { nivel: NIVEIS.INFO, criticidade: CRITICIDADES.BAIXA },

  [EVENT_NAMES.LAZY_SERVICE_INIT]: { nivel: NIVEIS.DEBUG, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.LAZY_SERVICE_CREATED]: { nivel: NIVEIS.INFO, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.LAZY_SERVICE_REUSED]: { nivel: NIVEIS.DEBUG, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.LAZY_SERVICE_ERROR]: { nivel: NIVEIS.ERROR, criticidade: CRITICIDADES.MEDIA },

  [EVENT_NAMES.CENTRAL_SYNC_ERRO]: { nivel: NIVEIS.ERROR, criticidade: CRITICIDADES.ALTA },
  [EVENT_NAMES.CENTRAL_ERRO]: { nivel: NIVEIS.ERROR, criticidade: CRITICIDADES.ALTA },

  [EVENT_NAMES.EQUIPMENT_OFFLINE]: { nivel: NIVEIS.WARN, criticidade: CRITICIDADES.ALTA },
  [EVENT_NAMES.HEARTBEAT_FAILED]: { nivel: NIVEIS.ERROR, criticidade: CRITICIDADES.ALTA },

  [EVENT_NAMES.SOAP_TIMEOUT]: { nivel: NIVEIS.ERROR, criticidade: CRITICIDADES.ALTA },
  [EVENT_NAMES.SOAP_FALHA]: { nivel: NIVEIS.ERROR, criticidade: CRITICIDADES.ALTA },
  [EVENT_NAMES.SOAP_HTTP_ERROR]: { nivel: NIVEIS.ERROR, criticidade: CRITICIDADES.ALTA },
  [EVENT_NAMES.SOAP_INICIADO]: { nivel: NIVEIS.DEBUG, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.SOAP_FINALIZADO]: { nivel: NIVEIS.INFO, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.SOAP_CSTAT]: { nivel: NIVEIS.INFO, criticidade: CRITICIDADES.BAIXA },

  [EVENT_NAMES.MIIP_IDENTIFY_FINISHED]: { nivel: NIVEIS.INFO, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.MIIP_HEALTH_DEGRADED]: { nivel: NIVEIS.WARN, criticidade: CRITICIDADES.MEDIA },

  [EVENT_NAMES.AUTH_LOGIN_DURATION]: { nivel: NIVEIS.INFO, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.MODULE_OPEN]: { nivel: NIVEIS.INFO, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.MODULE_LAZY_CREATED]: { nivel: NIVEIS.INFO, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.MODULE_LAZY_REUSED]: { nivel: NIVEIS.DEBUG, criticidade: CRITICIDADES.BAIXA },
  [EVENT_NAMES.MODULE_LAZY_ERROR]: { nivel: NIVEIS.ERROR, criticidade: CRITICIDADES.MEDIA },
  [EVENT_NAMES.RESOURCE_SAMPLE]: { nivel: NIVEIS.DEBUG, criticidade: CRITICIDADES.BAIXA }
});

/**
 * @param {string} nivel
 * @returns {number}
 */
function retencaoParaNivel(nivel) {
  return RETENCAO_POR_NIVEL[nivel] || RETENCAO_POR_NIVEL[NIVEIS.INFO];
}

/**
 * @param {object} partial
 * @returns {{ nivel: string, criticidade: string, retencao_dias: number, drop: boolean, reason?: string }}
 */
function applyPolicies(partial = {}) {
  const defaults = EVENT_DEFAULTS[partial.event_name] || {
    nivel: NIVEIS.INFO,
    criticidade: CRITICIDADES.BAIXA
  };

  const nivel = NIVEIS[partial.nivel] || (
    Object.values(NIVEIS).includes(partial.nivel) ? partial.nivel : defaults.nivel
  );
  const critKey = String(partial.criticidade || '').toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const criticidade = CRITICIDADES[critKey]
    || (Object.values(CRITICIDADES).includes(partial.criticidade) ? partial.criticidade : defaults.criticidade);

  if (!Object.values(NIVEIS).includes(nivel)) {
    return {
      nivel: NIVEIS.INFO,
      criticidade: CRITICIDADES.BAIXA,
      retencao_dias: retencaoParaNivel(NIVEIS.INFO),
      drop: true,
      reason: 'nivel_invalido'
    };
  }

  const retencao_dias = Number.isFinite(Number(partial.retencao_dias))
    ? Number(partial.retencao_dias)
    : retencaoParaNivel(nivel);

  return {
    nivel,
    criticidade,
    retencao_dias,
    drop: false
  };
}

/**
 * Decide se o evento deve ser logado no console estruturado OBS.
 * @param {object} envelope
 * @returns {boolean}
 */
function shouldLogPublish(envelope) {
  if (!envelope) return false;
  if (envelope.nivel === NIVEIS.DEBUG) {
    return process.env.CDS_OBS_DEBUG === '1';
  }
  return true;
}

module.exports = {
  RETENCAO_POR_NIVEL,
  EVENT_DEFAULTS,
  retencaoParaNivel,
  applyPolicies,
  shouldLogPublish
};
