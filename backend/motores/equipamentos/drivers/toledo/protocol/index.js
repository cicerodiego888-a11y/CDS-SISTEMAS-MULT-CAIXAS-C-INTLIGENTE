/**
 * Sprint 15.2 / RC14.14.2 — Fachada do Motor de Protocolo Toledo 90AX
 */

'use strict';

const engine = require('./Toledo90AXEngine');
const frameBuilder = require('./ToledoFrameBuilder');
const frameParser = require('./ToledoFrameParser');
const checksum = require('./ToledoChecksum');
const commandRegistry = require('./ToledoCommandRegistry');
const ToledoSession = require('./ToledoSession');
const ToledoResponseMatcher = require('./ToledoResponseMatcher');
const ToledoRxBuffer = require('./ToledoRxBuffer');
const ToledoAckRouter = require('./ToledoAckRouter');
const officialCommands = require('./ToledoOfficialCommands');
const { auditar } = require('./ToledoProtocolAudit');
const errors = require('./ToledoProtocolErrors');
const commands = require('./commands');

module.exports = {
  engine,
  Toledo90AXEngine: engine.Toledo90AXEngine,
  createEngine: engine.createEngine,
  frameBuilder,
  frameParser,
  checksum,
  commandRegistry,
  ToledoSession,
  ToledoResponseMatcher,
  ToledoRxBuffer,
  ToledoAckRouter,
  officialCommands,
  auditar,
  errors,
  commands,
  execute: (...args) => engine.execute(...args),
  history: (...args) => engine.history(...args),
  status: (...args) => engine.status(...args)
};
