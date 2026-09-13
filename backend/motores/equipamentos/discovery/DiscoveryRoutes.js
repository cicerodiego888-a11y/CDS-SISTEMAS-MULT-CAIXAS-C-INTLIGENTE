/**
 * Sprint 14.1 — DiscoveryRoutes
 */

'use strict';

const express = require('express');
const ctrl = require('./DiscoveryController');

const router = express.Router();

/** Discovery Engine V1.0 — scan TCP (porta 9000) */
router.post('/', ctrl.discovery);
router.post('/scan', ctrl.discovery);
router.post('/cancel', ctrl.cancelar);
router.get('/descobertos', ctrl.listarDescobertos);

module.exports = router;
