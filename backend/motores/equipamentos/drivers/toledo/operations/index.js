/**
 * Sprint 14.6 — Motor de Operações Toledo V1.0
 */

'use strict';

const toledoOperationEngine = require('./ToledoOperationEngine');
const ToledoOperation = require('./ToledoOperation');
const OperationContext = require('./OperationContext');
const OperationResult = require('./OperationResult');
const OperationQueue = require('./OperationQueue');
const OperationRepository = require('./OperationRepository');
const OperationErrors = require('./OperationErrors');
const ops = require('./operations');
const OperationController = require('./OperationController');

module.exports = {
  toledoOperationEngine,
  ToledoOperationEngine: toledoOperationEngine.ToledoOperationEngine,
  ToledoOperation,
  OperationContext,
  OperationResult,
  OperationQueue,
  OperationRepository,
  OperationErrors,
  PingOperation: ops.PingOperation,
  HandshakeOperation: ops.HandshakeOperation,
  IdentifyOperation: ops.IdentifyOperation,
  OperationController,
  execute: (...args) => toledoOperationEngine.execute(...args),
  ping: (...args) => toledoOperationEngine.ping(...args),
  handshake: (...args) => toledoOperationEngine.handshake(...args),
  identify: (...args) => toledoOperationEngine.identify(...args)
};
