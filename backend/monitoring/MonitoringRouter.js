/**
 * Router oficial — CDS Monitoring Engine
 * GET /api/monitoring/summary
 */

const express = require('express');
const controller = require('./MonitoringController');

const router = express.Router();

router.get('/summary', controller.getSummary);
router.get('/providers', controller.getProviders);

module.exports = router;
