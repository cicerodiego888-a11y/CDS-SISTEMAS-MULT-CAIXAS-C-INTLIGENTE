'use strict';

/**
 * CDS TEF Terminal Router (MRT-02/03/04/05)
 *
 * Registry: backend/services/tef/terminalRegistry (consulta lógica).
 * Alocação: request.allocate=true → TerminalAllocator (MRT-04).
 * Contexto: ExecutionContext (MRT-05) — topologia / estação / dispositivo.
 * TefManager (MRT-06): resolve via tefRouterIntegration com allocate + exigirExecucaoLocal.
 */

const contracts = require('./contracts');
const { criarPdvIdentityValidator, classificarIdentidadeInformada } = require('./pdvIdentityValidator');
const { carregarBindingSingleton } = require('./singletonFallback');
const {
  TerminalRouter,
  criarTerminalRouter,
  obterTerminalRouter,
  resetTerminalRouterParaTestes
} = require('./TerminalRouter');

module.exports = {
  ...contracts,
  criarPdvIdentityValidator,
  classificarIdentidadeInformada,
  carregarBindingSingleton,
  TerminalRouter,
  criarTerminalRouter,
  obterTerminalRouter,
  resetTerminalRouterParaTestes
};
