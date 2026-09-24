/**
 * infCpl da NF-e (TString do schema): ASCII imprimível seguro.
 * Remove Unicode fora do conjunto (ex.: U+2013) antes de gravar o XML.
 */

'use strict';

const TSTRING_SCHEMA = /^[!-\u00FF](?:[ -\u00FF]{0,4999})$/;

function sanitizarInfCplNfe(texto) {
  let s = String(texto == null ? '' : texto);
  s = s.replace(/\r\n|\r|\n/g, ' ');
  s = s.replace(/[\u2010-\u2015\u2212]/g, '-');
  s = s.replace(/[\u2018\u2019\u201A\u2032]/g, "'");
  s = s.replace(/[\u201C\u201D\u201E\u2033]/g, '"');
  s = s.replace(/\u2026/g, '...');
  s = s.replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/g, ' ');
  s = s.replace(/[º°]/g, 'o');
  s = s.replace(/[ª]/g, 'a');
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[^\x20-\x7E]/g, '');
  s = s.replace(/[ \t]+/g, ' ').trim();
  if (s.length > 5000) s = s.slice(0, 5000);
  return s;
}

function infCplAceitoPeloSchema(texto) {
  const s = String(texto == null ? '' : texto);
  if (!s || s.length > 5000) return false;
  if (/[\x00-\x1F\x7F]/.test(s)) return false;
  if (/[^\x20-\x7E]/.test(s)) return false;
  return TSTRING_SCHEMA.test(s);
}

module.exports = {
  sanitizarInfCplNfe,
  infCplAceitoPeloSchema,
  TSTRING_SCHEMA
};
