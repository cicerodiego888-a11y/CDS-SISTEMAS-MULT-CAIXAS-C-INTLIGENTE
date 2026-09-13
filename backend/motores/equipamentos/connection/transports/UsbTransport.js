/**
 * Sprint 15.1 — UsbTransport (adapter Connection Manager)
 * Interface unificada. Stub seguro quando dispositivo USB indisponível.
 */

'use strict';

const { EventEmitter } = require('events');

class UsbTransport extends EventEmitter {
  constructor(opcoes = {}) {
    super();
    this.tipo = 'usb';
    this.vid = opcoes.vid != null ? String(opcoes.vid) : null;
    this.pid = opcoes.pid != null ? String(opcoes.pid) : null;
    this.caminho = String(opcoes.caminho_dispositivo || opcoes.path || '');
    this.timeoutMs = opcoes.timeoutMs != null ? Number(opcoes.timeoutMs) : 1000;
    this._aberto = false;
  }

  get aberto() {
    return this._aberto === true;
  }

  getTcp() {
    return null;
  }

  async connect() {
    this._aberto = true;
    this.emit('connect', { latencia: 0, stub: true });
    return { latencia: 0, stub: true };
  }

  async disconnect() {
    this._aberto = false;
    this.emit('disconnect');
  }

  async send(data) {
    if (!this._aberto) {
      throw Object.assign(new Error('USB não conectado'), { code: 'USB_NOT_CONNECTED' });
    }
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.emit('send', buf.length);
    return buf.length;
  }

  async receive({ timeoutMs = 500 } = {}) {
    if (!this._aberto) {
      throw Object.assign(new Error('USB não conectado'), { code: 'USB_NOT_CONNECTED' });
    }
    await new Promise((r) => setTimeout(r, Math.min(50, Number(timeoutMs) || 0)));
    return null;
  }

  async ping() {
    return { ok: this._aberto, latencia: this._aberto ? 0 : null };
  }

  destroy() {
    this._aberto = false;
    this.emit('destroy');
  }
}

module.exports = UsbTransport;
module.exports.UsbTransport = UsbTransport;
