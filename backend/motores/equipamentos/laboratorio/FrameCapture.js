/**
 * Sprint 14.5 — FrameCapture
 * Captura passiva TX/RX — bytes 100% fiéis.
 */

'use strict';

function bufferFiel(bytes) {
  if (Buffer.isBuffer(bytes)) return Buffer.from(bytes);
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  if (typeof bytes === 'string') return Buffer.from(bytes, 'binary');
  return Buffer.alloc(0);
}

function toAsciiPreview(buf) {
  let out = '';
  for (let i = 0; i < buf.length; i += 1) {
    const c = buf[i];
    out += (c >= 32 && c <= 126) ? String.fromCharCode(c) : '.';
  }
  return out;
}

/**
 * Checksum estrutural (XOR de todos os bytes) — não interpreta protocolo.
 */
function checksumEstrutural(buf) {
  let x = 0;
  for (let i = 0; i < buf.length; i += 1) x ^= buf[i];
  return (x & 0xff).toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Monta registro de captura sem alterar bytes.
 * @param {'TX'|'RX'} direction
 * @param {Buffer|Uint8Array|string} bytes
 * @param {object} meta
 */
function capturar(direction, bytes, meta = {}) {
  const buf = bufferFiel(bytes);
  return {
    direction: direction === 'RX' ? 'RX' : 'TX',
    timestamp: meta.timestamp || new Date().toISOString(),
    host: meta.host || null,
    porta: meta.porta != null ? Number(meta.porta) : null,
    bytes: buf,
    tamanho: buf.length,
    checksum: checksumEstrutural(buf),
    sessionId: meta.sessionId || null,
    frame_hex: buf.toString('hex'),
    frame_ascii: toAsciiPreview(buf)
  };
}

module.exports = {
  capturar,
  bufferFiel,
  toAsciiPreview,
  checksumEstrutural
};
