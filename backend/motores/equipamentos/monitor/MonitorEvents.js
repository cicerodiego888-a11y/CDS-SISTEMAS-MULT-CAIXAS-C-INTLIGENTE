/**
 * Sprint 14.10 — MonitorEvents
 */

'use strict';

const { EventEmitter } = require('events');

const EVENTS = Object.freeze({
  MONITOR_STARTED: 'MONITOR_STARTED',
  DEVICE_ONLINE: 'DEVICE_ONLINE',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  HEARTBEAT_OK: 'HEARTBEAT_OK',
  HEARTBEAT_TIMEOUT: 'HEARTBEAT_TIMEOUT',
  MONITOR_STOPPED: 'MONITOR_STOPPED',
  MONITOR_PAUSED: 'MONITOR_PAUSED',
  MONITOR_RESUMED: 'MONITOR_RESUMED'
});

class MonitorEvents extends EventEmitter {
  emitStarted(payload) {
    this.emit(EVENTS.MONITOR_STARTED, { ...payload, at: new Date().toISOString() });
  }

  emitOnline(payload) {
    this.emit(EVENTS.DEVICE_ONLINE, { ...payload, at: new Date().toISOString() });
  }

  emitOffline(payload) {
    this.emit(EVENTS.DEVICE_OFFLINE, { ...payload, at: new Date().toISOString() });
  }

  emitHeartbeatOk(payload) {
    this.emit(EVENTS.HEARTBEAT_OK, { ...payload, at: new Date().toISOString() });
  }

  emitHeartbeatTimeout(payload) {
    this.emit(EVENTS.HEARTBEAT_TIMEOUT, { ...payload, at: new Date().toISOString() });
  }

  emitStopped(payload) {
    this.emit(EVENTS.MONITOR_STOPPED, { ...payload, at: new Date().toISOString() });
  }

  emitPaused(payload) {
    this.emit(EVENTS.MONITOR_PAUSED, { ...payload, at: new Date().toISOString() });
  }

  emitResumed(payload) {
    this.emit(EVENTS.MONITOR_RESUMED, { ...payload, at: new Date().toISOString() });
  }
}

module.exports = {
  EVENTS,
  MonitorEvents,
  ...EVENTS
};
