/**
 * Sprint 14.9 — Motor de Pesagem Toledo V1.0
 */

'use strict';

const toledoWeightEngine = require('./ToledoWeightEngine');
const ToledoWeightOperation = require('./ToledoWeightOperation');
const ToledoWeightParser = require('./ToledoWeightParser');
const ToledoWeightValidator = require('./ToledoWeightValidator');
const ToledoWeightRepository = require('./ToledoWeightRepository');
const ToledoWeightErrors = require('./ToledoWeightErrors');
const ToledoWeightEvents = require('./ToledoWeightEvents');
const WeightController = require('./WeightController');

module.exports = {
  toledoWeightEngine,
  ToledoWeightEngine: toledoWeightEngine.ToledoWeightEngine,
  ToledoWeightOperation,
  ToledoWeightParser,
  ToledoWeightValidator,
  ToledoWeightRepository,
  ToledoWeightErrors,
  ToledoWeightEvents,
  WeightController
};
