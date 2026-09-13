/**
 * Sprint 14.11 — ToledoConfigurationValidator
 */

'use strict';

const profile = require('./ToledoConfigurationProfile');
const { ConfigurationError, CODES } = require('./ToledoConfigurationErrors');

function coerce(meta, valor) {
  if (meta.tipo === 'number') return Number(valor);
  if (meta.tipo === 'boolean') {
    if (typeof valor === 'boolean') return valor;
    if (valor === '1' || valor === 'true' || valor === 1) return true;
    if (valor === '0' || valor === 'false' || valor === 0) return false;
    return Boolean(valor);
  }
  if (meta.tipo === 'enum' || meta.tipo === 'string') return String(valor);
  return valor;
}

/**
 * @param {object} parametros
 * @param {{allowReadonly?:boolean, onlyEditable?:boolean}} [opcoes]
 */
function validate(parametros = {}, opcoes = {}) {
  const erros = [];
  const src = parametros.parametros || parametros;

  for (const [key, valor] of Object.entries(src)) {
    const meta = profile.getMeta(key);
    if (!meta) {
      erros.push({ parametro: key, code: CODES.UNKNOWN_PARAM, message: `Parâmetro desconhecido: ${key}` });
      continue;
    }
    if (opcoes.onlyEditable && !meta.editavel) {
      erros.push({
        parametro: key,
        code: CODES.READONLY_PARAM,
        message: `Parâmetro somente leitura: ${key}`
      });
      continue;
    }
    if (!opcoes.allowReadonly && !meta.editavel && valor !== undefined) {
      // leitura/compare pode incluir readonly; write não
      if (opcoes.writing) {
        erros.push({
          parametro: key,
          code: CODES.READONLY_PARAM,
          message: `Não é permitido alterar: ${key}`
        });
        continue;
      }
    }

    const coerced = coerce(meta, valor);
    if (meta.tipo === 'number') {
      if (!Number.isFinite(coerced)) {
        erros.push({ parametro: key, code: CODES.TYPE_INVALID, message: `${key} deve ser numérico` });
      } else if ((meta.min != null && coerced < meta.min) || (meta.max != null && coerced > meta.max)) {
        erros.push({
          parametro: key,
          code: CODES.OUT_OF_RANGE,
          message: `${key} fora da faixa [${meta.min}, ${meta.max}]`
        });
      }
    } else if (meta.tipo === 'boolean' && typeof coerced !== 'boolean') {
      erros.push({ parametro: key, code: CODES.TYPE_INVALID, message: `${key} deve ser boolean` });
    } else if (meta.tipo === 'enum' && !(meta.valores || []).includes(String(coerced))) {
      erros.push({
        parametro: key,
        code: CODES.OUT_OF_RANGE,
        message: `${key} inválido; use: ${(meta.valores || []).join(', ')}`
      });
    }
  }

  // obrigatórios em write completo
  if (opcoes.requireAll) {
    for (const meta of Object.values(profile.PARAMETROS_META)) {
      if (meta.obrigatorio && meta.editavel && src[meta.nome] === undefined) {
        erros.push({
          parametro: meta.nome,
          code: CODES.INVALID_INPUT,
          message: `Obrigatório: ${meta.nome}`
        });
      }
    }
  }

  return { ok: erros.length === 0, erros };
}

function assertValid(parametros, opcoes = {}) {
  const r = validate(parametros, opcoes);
  if (!r.ok) {
    const first = r.erros[0];
    throw ConfigurationError.fromCode(
      first.code || CODES.INVALID_INPUT,
      r.erros.map((e) => e.message).join('; '),
      { statusCode: 422, erros: r.erros }
    );
  }
  return true;
}

/**
 * Filtra só editáveis para escrita.
 */
function filterWritable(parametros = {}) {
  const src = parametros.parametros || parametros;
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (profile.isEditable(k)) out[k] = v;
  }
  return out;
}

module.exports = {
  validate,
  assertValid,
  filterWritable,
  coerce
};
