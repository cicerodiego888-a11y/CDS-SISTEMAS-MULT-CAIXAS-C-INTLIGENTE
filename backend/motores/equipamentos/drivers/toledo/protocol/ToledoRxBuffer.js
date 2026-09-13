/**
 * RC14.14.2 — ToledoRxBuffer
 * Acumulador frame-aware: TCP chunk → STX…ETX → checksum → frame completo.
 * Nunca interpreta chunk TCP como frame.
 */

'use strict';

const { STX, ETX } = require('./ToledoFrameBuilder');
const frameParser = require('./ToledoFrameParser');
const { CHECKSUM_LEN } = require('./ToledoChecksum');

const MIN_FRAME = 1 + 2 + 1 + CHECKSUM_LEN + 1; // STX+CMD+SEP+CHK+ETX

class ToledoRxBuffer {
  /**
   * @param {{onInvalid?: Function, maxBytes?: number}} [opcoes]
   */
  constructor(opcoes = {}) {
    this._buf = Buffer.alloc(0);
    this._ready = [];
    this.onInvalid = typeof opcoes.onInvalid === 'function' ? opcoes.onInvalid : null;
    this.maxBytes = opcoes.maxBytes != null ? Number(opcoes.maxBytes) : 65536;
    this.descartados = 0;
  }

  get pendingBytes() {
    return this._buf.length;
  }

  get readyCount() {
    return this._ready.length;
  }

  clear() {
    this._buf = Buffer.alloc(0);
    this._ready = [];
  }

  /**
   * Empilha chunk TCP e extrai frames completos válidos.
   * @param {Buffer|string} chunk
   * @returns {Buffer[]} frames completos novos (já validados)
   */
  push(chunk) {
    if (!chunk || !chunk.length) return [];
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this._buf = Buffer.concat([this._buf, piece]);
    if (this._buf.length > this.maxBytes) {
      this._reportInvalid(this._buf, 'RX buffer overflow — reset');
      this._buf = Buffer.alloc(0);
      return [];
    }
    const novos = [];
    while (true) {
      const frame = this._extrairUm();
      if (!frame) break;
      novos.push(frame);
      this._ready.push(frame);
    }
    return novos;
  }

  /** Remove e devolve o próximo frame pronto (ou null). */
  shift() {
    return this._ready.length ? this._ready.shift() : null;
  }

  /**
   * Aguarda frame completo a partir de uma fonte de chunks.
   * @param {{readChunk: Function, timeoutMs: number}} fonte
   * @returns {Promise<Buffer>}
   */
  async waitFrame(fonte = {}) {
    const timeoutMs = Math.max(0, Number(fonte.timeoutMs) || 0);
    const readChunk = fonte.readChunk;
    if (typeof readChunk !== 'function') {
      throw new Error('ToledoRxBuffer.waitFrame: readChunk obrigatório');
    }

    const pronto = this.shift();
    if (pronto) return pronto;

    const inicio = Date.now();
    while (true) {
      const restante = timeoutMs - (Date.now() - inicio);
      if (restante <= 0) return null;
      const chunk = await readChunk(restante);
      if (!chunk || !chunk.length) {
        if (Date.now() - inicio >= timeoutMs) return null;
        continue;
      }
      this.push(chunk);
      const frame = this.shift();
      if (frame) return frame;
    }
  }

  _extrairUm() {
    const buf = this._buf;
    const stx = buf.indexOf(STX);
    if (stx < 0) {
      // Sem STX — descarta ruído
      if (buf.length) {
        this._reportInvalid(buf, 'STX ausente — descartando ruído');
        this._buf = Buffer.alloc(0);
      }
      return null;
    }
    if (stx > 0) {
      this._reportInvalid(buf.subarray(0, stx), 'Bytes antes de STX descartados');
      this._buf = buf.subarray(stx);
    }

    const etxRel = this._buf.indexOf(ETX, 1);
    if (etxRel < 0) {
      return null; // frame incompleto — aguarda mais chunks
    }

    const candidate = Buffer.from(this._buf.subarray(0, etxRel + 1));
    this._buf = Buffer.from(this._buf.subarray(etxRel + 1));

    if (candidate.length < MIN_FRAME) {
      this._reportInvalid(candidate, 'Frame curto demais');
      return null;
    }

    try {
      frameParser.parse(candidate); // valida STX/ETX/SEP/checksum
      return candidate;
    } catch (err) {
      this._reportInvalid(candidate, err.message || 'Frame inválido', err);
      return null; // não entrega ao Driver
    }
  }

  _reportInvalid(raw, motivo, err = null) {
    this.descartados += 1;
    if (this.onInvalid) {
      try {
        this.onInvalid({
          motivo,
          bytes: Buffer.isBuffer(raw) ? raw.length : 0,
          hex: Buffer.isBuffer(raw) ? raw.toString('hex') : null,
          erro: err?.code || err?.message || null
        });
      } catch (_) { /* ignore */ }
    }
  }
}

module.exports = ToledoRxBuffer;
module.exports.ToledoRxBuffer = ToledoRxBuffer;
module.exports.MIN_FRAME = MIN_FRAME;
