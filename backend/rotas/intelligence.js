'use strict';

/**
 * APIs CIP — CDS Intelligence Platform
 * GET  /api/intelligence/insights
 * GET  /api/intelligence/recommendations
 * GET  /api/intelligence/forecast
 * POST /api/intelligence/analyze
 * POST /api/intelligence/rebuild
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { obterCip } = require('../motores/cip');

function cip() {
  return obterCip(db);
}

router.get('/', (req, res) => {
  return res.json(cip().info());
});

router.get('/insights', async (req, res) => {
  try {
    const data = await cip().insights({
      origem: req.query.origem || req.headers['x-cds-origem'],
      force: req.query.force === '1'
    });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/recommendations', async (req, res) => {
  try {
    return res.json(await cip().recommendations({
      origem: req.query.origem || req.headers['x-cds-origem']
    }));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/forecast', async (req, res) => {
  try {
    return res.json(await cip().forecast({
      origem: req.query.origem
    }));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/contexts', (req, res) => {
  return res.json(cip().contextos());
});

router.get('/automations', async (req, res) => {
  try {
    return res.json(await cip().automacoes(Number(req.query.limite) || 30));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/analyze', async (req, res) => {
  try {
    const body = req.body || {};
    const data = await cip().analyze({
      origem: body.origem || req.headers['x-cds-origem'] || 'erp',
      automacao: body.automacao !== false,
      dryRun: Boolean(body.dryRun)
    });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/rebuild', async (req, res) => {
  try {
    const body = req.body || {};
    const data = await cip().rebuild({
      origem: body.origem || 'erp',
      mibGraph: Boolean(body.mibGraph),
      leve: Boolean(body.leve),
      automacao: body.automacao !== false,
      dryRun: Boolean(body.dryRun)
    });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
