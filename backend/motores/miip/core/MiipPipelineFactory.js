/**
 * MiipPipelineFactory — Monta Pipeline com MotorRegistry e configuração.
 *
 * Sprint RC1: composição oficial com telemetria e persistência.
 *
 * @module motores/miip/core/MiipPipelineFactory
 */

const { MiipPipeline } = require('./MiipPipeline');
const MiipDecisionBuilder = require('./MiipDecisionBuilder');
const MotorRegistry = require('./MotorRegistry');
const { criarResolverEngines, criarEngineExecutor } = require('./MiipPipelineEngineRunner');
const { criarCarregadorConfiguracao } = require('./MiipPipelineConfigLoader');
const MiipTelemetryService = require('../services/MiipTelemetryService');
const { MiipDecisoesRepository } = require('../repositories/MiipDecisoesRepository');

/** @type {MiipTelemetryService|null} */
let telemetrySingleton = null;

/**
 * @returns {MiipTelemetryService}
 */
function obterTelemetryService() {
  if (!telemetrySingleton) {
    telemetrySingleton = new MiipTelemetryService();
  }
  return telemetrySingleton;
}

/**
 * @param {Object} [deps]
 * @param {import('./MotorRegistry')} [deps.motorRegistry]
 * @param {import('../repositories/MiipConfiguracoesRepository')|null} [deps.configuracoesRepository]
 * @param {import('../repositories/MiipDecisoesRepository')|null} [deps.decisoesRepository]
 * @param {import('./MiipDecisionBuilder')} [deps.decisionBuilder]
 * @param {MiipTelemetryService} [deps.telemetryService]
 * @returns {import('./MiipPipeline')}
 */
function criarPipelinePadrao(deps = {}) {
  const motorRegistry = deps.motorRegistry ?? MotorRegistry;
  const db = deps.db ?? null;

  return new MiipPipeline({
    carregarConfiguracao: criarCarregadorConfiguracao(deps.configuracoesRepository ?? null),
    resolverEngines: criarResolverEngines(motorRegistry),
    engineExecutor: criarEngineExecutor(motorRegistry),
    decisionBuilder: deps.decisionBuilder ?? new MiipDecisionBuilder(),
    telemetryService: deps.telemetryService ?? obterTelemetryService(),
    decisoesRepository: deps.decisoesRepository
      ?? new MiipDecisoesRepository({ db })
  });
}

module.exports = {
  criarPipelinePadrao,
  obterTelemetryService
};
