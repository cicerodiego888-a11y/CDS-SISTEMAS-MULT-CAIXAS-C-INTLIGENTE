/**
 * Sprint 14.15.1 — Encoding do Bridge MGV6.
 * Produz Buffer; default WINDOWS-1252 (compatibilidade inicial).
 */

'use strict';

const { MGV6Error, CODES } = require('./MGV6Errors');

/** Diferenças WINDOWS-1252 vs Latin-1 (0x80–0x9F) */
const CP1252_EXTRA = Object.freeze({
  0x20AC: 0x80, // €
  0x201A: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201E: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02C6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8A, // Š
  0x2039: 0x8B, // ‹
  0x0152: 0x8C, // Œ
  0x017D: 0x8E, // Ž
  0x2018: 0x91, // ‘
  0x2019: 0x92, // ’
  0x201C: 0x93, // “
  0x201D: 0x94, // ”
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02DC: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9A, // š
  0x203A: 0x9B, // ›
  0x0153: 0x9C, // œ
  0x017E: 0x9E, // ž
  0x0178: 0x9F  // Ÿ
});

/**
 * @param {string} text
 * @returns {Buffer}
 */
function encodeWindows1252(text) {
  const s = String(text ?? '');
  const out = Buffer.allocUnsafe(s.length);
  for (let i = 0; i < s.length; i += 1) {
    const cp = s.charCodeAt(i);
    if (cp <= 0x7F) {
      out[i] = cp;
      continue;
    }
    if (cp >= 0xA0 && cp <= 0xFF) {
      out[i] = cp;
      continue;
    }
    const mapped = CP1252_EXTRA[cp];
    if (mapped != null) {
      out[i] = mapped;
      continue;
    }
    throw MGV6Error.fromCode(
      CODES.ENCODING_ERROR,
      `Caractere não representável em WINDOWS-1252 (U+${cp.toString(16).toUpperCase().padStart(4, '0')})`,
      { statusCode: 400, charIndex: i }
    );
  }
  return out;
}

/**
 * @param {string} text
 * @param {string} encoding
 * @returns {Buffer}
 */
function encodeText(text, encoding) {
  const enc = String(encoding || 'WINDOWS-1252').toUpperCase().replace(/_/g, '-');
  const normalized = enc === 'UTF8' ? 'UTF-8' : enc;
  if (normalized === 'UTF-8') {
    return Buffer.from(String(text ?? ''), 'utf8');
  }
  if (normalized === 'WINDOWS-1252' || normalized === 'CP1252' || normalized === 'ANSI') {
    return encodeWindows1252(text);
  }
  throw MGV6Error.fromCode(CODES.ENCODING_ERROR, `Encoding não suportado: ${encoding}`);
}

module.exports = {
  encodeText,
  encodeWindows1252,
  CP1252_EXTRA
};
