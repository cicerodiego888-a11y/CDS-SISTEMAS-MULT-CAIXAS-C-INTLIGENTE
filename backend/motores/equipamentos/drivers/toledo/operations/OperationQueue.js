/**
 * Sprint 14.6 — OperationQueue
 * Uma operação por conexão (FIFO).
 */

'use strict';

class OperationQueue {
  constructor() {
    /** @type {Map<string, {running: boolean, items: Array}>} */
    this._filas = new Map();
  }

  _bucket(chave) {
    if (!this._filas.has(chave)) {
      this._filas.set(chave, { running: false, items: [] });
    }
    return this._filas.get(chave);
  }

  size(chave) {
    return this._bucket(chave).items.length + (this._bucket(chave).running ? 1 : 0);
  }

  isBusy(chave) {
    const b = this._bucket(chave);
    return b.running || b.items.length > 0;
  }

  /**
   * Enfileira e processa FIFO. resolve com resultado de fn().
   * @param {string} chave host:porta
   * @param {Function} fn async () => any
   * @param {{operation?:object}} [meta]
   */
  enqueue(chave, fn, meta = {}) {
    const bucket = this._bucket(chave);
    return new Promise((resolve, reject) => {
      bucket.items.push({ fn, resolve, reject, meta, cancelled: false });
      this._pump(chave);
    });
  }

  cancelPending(chave, operationId) {
    const bucket = this._bucket(chave);
    let cancelled = 0;
    for (const item of bucket.items) {
      if (!operationId || (item.meta.operation && item.meta.operation.id === operationId)) {
        item.cancelled = true;
        if (item.meta.operation && typeof item.meta.operation.cancel === 'function') {
          item.meta.operation.cancel();
        }
        cancelled += 1;
      }
    }
    return cancelled;
  }

  async _pump(chave) {
    const bucket = this._bucket(chave);
    if (bucket.running) return;
    bucket.running = true;

    while (bucket.items.length) {
      const item = bucket.items.shift();
      if (item.cancelled) {
        item.reject(Object.assign(new Error('OPERATION_CANCELLED'), { code: 'OPERATION_CANCELLED' }));
        continue;
      }
      try {
        const result = await item.fn();
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
    }

    bucket.running = false;
  }
}

module.exports = OperationQueue;
module.exports.OperationQueue = OperationQueue;
