'use strict';

/**
 * CDS TEF Execution Context (MRT-05)
 */

const contracts = require('./contracts');
const {
  ExecutionContextResolver,
  criarExecutionContextResolver,
  obterExecutionContextResolver,
  resetExecutionContextResolverParaTestes,
  inferirTopologia,
  avaliarDispositivo,
  compararEstacaoLocal
} = require('./ExecutionContextResolver');

module.exports = {
  ...contracts,
  ExecutionContextResolver,
  criarExecutionContextResolver,
  obterExecutionContextResolver,
  resetExecutionContextResolverParaTestes,
  inferirTopologia,
  avaliarDispositivo,
  compararEstacaoLocal
};
