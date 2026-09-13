/**
 * Sprint 14.5 — CaptureRoutes
 */

'use strict';

const express = require('express');
const CaptureController = require('./CaptureController');

function criarRouter() {
  const router = express.Router();
  router.post('/lab/start', CaptureController.start);
  router.post('/lab/stop', CaptureController.stop);
  router.post('/lab/pause', CaptureController.pause);
  router.post('/lab/resume', CaptureController.resume);
  router.get('/lab/status', CaptureController.status);
  router.get('/lab/session/:id', CaptureController.session);
  router.get('/lab/export/:id', CaptureController.exportSession);
  return router;
}

module.exports = criarRouter;
module.exports.criarRouter = criarRouter;
module.exports.CaptureController = CaptureController;
