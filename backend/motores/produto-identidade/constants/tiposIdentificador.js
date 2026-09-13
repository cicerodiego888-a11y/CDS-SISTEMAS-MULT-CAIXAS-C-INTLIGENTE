/**
 * Tipos oficiais de identificador — MIP V1 (Sprint 01).
 * @module motores/produto-identidade/constants/tiposIdentificador
 */

const TIPOS_IDENTIFICADOR = Object.freeze({
  INTERNO: 'INTERNO',
  ID: 'ID',
  EAN8: 'EAN8',
  EAN13: 'EAN13',
  GTIN: 'GTIN',
  PLU: 'PLU',
  /** Compatibilidade MGV6 / TXITENS — NÃO confundir com PLU, EAN ou GTIN comercial */
  MGV6: 'MGV6',
  FORNECEDOR: 'FORNECEDOR',
  SKU_MARKETPLACE: 'SKU_MARKETPLACE',
  QR: 'QR',
  GS1_DATABAR: 'GS1_DATABAR',
  RFID: 'RFID',
  LEGADO: 'LEGADO',
  OUTRO: 'OUTRO'
});

const TIPOS_LISTA = Object.freeze(Object.values(TIPOS_IDENTIFICADOR));

const ESCOPOS = Object.freeze({
  GLOBAL: 'GLOBAL',
  FORNECEDOR: 'FORNECEDOR',
  MARKETPLACE: 'MARKETPLACE',
  TERMINAL: 'TERMINAL'
});

function isTipoValido(tipo) {
  return TIPOS_LISTA.includes(String(tipo || '').toUpperCase());
}

module.exports = {
  TIPOS_IDENTIFICADOR,
  TIPOS_LISTA,
  ESCOPOS,
  isTipoValido
};
