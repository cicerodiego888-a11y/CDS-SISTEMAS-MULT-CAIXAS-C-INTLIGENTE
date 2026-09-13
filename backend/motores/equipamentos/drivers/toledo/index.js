/**
 * Sprint 14.4 — Driver Toledo Prix IV Uno V1.0
 */

'use strict';

const ToledoPrixIVDriver = require('./ToledoPrixIVDriver');
const ToledoProtocol = require('./ToledoProtocol');
const ToledoFrameBuilder = require('./ToledoFrameBuilder');
const ToledoFrameParser = require('./ToledoFrameParser');
const ToledoHandshake = require('./ToledoHandshake');
const ToledoCapabilities = require('./ToledoCapabilities');
const ToledoErrors = require('./ToledoErrors');
const ToledoDriverController = require('./ToledoDriverController');

module.exports = {
  ToledoPrixIVDriver,
  ToledoProtocol,
  ToledoFrameBuilder,
  ToledoFrameParser,
  ToledoHandshake,
  ToledoCapabilities,
  ToledoErrors,
  ToledoDriverController,
  operations: require('./operations'),
  plu: require('./plu'),
  sync: require('./sync'),
  weight: require('./weight'),
  configuration: require('./configuration'),
  certificacao: require('./certificacao'),
  protocol: require('./protocol'),
  DRIVER: ToledoProtocol.DRIVER,
  getCapabilities: ToledoCapabilities.getCapabilities
};
