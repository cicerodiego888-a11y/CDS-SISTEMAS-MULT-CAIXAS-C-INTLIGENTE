/**
 * Sprint 14.9 — ToledoWeightValidator
 */

'use strict';

const frameParser = require('../ToledoFrameParser');
const { WeightError, CODES } = require('./ToledoWeightErrors');

const UNIDADES = new Set(['kg', 'g', 'un']);

/**
 * Valida frame bruto (estrutura + checksum) via FrameParser Lab V1.
 * @param {Buffer|string} raw
 */
function validateFrame(raw) {
  const r = frameParser.validate(raw);
  if (!r.ok) {
    if (r.code === 'CHECKSUM_ERROR' || String(r.error || '').includes('Checksum')) {
      throw WeightError.fromCode(CODES.CHECKSUM_ERROR, r.error || 'Checksum inválido', {
        statusCode: 502
      });
    }
    throw WeightError.fromCode(CODES.FRAME_INVALID, r.error || 'Frame incompleto', {
      statusCode: 502
    });
  }
  return true;
}

/**
 * Valida objeto de domínio de peso.
 * @param {{peso:number, unidade:string, estabilidade?:boolean}} weight
 */
function validate(weight) {
  const erros = [];
  if (!weight || typeof weight !== 'object') {
    erros.push('Objeto de peso ausente');
  } else {
    if (!Number.isFinite(Number(weight.peso))) {
      erros.push('Peso deve ser numérico');
    } else if (Number(weight.peso) < 0) {
      erros.push('Peso deve ser ≥ 0');
    }
    const u = String(weight.unidade || '').toLowerCase();
    if (!UNIDADES.has(u)) {
      erros.push(`Unidade inválida: ${weight.unidade}`);
    }
  }
  return { ok: erros.length === 0, erros };
}

function assertValid(weight) {
  const r = validate(weight);
  if (!r.ok) {
    const msg = r.erros.join('; ');
    const code = msg.includes('≥ 0') || msg.includes('negativ')
      ? CODES.WEIGHT_NEGATIVE
      : CODES.WEIGHT_INVALID;
    throw WeightError.fromCode(code, msg, { statusCode: 422, erros: r.erros });
  }
  return true;
}

module.exports = {
  validate,
  assertValid,
  validateFrame,
  UNIDADES
};
