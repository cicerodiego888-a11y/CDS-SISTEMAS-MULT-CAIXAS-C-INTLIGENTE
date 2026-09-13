/**
 * Sprint 15.6 — OrchestratorRoutes
 */

'use strict';

const express = require('express');
const OrchestratorController = require('./OrchestratorController');

function OrchestratorRoutes() {
  const router = express.Router();

  router.post('/jobs', OrchestratorController.criarJobs);
  router.get('/jobs', OrchestratorController.listarJobs);
  router.post('/jobs/:id/cancel', OrchestratorController.cancelarJob);
  router.delete('/jobs/:id', OrchestratorController.cancelarJob);

  router.get('/dashboard', OrchestratorController.dashboard);
  router.get('/health', OrchestratorController.health);
  router.post('/health', OrchestratorController.health);

  router.post('/scheduler', OrchestratorController.criarScheduler);
  router.get('/scheduler', OrchestratorController.listarScheduler);
  router.post('/scheduler/evento', OrchestratorController.dispararEvento);

  router.get('/statistics', OrchestratorController.statistics);
  router.get('/notifications', OrchestratorController.notificacoes);

  return router;
}

module.exports = OrchestratorRoutes;
