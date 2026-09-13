/**
 * Sprint 14.15.1 / RC14.15.4 — Defaults e normalização da configuração MGV6.
 * Arquivo operacional: TXITENS.TXT | registro: 320 caracteres.
 */

'use strict';

const { MGV6Error, CODES } = require('./MGV6Errors');

/** Chave em equipamentos_configuracoes */
const CHAVE_CONFIG = 'mgv6.config';

/** Tamanho fixo de cada registro TXITENS (não inclui CRLF). */
const REGISTRO_LENGTH = 320;

/** Área de descrição + padding: posições 20–319. */
const DESCRICAO_AREA_LENGTH = 300;

/** Prefixo fixo tipo+código+campo numérico (posições 0–19). */
const CABECALHO_LENGTH = 20;

/**
 * Comprimento máximo da descrição comprovado no TX legado
 * (ex.: Carne Congelada... → "...Maminha Da Alca" = 50 chars).
 * Truncamento por caracteres; área estrutural permanece 300 (pos 20–319).
 */
const DESCRICAO_MAX_LEGADO = 50;

/** Nome operacional do Bridge MGV6. */
const FILE_NAME_OPERACIONAL = 'TXITENS.TXT';

/** Layout físico baseado no arquivo real do cliente (RC14.15.5). */
const LAYOUT_ID = 'MGV6-REAL-CLIENT-V1';

/**
 * Defaults de compatibilidade (não contrato oficial MGV6).
 */
const DEFAULTS = Object.freeze({
  enabled: false,
  exportFolder: '',
  mgv6Executable: '',
  fileName: FILE_NAME_OPERACIONAL,
  encoding: 'WINDOWS-1252',
  lineEnding: 'CRLF',
  autoLaunch: false,
  modoVariavel: 'VALOR',
  digitosPlu: 6,
  prefixoEtiqueta: '2',
  diferenciarPesoUnidade: false,
  /** Prefixo fixo observado nas amostras / arquivo real */
  tipoRegistro: '01',
  /** Truncamento legado comprovado (caracteres) */
  descricaoMaxLength: DESCRICAO_MAX_LEGADO,
  /** Máximo de dígitos no código do TXT (formato comprovado = 9) */
  codigoDigitos: 9,
  /** Centavos representáveis em 5 dígitos do campo numérico 11–19 */
  precoCentavosMax: 99999,
  registroLength: REGISTRO_LENGTH,
  layout: LAYOUT_ID
});

const ENCODINGS = Object.freeze(['WINDOWS-1252', 'UTF-8']);
const LINE_ENDINGS = Object.freeze({
  CRLF: '\r\n',
  LF: '\n',
  CR: '\r'
});
const MODOS = Object.freeze(['VALOR', 'PESO']);

/**
 * CDS.TXT legado → TXITENS.TXT operacional.
 * @param {*} raw
 * @returns {string}
 */
function resolverFileNameOperacional(raw) {
  const n = raw != null ? String(raw).trim() : '';
  if (!n) return FILE_NAME_OPERACIONAL;
  if (/^cds\.txt$/i.test(n)) return FILE_NAME_OPERACIONAL;
  return n;
}

/**
 * @param {*} raw
 * @returns {object}
 */
