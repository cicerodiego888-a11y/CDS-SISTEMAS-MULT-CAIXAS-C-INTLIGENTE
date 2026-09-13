/**
 * Sprint 14.9 — ToledoWeightEvents
 * Constantes e emissor local (sem polling / sem streaming).
 */

'use strict';

const { EventEmitter } = require('events');

const EVENTS = Object.freeze({
  WEIGHT_REQUESTED: 'WEIGHT_REQUESTED',
  WEIGHT_RECEIVED: 'WEIGHT_RECEIVED',
  WEIGHT_UPDATED: 'WEIGHT_UPDATED',
  WEIGHT_TIMEOUT: 'WEIGHT_TIMEOUT',
  WEIGHT_ERROR: 'WEIGHT_ERROR'
});

class ToledoWeightEvents extends EventEmitter {
  emitRequested(ctx = {}) {
    this.emit(EVENTS.WEIGHT_REQUESTED, { ...ctx, at: new Date().toISOString() });
  }

  emitReceived(result) {
    this.emit(EVENTS.WEIGHT_RECEIVED, { ...result, at: new Date().toISOString() });
  }

  emitUpdated(result) {
    this.emit(EVENTS.WEIGHT_UPDATED, { ...result, at: new Date().toISOString() });
  }

  emitTimeout(ctx = {}) {
    this.emit(EVENTS.WEIGHT_TIMEOUT, { ...ctx, at: new Date().toISOString() });
  }

  emitError(error, ctx = {}) {
    this.emit(EVENTS.WEIGHT_ERROR, {
      code: error && error.code,
      message: error && error.message,
      ...ctx,
      at: new Date().toISOString()
    });
  }
}

module.exports = {
  EVENTS,
  ToledoWeightEvents,
  ...EVENTS
};
