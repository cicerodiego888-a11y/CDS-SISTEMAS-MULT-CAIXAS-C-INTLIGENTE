/**
 * RC14.13.2 / RC14.14.3 — DriverAdapter
 *
 * Converte Device Profile SDK → Contrato Oficial ERP.
 * Identidade Toledo via DriverIdentityResolver (código oficial TOLEDO_PRIX4_UNO).
 */

'use strict';

const identity = require('./DriverIdentityResolver');

/**
 * Converte id SDK kebab-case em codigo UPPER_SNAKE (sem resolver aliases Toledo).
 * Ex.: toledo-prix4 → TOLEDO_PRIX4
 * @param {string} id
 * @returns {string}
 */
function sdkIdParaCodigoLegado(id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  if (/^[A-Z0-9_]+$/.test(raw)) return raw;
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
}

/**
 * Normaliza status SDK → rótulo ERP.
 * @param {string} status
 * @returns {string}
 */
function normalizarStatus(status) {
  const s = String(status || '').toLowerCase().trim();
  if (!s) return 'estrutura';
  if (s === 'homologacao' || s === 'homologado' || s === 'certified') return 'homologado';
  if (s === 'producao' || s === 'production' || s === 'pronto') return 'producao';
  if (s === 'desenvolvimento' || s === 'dev') return 'desenvolvimento';
  if (s === 'descontinuado' || s === 'deprecated') return 'descontinuado';
  if (s === 'estrutura' || s === 'scaffold') return 'estrutura';
  return s;
}

/**
 * Extrai lista de transportes a partir do profile SDK (ou legado).
 * @param {Object} src
 * @returns {string[]}
 */
function extrairTransportes(src) {
  if (Array.isArray(src.transportes) && src.transportes.length) {
    return src.transportes.map((t) => String(t).toLowerCase()).filter(Boolean);
  }
  if (src.transporte) {
    return [String(src.transporte).toLowerCase()].filter(Boolean);
  }
  return [];
}

/**
 * Ativo: status operacional (não descontinuado / não erro).
 * @param {Object} src
 * @returns {boolean}
 */
function resolverAtivo(src) {
  if (typeof src.ativo === 'boolean') return src.ativo;
  const st = String(src.status || src.estado || '').toLowerCase();
  if (st === 'descontinuado' || st === 'deprecated' || st === 'erro' || st === 'error') {
    return false;
  }
  return true;
}

/**
 * Converte um driver/profile SDK (ou objeto parcial) para o contrato ERP oficial.
 *
 * @param {Object|null|undefined} profile
 * @returns {Object|null}
 */
function paraContratoErp(profile) {
  if (!profile || typeof profile !== 'object') return null;

  const json = typeof profile.toJSON === 'function' ? profile.toJSON() : profile;
  const codigoSdkRaw = String(json.codigo || json.id || json.codigo_sdk || '').trim();
  const meta = json.meta && typeof json.meta === 'object' ? { ...json.meta } : {};

  const candidato = meta.catalogoLegado
    || json.codigo_legado
    || json.codigoLegado
    || (json.codigo && /^[A-Z0-9_]+$/.test(String(json.codigo)) ? json.codigo : '')
    || codigoSdkRaw;

  const id = identity.resolve(candidato || codigoSdkRaw);
  const codigoOficial = id.oficial
    ? identity.CODIGO_OFICIAL
    : (identity.canonical(candidato) || sdkIdParaCodigoLegado(codigoSdkRaw));

  const codigoSdk = id.oficial
    ? identity.CODIGO_SDK
    : (codigoSdkRaw || null);

  if (id.oficial) {
    meta.catalogoLegado = identity.CODIGO_OFICIAL;
    meta.fingerprintDriver = identity.CODIGO_OFICIAL;
  }

  const transportes = extrairTransportes(json);
  const nomeExibicao = id.oficial
    ? identity.NOME_EXIBICAO
    : String(
      json.nome_exibicao
      || json.nomeExibicao
      || json.nome
      || [json.fabricante, json.modelo].filter(Boolean).join(' ')
      || codigoOficial
      || codigoSdk
    ).trim();

  const status = normalizarStatus(json.status || json.estado);

  return {
    id: json.id || codigoSdk || codigoOficial,
    codigo: codigoOficial,
    codigo_sdk: codigoSdk,
    nome_exibicao: nomeExibicao,
    nome: nomeExibicao,
    fabricante: id.oficial ? identity.FABRICANTE : (json.fabricante || null),
    modelo: id.oficial ? identity.MODELO : (json.modelo || null),
    categoria: json.categoria || 'balanca',
    transporte: transportes[0] || null,
    transportes,
    ativo: resolverAtivo(json),
    status,
    versao: json.versao || null,
    protocolo: json.protocolo || null,
    protocolos: Array.isArray(json.protocolos) ? json.protocolos : [],
    capabilities: json.capabilities || null,
    meta,
    implementado: json.implementado != null ? Boolean(json.implementado) : undefined,
    registrado: json.registrado != null ? Boolean(json.registrado) : true,
    equipamentosCount: json.equipamentosCount != null ? Number(json.equipamentosCount) : undefined,
    origem: 'erp-contrato-oficial',
    fonte: 'device-profile-sdk'
  };
}

/**
 * @param {Array} lista
 * @returns {Array}
 */
function paraContratoErpLista(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.map(paraContratoErp).filter(Boolean);
}

module.exports = {
  paraContratoErp,
  paraContratoErpLista,
  sdkIdParaCodigoLegado,
  normalizarStatus,
  extrairTransportes
};
