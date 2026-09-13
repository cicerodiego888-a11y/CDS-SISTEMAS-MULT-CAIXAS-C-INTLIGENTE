/**
 * Sprint 15.1 — ConnectionEvents
 * Barramento tipado de eventos de conexão.
 */

'use strict';

const { EventEmitter } = require('events');

const EVENTS = Object.freeze({
  connected: 'connected',
  disconnected: 'disconnected',
  reconnecting: 'reconnecting',
  timeout: 'timeout',
  heartbeat: 'heartbeat',
  packetSent: 'packetSent',
  packetReceived: 'packetReceived',
  error: 'error',
  stateChanged: 'stateChanged',
  busy: 'busy',
  idle: 'idle'
});

class ConnectionEvents extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    // Evita unhandledRejection do EventEmitter ao emitir 'error' sem listeners
    this.on('error', () => { /* default sink */ });
  }

  emitConnected(payload) {
    return this.emit(EVENTS.connected, payload);
  }

  emitDisconnected(payload) {
    return this.emit(EVENTS.disconnected, payload);
  }

  emitReconnecting(payload) {
    return this.emit(EVENTS.reconnecting, payload);
  }

  emitTimeout(payload) {
    return this.emit(EVENTS.timeout, payload);
  }

  emitHeartbeat(payload) {
    return this.emit(EVENTS.heartbeat, payload);
  }

  emitPacketSent(payload) {
    return this.emit(EVENTS.packetSent, payload);
  }

  emitPacketReceived(payload) {
    return this.emit(EVENTS.packetReceived, payload);
  }

  emitError(payload) {
    return this.emit(EVENTS.error, payload);
  }

  emitStateChanged(payload) {
    return this.emit(EVENTS.stateChanged, payload);
  }
}

/** Singleton compartilhado pelo ConnectionManager. */
const connectionEvents = new ConnectionEvents();

module.exports = connectionEvents;
module.exports.ConnectionEvents = ConnectionEvents;
module.exports.EVENTS = EVENTS;
module.exports.connectionEvents = connectionEvents;
