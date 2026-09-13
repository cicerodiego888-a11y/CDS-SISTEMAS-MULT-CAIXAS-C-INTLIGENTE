/**
 * Sprint 14.1 / 15.0 — Discovery Engine
 * Fachada do módulo de descoberta inteligente de equipamentos.
 */

'use strict';

const NetworkScanner = require('./NetworkScanner');
const PortScanner = require('./PortScanner');
const TcpScanner = require('./TcpScanner');
const ProbeExecutor = require('./ProbeExecutor');
const CandidateBuilder = require('./CandidateBuilder');
const EthernetDiscovery = require('./EthernetDiscovery');
const DiscoveryManager = require('./DiscoveryManager');
const DiscoveryLabLogger = require('./DiscoveryLabLogger');
const DeviceCandidate = require('./DeviceCandidate');
const DiscoveryRepository = require('./DiscoveryRepository');
const DiscoveryController = require('./DiscoveryController');
const DiscoveryRoutes = require('./DiscoveryRoutes');
const discoveryEngineV1 = require('./DiscoveryEngineV1');
const DiscoveryService = require('./DiscoveryService');

module.exports = {
  NetworkScanner,
  PortScanner,
  TcpScanner,
  ProbeExecutor,
  CandidateBuilder,
  EthernetDiscovery,
  ethernetDiscovery: EthernetDiscovery,
  DiscoveryManager,
  discoveryManager: DiscoveryManager,
  DiscoveryLabLogger,
  DeviceCandidate,
  DiscoveryRepository,
  DiscoveryController,
  DiscoveryRoutes,
  DiscoveryEngineV1: discoveryEngineV1,
  /** Orquestrador V1.0 (scan TCP sem driver) */
  discoveryEngineV1,
  /** Discovery legado completo (drivers / multi-transporte) */
  DiscoveryService,
  discoveryService: DiscoveryService
};
