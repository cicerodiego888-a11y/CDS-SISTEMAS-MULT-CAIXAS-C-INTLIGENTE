/**
 * Sprint 14.10 — MonitorRoutes
 */

'use strict';

const express = require('express');
const MonitorController = require('./MonitorController');

function criarRouter() {
  const router = express.Router();
  router.post('/monitor/start', MonitorController.start);
  router.post('/monitor/stop', MonitorController.stop);
  router.post('/monitor/pause', MonitorController.pause);
  router.post('/monitor/resume', MonitorController.resume);
  router.get('/monitor/status', MonitorController.status);
  router.get('/monitor/history', MonitorController.history);
  return router;
}

module.exports = criarRouter;
module.exports.criarRouter = criarRouter;
module.exports.MonitorController = MonitorController;
