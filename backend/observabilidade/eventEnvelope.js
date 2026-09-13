'use strict';

/**
 * RC12.1 — Envelope oficial obs.v1
 * @module observabilidade/eventEnvelope
 */

const {
  SCHEMA_VERSION,
  CATEGORIAS,
  NIVEIS,
  CRITICIDADES,
  RESULTADOS
} = require('./eventTypes');
const { applyPolicies } = require('./eventPolicies');
const { sanitizePayload } = require('./eventSanitizer');

const CAMPOS_OBRIGATORIOS = Object.freeze([
  'event_name',
  'categoria',
  'origem',
  'nivel',
  'criticidade',
  'timestamp',
  'payload',
  'versao_schema',
  'retencao_dias'
]);

function agoraIso() {
  return new Date().toISOString();
}

/**
 * @param {object} input
 * @returns {{ ok: true, envelope: object, sanitized: boolean } | { ok: false, errors: string[], dropReason?: string }}
 */
function buildEnvelope(input = {}) {
  const errors = [];

  if (!input.event_name || typeof input.event_name !== 'string') {
    errors.push('event_name obrigatório');
  }
  if (!input.categoria || typeof input.categoria !== 'string') {
    errors.push('categoria obrigatória');
  } else if (!Object.values(CATEGORIAS).includes(input.categoria)) {
    errors.push(`categoria inválida: ${input.categoria}`);
  }
  if (!input.origem || typeof input.origem !== 'string') {
    errors.push('origem obrigatória');
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  const policy = applyPolicies(input);
  if (policy.drop) {
    return { ok: false, errors: [policy.reason || 'policy_drop'], dropReason: policy.reason };
  }

  const { payload, sanitized } = sanitizePayload(input.payload || {});

  let resultado = input.resultado ?? null;
  if (resultado != null && !Object.values(RESULTADOS).includes(resultado)) {
    const map = {
      success: RESULTADOS.OK,
      sucesso: RESULTADOS.OK,
      ok: RESULTADOS.OK,
      error: RESULTADOS.ERRO,
      erro: RESULTADOS.ERRO,
      fail: RESULTADOS.ERRO,
      timeout: RESULTADOS.TIMEOUT,
      parcial: RESULTADOS.PARCIAL
    };
    resultado = map[String(resultado).toLowerCase()] || null;
  }

  const envelope = {
    event_name: String(input.event_name),
    categoria: input.categoria,
    origem: String(input.origem),
    nivel: policy.nivel,
    criticidade: policy.criticidade,
    timestamp: input.timestamp || input.ts || agoraIso(),
    correlation_id: input.correlation_id ?? input.correlationId ?? null,
    request_id: input.request_id ?? input.requestId ?? null,
    usuario_id: input.usuario_id ?? input.usuarioId ?? null,
    terminal_id: input.terminal_id ?? input.terminalId ?? null,
    duracao_ms: input.duracao_ms != null
      ? Number(input.duracao_ms)
      : (input.duracaoMs != null ? Number(input.duracaoMs) : null),
    resultado,
    payload,
    versao_schema: SCHEMA_VERSION,
    retencao_dias: policy.retencao_dias
  };

  if (envelope.duracao_ms != null && !Number.isFinite(envelope.duracao_ms)) {
    envelope.duracao_ms = null;
  }

  for (const campo of CAMPOS_OBRIGATORIOS) {
    if (campo === 'payload') {
      if (typeof envelope.payload !== 'object' || envelope.payload == null) {
        errors.push('payload obrigatório');
      }
      continue;
    }
    if (envelope[campo] === undefined || envelope[campo] === null || envelope[campo] === '') {
      errors.push(`${campo} obrigatório após normalização`);
    }
  }

  if (!Object.values(NIVEIS).includes(envelope.nivel)) {
    errors.push('nivel inválido');
  }
  if (!Object.values(CRITICIDADES).includes(envelope.criticidade)) {
    errors.push('criticidade inválida');
  }
  if (envelope.versao_schema !== SCHEMA_VERSION) {
    errors.push('versao_schema deve ser obs.v1');
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  return { ok: true, envelope, sanitized };
}

/**
 * @param {object} envelope
 * @returns {string[]}
 */
function validateEnvelope(envelope) {
  const errors = [];
  for (const campo of CAMPOS_OBRIGATORIOS) {
    if (envelope == null || envelope[campo] === undefined || envelope[campo] === null || envelope[campo] === '') {
      if (campo === 'payload' && envelope && typeof envelope.payload === 'object') continue;
      errors.push(`${campo} ausente`);
    }
  }
  if (envelope && envelope.versao_schema !== SCHEMA_VERSION) {
    errors.push('versao_schema inválida');
  }
  return errors;
}

module.exports = {
  CAMPOS_OBRIGATORIOS,
  buildEnvelope,
  validateEnvelope,
  SCHEMA_VERSION
};
