/**
 * Sprint 15.7 — Rotas Device Profile SDK
 */

'use strict';

const express = require('express');
const DriverSdkController = require('./DriverSdkController');

function DriverSdkRoutes() {
  const router = express.Router();

  // Ordem importa: rotas estáticas antes de :id
  router.get('/drivers/categories', DriverSdkController.categorias);
  router.get('/drivers/laboratorio', DriverSdkController.laboratorio);
  router.post('/drivers/reload', DriverSdkController.reload);
  router.get('/drivers/:id', DriverSdkController.obter);

  return router;
}

module.exports = DriverSdkRoutes;
