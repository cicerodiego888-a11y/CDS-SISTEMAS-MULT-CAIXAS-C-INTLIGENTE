/**
 * Sprint 15.2 — ToledoChecksum
 * Cálculo e validação centralizados do checksum/BCC (XOR → 2 hex ASCII).
 * Nenhum Driver deve calcular checksum diretamente.
 */

'use strict';

const { InvalidChecksumError } = require('./ToledoProtocolErrors');

const CHECKSUM_LEN = 2;

/**
 * XOR de todos os bytes (BCC).
 * @param {Buffer|Uint8Array|string} data
 * @returns {number} 0–255
 */
function calculate(data) {
  const buf = Buffer.isBuffer(data)
    ? data
    : (typeof data === 'string' ? Buffer.from(data, 'binary') : Buffer.from(data || []));
  let x = 0;
  for (let i = 0; i < buf.length; i += 1) x ^= buf[i];
  return x & 0xff;
}

/**
 * @param {Buffer|Uint8Array|string} bodyBytes — bytes do corpo (CMD+SEP+payload)
 * @returns {string} 2 hex uppercase
 */
function toHex(bodyBytes) {
  return calculate(bodyBytes).toString(16).padStart(CHECKSUM_LEN, '0').toUpperCase().slice(-CHECKSUM_LEN);
}

/**
 * @param {Buffer|Uint8Array|string} bodyBytes
 * @param {string} checksumHex
 * @returns {boolean}
 */
function validate(bodyBytes, checksumHex) {
  const esperado = toHex(bodyBytes);
  const recebido = String(checksumHex || '').toUpperCase().padStart(CHECKSUM_LEN, '0').slice(-CHECKSUM_LEN);
  return esperado === recebido;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function compare(a, b) {
  return String(a || '').toUpperCase() === String(b || '').toUpperCase();
}

/**
 * Valida ou lança InvalidChecksumError.
 */
function assertValid(bodyBytes, checksumHex) {
  const esperado = toHex(bodyBytes);
  const recebido = String(checksumHex || '').toUpperCase();
  if (!compare(esperado, recebido)) {
    throw new InvalidChecksumError(`Checksum inválido: ${recebido} ≠ ${esperado}`, {
      esperado,
      recebido
    });
  }
  return true;
}

module.exports = {
  calculate,
  toHex,
  validate,
  compare,
  assertValid,
  CHECKSUM_LEN,
  // aliases BCC
  bcc: calculate,
  calculateBcc: calculate
};
