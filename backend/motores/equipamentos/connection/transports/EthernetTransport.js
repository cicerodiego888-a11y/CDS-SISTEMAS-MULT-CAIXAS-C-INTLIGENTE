/**
 * Sprint 15.1 — EthernetTransport (adapter Connection Manager)
 * Interface unificada: connect/disconnect/send/receive/ping/destroy
 * Internamente usa TcpConnection (sem abrir socket fora do Manager).
 */

'use strict';

const { EventEmitter } = require('events');
const TcpConnection = require('../TcpConnection');
const { logDisconnectCall } = require('../SocketCloseAudit');

class EthernetTransport extends EventEmitter {
  constructor(opcoes = {}) {
    super();
    this.tipo = 'ethernet';
    this.host = String(opcoes.host || opcoes.ip || '');
    this.porta = Number(opcoes.porta || opcoes.porta_tcp) || 0;
    this.timeoutMs = opcoes.timeoutMs != null ? Number(opcoes.timeoutMs) : 1000;
    this._tcp = new TcpConnection({
      host: this.host,
      porta: this.porta,
      timeoutMs: this.timeoutMs
    });
    this._bind();
  }

  _bind() {
    this._tcp.on('data', (buf) => this.emit('data', buf));
    this._tcp.on('close', () => this.emit('close'));
    this._tcp.on('error', (err) => this.emit('error', err));
    this._tcp.on('timeout', (err) => this.emit('timeout', err));
    this._tcp.on('destroy', () => this.emit('destroy'));
  }

  get aberto() {
    return this._tcp.aberto;
  }

  /** Acesso interno ao socket TCP (Drivers legados V1). */
  getTcp() {
    return this._tcp;
  }

  async connect() {
    const r = await this._tcp.open();
    this.emit('connect', r);
    return r;
  }

  async disconnect() {
    logDisconnectCall('EthernetTransport', 'disconnect()', {
      socket: this._tcp?.socket || null,
      host: this.host,
      porta: this.porta
    });
    await this._tcp.close();
    this.emit('disconnect');
  }

  async send(data) {
    const n = this._tcp.write(data);
    this.emit('send', n);
    return n;
  }

  async receive(opcoes = {}) {
    const buf = await this._tcp.read(opcoes);
    if (buf) this.emit('receive', buf.length);
    return buf;
  }

  /**
   * Ping de infraestrutura: verifica socket aberto/writable.
   * Protocolo de equipamento fica no Driver.
   */
  async ping() {
    const inicio = process.hrtime.bigint();
    if (!this._tcp.aberto || !this._tcp.socket || this._tcp.socket.destroyed) {
      return { ok: false, latencia: null };
    }
    const writable = this._tcp.socket.writable !== false;
    const latencia = Math.max(0, Math.round(Number(process.hrtime.bigint() - inicio) / 1e6));
    return { ok: writable, latencia };
  }

  destroy() {
    logDisconnectCall('EthernetTransport', 'destroy()', {
      socket: this._tcp?.socket || null,
      host: this.host,
      porta: this.porta
    });
    this._tcp.destroy();
  }
}

module.exports = EthernetTransport;
module.exports.EthernetTransport = EthernetTransport;
