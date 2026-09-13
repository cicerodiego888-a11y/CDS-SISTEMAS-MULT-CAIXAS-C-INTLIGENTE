/**
 * Sprint 15.1 — SerialTransport (adapter Connection Manager)
 * Interface unificada. Stub seguro quando porta serial indisponível.
 */

'use strict';

const { EventEmitter } = require('events');

class SerialTransport extends EventEmitter {
  constructor(opcoes = {}) {
    super();
    this.tipo = 'serial';
    this.portaCom = String(opcoes.porta_com || opcoes.path || opcoes.host || '');
    this.baudRate = Number(opcoes.baudRate || opcoes.baud || 9600);
    this.timeoutMs = opcoes.timeoutMs != null ? Number(opcoes.timeoutMs) : 1000;
    this._aberto = false;
    this._buffer = [];
    this._port = null;
  }

  get aberto() {
    return this._aberto === true;
  }

  getTcp() {
    return null;
  }

  async connect() {
    try {
      // eslint-disable-next-line import/no-extraneous-dependencies, global-require
      const { SerialPort } = require('serialport');
      if (this.portaCom && SerialPort) {
        this._port = await new Promise((resolve, reject) => {
          const port = new SerialPort({
            path: this.portaCom,
            baudRate: this.baudRate,
            autoOpen: false
          });
          port.open((err) => (err ? reject(err) : resolve(port)));
        });
        this._port.on('data', (buf) => {
          this._buffer.push(Buffer.from(buf));
          this.emit('data', buf);
        });
        this._port.on('close', () => {
          this._aberto = false;
          this.emit('close');
        });
        this._port.on('error', (err) => this.emit('error', err));
        this._aberto = true;
        this.emit('connect', { latencia: 0 });
        return { latencia: 0, real: true };
      }
    } catch (_) { /* fallback stub */ }

    this._aberto = true;
    this.emit('connect', { latencia: 0, stub: true });
    return { latencia: 0, stub: true };
  }

  async disconnect() {
    if (this._port) {
      await new Promise((resolve) => {
        try {
          this._port.close(() => resolve());
        } catch (_) {
          resolve();
        }
      });
      this._port = null;
    }
    this._aberto = false;
    this.emit('disconnect');
  }

  async send(data) {
    if (!this._aberto) {
      throw Object.assign(new Error('Serial não conectado'), { code: 'SERIAL_NOT_CONNECTED' });
    }
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (this._port && this._port.writable) {
      await new Promise((resolve, reject) => {
        this._port.write(buf, (err) => (err ? reject(err) : resolve()));
      });
    }
    this.emit('send', buf.length);
    return buf.length;
  }

  async receive({ timeoutMs = 500 } = {}) {
    if (!this._aberto) {
      throw Object.assign(new Error('Serial não conectado'), { code: 'SERIAL_NOT_CONNECTED' });
    }
    if (this._buffer.length) {
      return this._buffer.shift();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.removeListener('data', onData);
        resolve(null);
      }, Math.max(0, Number(timeoutMs) || 0));
      const onData = (buf) => {
        clearTimeout(timer);
        resolve(buf);
      };
      this.once('data', onData);
    });
  }

  async ping() {
    return { ok: this._aberto, latencia: this._aberto ? 0 : null };
  }

  destroy() {
    try {
      if (this._port) {
        if (typeof this._port.destroy === 'function') this._port.destroy();
        else if (typeof this._port.close === 'function') this._port.close(() => {});
      }
    } catch (_) { /* ignore */ }
    this._port = null;
    this._aberto = false;
    this.emit('destroy');
  }
}

module.exports = SerialTransport;
module.exports.SerialTransport = SerialTransport;
