/**
 * Sprint 14.3 / 15.1 — ConnectionRoutes
 */

'use strict';

const express = require('express');
const ConnectionController = require('./ConnectionController');

function criarRouter() {
  const router = express.Router();

  // V1 — host/porta
  router.post('/connect', ConnectionController.connect);
  router.get('/status', ConnectionController.status);
  router.post('/disconnect', ConnectionController.disconnect);
  router.post('/reconnect', ConnectionController.reconnect);

  // V2 — ping + listagem
  router.post('/ping', ConnectionController.ping);
  router.get('/connections', ConnectionController.listConnections);

  // V2 — por equipamento id
  router.post('/:id/connect', ConnectionController.connectById);
  router.post('/:id/disconnect', ConnectionController.disconnectById);
  router.post('/:id/reconnect', ConnectionController.reconnectById);
  router.post('/:id/ping', ConnectionController.pingById);
  router.get('/:id/status', ConnectionController.statusById);

  return router;
}

module.exports = criarRouter;
module.exports.criarRouter = criarRouter;
module.exports.ConnectionController = ConnectionController;
