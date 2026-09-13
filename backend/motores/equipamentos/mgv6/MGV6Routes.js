/**
 * Sprint 14.15.1 — Rotas Bridge MGV6
 */

'use strict';

const express = require('express');
const ctrl = require('./MGV6Controller');

function createRouter() {
  const router = express.Router();
  router.post('/export', ctrl.exportar);
  router.post('/export-all', ctrl.exportarTodos);
  router.post('/launch', ctrl.iniciar);
  router.get('/history', ctrl.historico);
  router.get('/config/:equipamentoId', ctrl.obterConfig);
  router.put('/config/:equipamentoId', ctrl.salvarConfig);
  router.post('/test-folder', ctrl.testarPasta);
  return router;
}

module.exports = createRouter;
module.exports.createRouter = createRouter;
