/**
 * Sprint 14.5 — FrameAnalyzer
 * Análise estrutural apenas — sem protocolo / sem peso / sem comandos.
 */

'use strict';

const { bufferFiel, toAsciiPreview, checksumEstrutural } = require('./FrameCapture');

/**
 * @param {Buffer|string|object} input
 * @returns {{valido:boolean, tamanho:number, checksum:string, hexadecimal:string, ascii:string}}
 */
function analyze(input) {
  let buf = Buffer.alloc(0);
  if (input && Buffer.isBuffer(input.bytes)) {
    buf = bufferFiel(input.bytes);
  } else if (input && typeof input.frame_hex === 'string') {
    try { buf = Buffer.from(input.frame_hex, 'hex'); } catch (_) { buf = Buffer.alloc(0); }
  } else {
    buf = bufferFiel(input);
  }

  const valido = buf.length > 0;
  return {
    valido,
    tamanho: buf.length,
    checksum: checksumEstrutural(buf),
    hexadecimal: buf.toString('hex'),
    ascii: toAsciiPreview(buf)
  };
}

module.exports = {
  analyze,
  analisar: analyze
};