function normalizar(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const encoding = String(src.encoding || DEFAULTS.encoding).toUpperCase().replace(/_/g, '-');
  const encNorm = encoding === 'UTF8' ? 'UTF-8' : encoding;
  const lineKey = String(src.lineEnding || DEFAULTS.lineEnding).toUpperCase();
  const modo = String(src.modoVariavel || DEFAULTS.modoVariavel).toUpperCase();

  const digitosPlu = Number(src.digitosPlu != null ? src.digitosPlu : DEFAULTS.digitosPlu);
  const descricaoMax = src.descricaoMaxLength != null && src.descricaoMaxLength !== ''
    ? Number(src.descricaoMaxLength)
    : DEFAULTS.descricaoMaxLength;

  return {
    enabled: src.enabled === true || src.enabled === 1 || src.enabled === '1' || src.enabled === 'true',
    exportFolder: src.exportFolder != null ? String(src.exportFolder).trim() : DEFAULTS.exportFolder,
    mgv6Executable: src.mgv6Executable != null ? String(src.mgv6Executable).trim() : DEFAULTS.mgv6Executable,
    fileName: resolverFileNameOperacional(
      src.fileName != null && String(src.fileName).trim()
        ? String(src.fileName).trim()
        : DEFAULTS.fileName
    ),
    encoding: ENCODINGS.includes(encNorm) ? encNorm : DEFAULTS.encoding,
    lineEnding: LINE_ENDINGS[lineKey] ? lineKey : DEFAULTS.lineEnding,
    autoLaunch: src.autoLaunch === true || src.autoLaunch === 1 || src.autoLaunch === '1' || src.autoLaunch === 'true',
    modoVariavel: MODOS.includes(modo) ? modo : DEFAULTS.modoVariavel,
    digitosPlu: Number.isFinite(digitosPlu) && digitosPlu > 0 ? Math.floor(digitosPlu) : DEFAULTS.digitosPlu,
    prefixoEtiqueta: src.prefixoEtiqueta != null && String(src.prefixoEtiqueta).trim() !== ''
      ? String(src.prefixoEtiqueta).trim()
      : DEFAULTS.prefixoEtiqueta,
    diferenciarPesoUnidade: src.diferenciarPesoUnidade === true
      || src.diferenciarPesoUnidade === 1
      || src.diferenciarPesoUnidade === '1'
      || src.diferenciarPesoUnidade === 'true',
    tipoRegistro: src.tipoRegistro != null && String(src.tipoRegistro).trim() !== ''
      ? String(src.tipoRegistro).trim()
      : DEFAULTS.tipoRegistro,
    descricaoMaxLength: Number.isFinite(descricaoMax) && descricaoMax > 0
      ? Math.floor(descricaoMax)
      : DESCRICAO_MAX_LEGADO,
    codigoDigitos: DEFAULTS.codigoDigitos,
    precoCentavosMax: DEFAULTS.precoCentavosMax,
    registroLength: REGISTRO_LENGTH,
    layout: LAYOUT_ID
  };
}

/**
 * @param {object} config
 * @returns {string}
 */
function resolverLineEnding(config) {
  const key = String(config?.lineEnding || DEFAULTS.lineEnding).toUpperCase();
  return LINE_ENDINGS[key] || LINE_ENDINGS.CRLF;
}

/**
 * @param {*} raw
 * @returns {object}
 */
function assertConfigShape(raw) {
  const cfg = normalizar(raw);
  if (!ENCODINGS.includes(cfg.encoding)) {
    throw MGV6Error.fromCode(CODES.CONFIG_INVALID, `Encoding não suportado: ${cfg.encoding}`);
  }
  if (!LINE_ENDINGS[cfg.lineEnding]) {
    throw MGV6Error.fromCode(CODES.CONFIG_INVALID, `lineEnding inválido: ${cfg.lineEnding}`);
  }
  if (!MODOS.includes(cfg.modoVariavel)) {
    throw MGV6Error.fromCode(CODES.CONFIG_INVALID, `modoVariavel inválido: ${cfg.modoVariavel}`);
  }
  if (!/^\d{2}$/.test(cfg.tipoRegistro)) {
    throw MGV6Error.fromCode(
      CODES.CONFIG_INVALID,
      'tipoRegistro deve ter 2 dígitos numéricos (default observado: 01)'
    );
  }
  return cfg;
}

module.exports = {
  CHAVE_CONFIG,
  REGISTRO_LENGTH,
  DESCRICAO_AREA_LENGTH,
  DESCRICAO_MAX_LEGADO,
  CABECALHO_LENGTH,
  FILE_NAME_OPERACIONAL,
  LAYOUT_ID,
  DEFAULTS,
  ENCODINGS,
  LINE_ENDINGS,
  MODOS,
  resolverFileNameOperacional,
  normalizar,
  resolverLineEnding,
  assertConfigShape
};
