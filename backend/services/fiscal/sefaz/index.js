/**
 * Índice — SEFAZ Query Gate
 */
'use strict';

const constants = require('./sefazGateConstants');
const gateMod = require('./SEFAZQueryGate');
const { criarRequestId } = require('./SEFAZRequestId');
const { SEFAZRateLimiter } = require('./SEFAZRateLimiter');
const { SEFAZCooldown } = require('./SEFAZCooldown');
const { SEFAZCircuitBreaker } = require('./SEFAZCircuitBreaker');
const { SEFAZQueryQueue } = require('./SEFAZQueryQueue');
const { SEFAZQueryExecutor } = require('./SEFAZQueryExecutor');
const { SEFAZQueryAudit } = require('./SEFAZQueryAudit');

module.exports = {
  ...constants,
  SEFAZQueryGate: gateMod.SEFAZQueryGate,
  sefazQueryGate: gateMod,
  GateError: gateMod.GateError,
  criarRequestId,
  SEFAZRateLimiter,
  SEFAZCooldown,
  SEFAZCircuitBreaker,
  SEFAZQueryQueue,
  SEFAZQueryExecutor,
  SEFAZQueryAudit
};
