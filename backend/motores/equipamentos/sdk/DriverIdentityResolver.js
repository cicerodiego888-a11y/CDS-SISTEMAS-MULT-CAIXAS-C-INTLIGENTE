/**
 * RC14.14.3 — DriverIdentityResolver
 * Única autoridade de identidade do Driver Toledo Prix IV Uno.
 *
 * Código oficial ERP: TOLEDO_PRIX4_UNO
 * Aliases aceitos: TOLEDO_PRIX4, toledo-prix4
 */

'use strict';

const CODIGO_OFICIAL = 'TOLEDO_PRIX4_UNO';
const CODIGO_SDK = 'toledo-prix4';
const NOME_EXIBICAO = 'Toledo Prix IV Uno';
const FABRICANTE = 'Toledo';
const MODELO = 'Prix IV Uno';

/** Todos os aliases conhecidos (inclui o canônico). */
const ALIASES = Object.freeze([
  CODIGO_OFICIAL,
  'TOLEDO_PRIX4',
  CODIGO_SDK,
  'TOLEDO-PRIX4',
  'toledo_prix4'
]);

const ALIAS_SET = new Set(ALIASES.map((a) => String(a).toLowerCase()));

/**
 * Normaliza entrada para lookup.
 * @param {*} raw
 * @returns {string}
 */
function normalizar(raw) {
  return String(raw || '').trim();
}

/**
 * @param {*} raw
 * @returns {boolean}
 */
function ehToledo(raw) {
  const s = normalizar(raw);
  if (!s) return false;
  if (ALIAS_SET.has(s.toLowerCase())) return true;
  // Heurística: strings Toledo Prix
  const u = s.toUpperCase().replace(/[-\s]+/g, '_');
  return u === 'TOLEDO_PRIX4' || u === 'TOLEDO_PRIX4_UNO' || u === 'TOLEDO_PRIXIV' || u === 'TOLEDO_PRIX_IV';
}

/**
 * Resolve qualquer alias → código oficial ERP.
 * Códigos de outros fabricantes passam intactos (uppercase se já snake).
 * @param {*} raw
 * @returns {string}
 */
function canonical(raw) {
  const s = normalizar(raw);
  if (!s) return '';
  if (ehToledo(s)) return CODIGO_OFICIAL;
  if (/^[A-Z0-9_]+$/.test(s)) return s;
  // kebab → UPPER_SNAKE genérico (não Toledo)
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
}

/** @deprecated alias de canonical */
function canonicalize(raw) {
  return canonical(raw);
}

/**
 * Identidade completa.
 * @param {*} raw
 * @returns {{
 *   codigo: string,
 *   codigo_sdk: string|null,
 *   nome_exibicao: string,
 *   fabricante: string|null,
 *   modelo: string|null,
 *   aliases: string[],
 *   runtimeModule: string|null,
 *   pluginModule: string|null,
 *   oficial: boolean
 * }}
 */
function resolve(raw) {
  const s = normalizar(raw);
  if (ehToledo(s) || !s) {
    return {
      codigo: CODIGO_OFICIAL,
      codigo_sdk: CODIGO_SDK,
      nome_exibicao: NOME_EXIBICAO,
      fabricante: FABRICANTE,
      modelo: MODELO,
      aliases: [...ALIASES],
      runtimeModule: 'toledo/ToledoPrixIVDriver',
      pluginModule: 'toledo/prix4/ToledoPrix4UnoDriver',
      oficial: true,
      entrada: s || null
    };
  }
  const codigo = canonical(s);
  return {
    codigo,
    codigo_sdk: /[a-z]/.test(s) ? s : null,
    nome_exibicao: codigo,
    fabricante: null,
    modelo: null,
    aliases: [codigo],
    runtimeModule: null,
    pluginModule: null,
    oficial: false,
    entrada: s
  };
}

function codigoSdk(raw) {
  return ehToledo(raw) ? CODIGO_SDK : (resolve(raw).codigo_sdk || null);
}

function nomeExibicao(raw) {
  return ehToledo(raw) ? NOME_EXIBICAO : (resolve(raw).nome_exibicao || canonical(raw));
}

/**
 * Instancia o Driver runtime oficial (90AX / Central / Ops).
 * @param {object} [config]
 */
function criarRuntimeDriver(config = {}) {
  // eslint-disable-next-line global-require
  const ToledoPrixIVDriver = require('../drivers/toledo/ToledoPrixIVDriver');
  return new ToledoPrixIVDriver(config);
}

/**
 * Classe plugin BaseDriver (Discovery / catálogo legado).
 */
function obterPluginClass() {
  // eslint-disable-next-line global-require
  return require('../drivers/toledo/prix4/ToledoPrix4UnoDriver');
}

/**
 * Registra aliases nos registries após o load.
 * @param {{registrarAlias?: Function, buscar?: Function}} legacyReg
 * @param {{registrarAlias?: Function, buscar?: Function, registrar?: Function}} sdkReg
 */
function aplicarAliasesNosRegistries(legacyReg, sdkReg) {
  if (legacyReg && typeof legacyReg.registrarAlias === 'function') {
    for (const alias of ALIASES) {
      if (alias === CODIGO_OFICIAL) continue;
      try {
        legacyReg.registrarAlias(CODIGO_OFICIAL, alias);
      } catch (_) { /* ignore */ }
    }
  }
  if (sdkReg && typeof sdkReg.registrarAlias === 'function') {
    const profile = sdkReg.buscar?.(CODIGO_SDK) || sdkReg.buscar?.(CODIGO_OFICIAL);
    if (profile) {
      for (const alias of [CODIGO_OFICIAL, 'TOLEDO_PRIX4', CODIGO_SDK]) {
        try {
          sdkReg.registrarAlias(profile.id || CODIGO_SDK, alias);
        } catch (_) { /* ignore */ }
      }
    }
  }
}

module.exports = {
  CODIGO_OFICIAL,
  CODIGO_SDK,
  NOME_EXIBICAO,
  FABRICANTE,
  MODELO,
  ALIASES,
  normalizar,
  ehToledo,
  canonical,
  canonicalize,
  resolve,
  codigoSdk,
  nomeExibicao,
  criarRuntimeDriver,
  obterPluginClass,
  aplicarAliasesNosRegistries
};
