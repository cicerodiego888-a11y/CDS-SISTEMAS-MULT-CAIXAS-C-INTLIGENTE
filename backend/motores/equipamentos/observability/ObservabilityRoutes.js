/**
 * Sprint 15.8 — ObservabilityRoutes
 */

'use strict';

const express = require('express');
const ObservabilityController = require('./ObservabilityController');

function ObservabilityRoutes() {
  const router = express.Router();

  router.get('/telemetry', ObservabilityController.telemetry);
  router.get('/metrics', ObservabilityController.metrics);
  router.get('/events', ObservabilityController.events);
  router.get('/alerts', ObservabilityController.alerts);
  router.get('/performance', ObservabilityController.performance);
  router.get('/observability/health', ObservabilityController.health);
  router.post('/telemetry/ingest', ObservabilityController.ingest);

  router.post('/certification/run', ObservabilityController.certificationRun);
  router.get('/certification/report', ObservabilityController.certificationReport);

  return router;
}

module.exports = ObservabilityRoutes;
