'use strict';

/**
 * CDS TEF Terminal Recovery & Monitor (MRT-07)
 */

const contracts = require('./contracts');
const {
  TerminalMonitor,
  criarTerminalMonitor,
  classificarEstado
} = require('./TerminalMonitor');
const {
  TerminalRecoveryService,
  criarTerminalRecoveryService,
  obterTerminalRecoveryService,
  resetTerminalRecoveryServiceParaTestes,
  HOLD_TERMINAL_PREFIX
} = require('./TerminalRecoveryService');

module.exports = {
  ...contracts,
  TerminalMonitor,
  criarTerminalMonitor,
  classificarEstado,
  TerminalRecoveryService,
  criarTerminalRecoveryService,
  obterTerminalRecoveryService,
  resetTerminalRecoveryServiceParaTestes,
  HOLD_TERMINAL_PREFIX
};
