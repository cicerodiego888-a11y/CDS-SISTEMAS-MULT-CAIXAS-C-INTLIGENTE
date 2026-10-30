'use strict';

/**
 * CDS TEF Terminal Registry (MRT-03)
 *
 * Persistência oficial: NÃO aplicada. Use memoryStore + migration proposta.
 */

const contracts = require('./contracts');
const { criarMemoryStore } = require('./memoryStore');
const { projetarVisaoSingleton } = require('./projetarDeSingleton');
const {
  TerminalRegistry,
  criarTerminalRegistry,
  obterTerminalRegistry,
  resetTerminalRegistryParaTestes,
  criarTerminalTef
} = require('./TerminalRegistry');

module.exports = {
  ...contracts,
  criarMemoryStore,
  projetarVisaoSingleton,
  TerminalRegistry,
  criarTerminalRegistry,
  obterTerminalRegistry,
  resetTerminalRegistryParaTestes,
  criarTerminalTef
};
