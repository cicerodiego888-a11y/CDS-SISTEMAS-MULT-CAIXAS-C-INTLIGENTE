/**
 * RC14.14.2 — ToledoAckRouter
 * Associa ACK/NAK exclusivamente à operação que originou o TX.
 * Monitor/Heartbeat/Health NÃO consomem ACK de operação.
 */

'use strict';

class ToledoAckRouter {
  constructor() {
    /** @type {Map<string, {operationId:string, wireCommand:string, criadoEm:number, resolve?:Function, reject?:Function}>} */
    this._pending = new Map();
  }

  get size() {
    return this._pending.size;
  }

  /**
   * Marca que a operação `operationId` é a única autorizada a receber o próximo ACK.
   */
  begin(chave, meta = {}) {
    const key = String(chave || 'default');
    const operationId = String(meta.operationId || '');
    if (!operationId) {
      const err = Object.assign(new Error('operationId obrigatório'), { code: 'ACK_NO_OPERATION' });
      throw err;
    }
    if (this._pending.has(key)) {
      const err = Object.assign(
        new Error('Já existe ACK pendente nesta conexão'),
        { code: 'ACK_BUSY', pendingId: this._pending.get(key).operationId }
      );
      throw err;
    }
    this._pending.set(key, {
      operationId,
      wireCommand: meta.wireCommand || null,
      criadoEm: Date.now()
    });
    return operationId;
  }

  /**
   * Entrega frame RX apenas se houver operação pendente na chave.
   * @returns {null|{operationId:string, wireCommand:string|null, parsed:object, raw:*, ack:boolean, nak:boolean}}
   */
  complete(chave, parsed, raw = null) {
    const key = String(chave || 'default');
    const slot = this._pending.get(key);
    if (!slot) return null;
    this._pending.delete(key);
    const result = {
      operationId: slot.operationId,
      wireCommand: slot.wireCommand,
      parsed,
      raw,
      ack: Boolean(parsed?.isAck),
      nak: Boolean(parsed?.isNak)
    };
    if (typeof slot.resolve === 'function') slot.resolve(result);
    return result;
  }

  /** Alias histórico / testes */
  deliver(chave, parsed, raw = null) {
    return this.complete(chave, parsed, raw) != null;
  }

  /**
   * Promise API (testes): begin + await complete.
   */
  awaitAck(chave, meta = {}) {
    const key = String(chave || 'default');
    this.begin(key, meta);
    return new Promise((resolve, reject) => {
      const slot = this._pending.get(key);
      if (!slot) {
        reject(Object.assign(new Error('ACK slot perdido'), { code: 'ACK_LOST' }));
        return;
      }
      slot.resolve = resolve;
      slot.reject = reject;
    });
  }

  fail(chave, err) {
    const key = String(chave || 'default');
    const slot = this._pending.get(key);
    if (!slot) return false;
    this._pending.delete(key);
    if (typeof slot.reject === 'function') slot.reject(err);
    return true;
  }

  clear(chave) {
    if (chave != null) {
      const key = String(chave);
      const slot = this._pending.get(key);
      if (slot) {
        this._pending.delete(key);
        if (typeof slot.reject === 'function') {
          slot.reject(Object.assign(new Error('ACK cancelado'), { code: 'ACK_CANCELLED' }));
        }
      }
      return;
    }
    for (const [k, slot] of this._pending.entries()) {
      this._pending.delete(k);
      if (typeof slot.reject === 'function') {
        slot.reject(Object.assign(new Error('ACK cancelado'), { code: 'ACK_CANCELLED' }));
      }
    }
  }

  pendingId(chave) {
    return this._pending.get(String(chave || 'default'))?.operationId || null;
  }
}

module.exports = ToledoAckRouter;
module.exports.ToledoAckRouter = ToledoAckRouter;
