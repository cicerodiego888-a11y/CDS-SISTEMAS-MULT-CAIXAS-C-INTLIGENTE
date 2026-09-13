/**
 * Motor de Equipamentos — Fachada pública
 *
 * Ponto de entrada único do módulo, espelhando o padrão de `backend/services/tef/index.js`.
 * Todas as operações externas devem delegar ao EquipamentosManager.
 *
 * Responsabilidade:
 * - Expor API estável para rotas, workers e outros módulos do CDS
 * - Ocultar detalhes internos de drivers, fila e persistência
 *
 * @module motores/equipamentos
 */

const equipamentosManager = require('./core/EquipamentosManager');
const contracts = require('./contracts');
const discoveryService = require('./discovery/DiscoveryService');

/**
 * Inicializa o motor de equipamentos.
 * @param {Object} [opcoes] - Opções de bootstrap
 * @returns {Promise<void>}
 */
async function inicializar(opcoes = {}) {
  return equipamentosManager.inicializar(opcoes);
}

/**
 * Encerra o motor de equipamentos e libera recursos.
 * @returns {Promise<void>}
 */
async function encerrar() {
  return equipamentosManager.encerrar();
}

module.exports = {
  inicializar,
  encerrar,
  equipamentosManager,
  contracts,
  discoveryService,
  discoveryEngineV1: require('./discovery/DiscoveryEngineV1'),
  ethernetDiscovery: require('./discovery/EthernetDiscovery'),
  discoveryManager: require('./discovery/DiscoveryManager'),
  identidadeService: require('./identidade/IdentidadeService'),
  centralEquipamentosService: require('./central/CentralEquipamentosService'),
  monitorService: require('./monitor/MonitorService'),
  heartbeatEngine: require('./monitor/HeartbeatEngine'),
  orchestrator: require('./orchestrator'),
  getOrchestrator: require('./orchestrator').getOrchestrator,
  sdk: require('./sdk'),
  deviceProfileSdk: require('./sdk'),
  observability: require('./observability')
};
