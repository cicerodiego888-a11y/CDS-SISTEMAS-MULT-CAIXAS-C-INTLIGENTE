'use strict';

/**
 * Business Monitor APIs — delega ao plugin (sem regras de ERP).
 *
 * GET  /api/business-monitor/events
 * GET  /api/business-monitor/alerts
 * GET  /api/business-monitor/opportunities
 * GET  /api/business-monitor/dashboard
 * GET  /api/business-monitor/status
 * POST /api/business-monitor/analyze
 * POST /api/business-monitor/resolve
 * POST /api/business-monitor/ask
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { obterPluginManager, bootstrapPlugins } = require('../plugins');

const PLUGIN_ID = 'business-monitor';
let _boot = null;

function ensure() {
  if (!_boot) {
    _boot = bootstrapPlugins({ db }).catch((err) => {
      _boot = null;
      return { ok: false, error: err.message };
    });
  }
  return _boot;
}

function pm() {
  return obterPluginManager({ db });
}

function userCtx(req) {
  const u = req.user || {};
  return {
    id: u.id,
    usuario_id: u.id,
    empresa_id: u.empresa_id || null,
    filial_id: u.filial_id || null,
    perfil: u.perfil,
    role: u.role,
    permissoes: u.permissoes
  };
}

async function call(method, args, req, res) {
  try {
    await ensure();
    const result = await pm().invoke(PLUGIN_ID, method, args || {}, userCtx(req));
    if (!result.ok) {
      const status = result.code === 'PLUGIN_DISABLED' ? 403 : 503;
      return res.status(status).json(result);
    }
    return res.json(result.result != null ? result.result : result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

router.use(async (req, res, next) => {
  try { await ensure(); } catch (_) { /* ignore */ }
  next();
});

router.get('/status', (req, res) => call('health', {}, req, res));
router.get('/dashboard', (req, res) => call('dashboard', {
  refresh: req.query.refresh !== '0'
}, req, res));
router.get('/events', (req, res) => call('events', {
  status: req.query.status,
  prioridade: req.query.prioridade,
  monitor: req.query.monitor,
  limite: req.query.limite
}, req, res));
router.get('/alerts', (req, res) => call('alerts', {
  status: req.query.status,
  limite: req.query.limite
}, req, res));
router.get('/opportunities', (req, res) => call('opportunities', {
  status: req.query.status,
  limite: req.query.limite
}, req, res));

router.post('/analyze', (req, res) => call('analyze', req.body || {}, req, res));
router.post('/resolve', (req, res) => call('resolve', req.body || {}, req, res));
router.post('/ask', (req, res) => call('ask', req.body || {}, req, res));

module.exports = router;
