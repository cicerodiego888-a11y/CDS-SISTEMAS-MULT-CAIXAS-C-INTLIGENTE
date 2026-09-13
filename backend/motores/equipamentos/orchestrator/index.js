/**
 * Sprint 15.6 — Central de Orquestração de Balanças
 */

'use strict';

const EquipmentJob = require('./EquipmentJob');
const EquipmentQueue = require('./EquipmentQueue');
const EquipmentDispatcher = require('./EquipmentDispatcher');
const EquipmentScheduler = require('./EquipmentScheduler');
const EquipmentHealthService = require('./EquipmentHealthService');
const EquipmentNotificationService = require('./EquipmentNotificationService');
const EquipmentStatistics = require('./EquipmentStatistics');
const EquipmentOrchestrator = require('./EquipmentOrchestrator');
const OrchestratorController = require('./OrchestratorController');
const OrchestratorRoutes = require('./OrchestratorRoutes');

module.exports = {
  EquipmentJob,
  EquipmentQueue,
  EquipmentDispatcher,
  EquipmentScheduler,
  EquipmentHealthService,
  EquipmentNotificationService,
  EquipmentStatistics,
  EquipmentOrchestrator,
  OrchestratorController,
  OrchestratorRoutes,
  getOrchestrator: EquipmentOrchestrator.getOrchestrator,
  resetOrchestrator: EquipmentOrchestrator.resetOrchestrator,
  JOB_TYPES: EquipmentJob.JOB_TYPES,
  JOB_STATUS: EquipmentJob.JOB_STATUS
};
