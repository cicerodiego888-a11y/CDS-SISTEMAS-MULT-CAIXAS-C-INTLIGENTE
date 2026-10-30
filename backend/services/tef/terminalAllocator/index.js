'use strict';

/**
 * CDS TEF Terminal Allocator (MRT-04)
 */

const contracts = require('./contracts');
const {
  TerminalAllocator,
  criarTerminalAllocator,
  obterTerminalAllocator,
  resetTerminalAllocatorParaTestes
} = require('./TerminalAllocator');

module.exports = {
  ...contracts,
  TerminalAllocator,
  criarTerminalAllocator,
  obterTerminalAllocator,
  resetTerminalAllocatorParaTestes
};
