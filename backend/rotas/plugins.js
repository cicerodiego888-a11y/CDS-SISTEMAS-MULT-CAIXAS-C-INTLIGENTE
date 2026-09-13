'use strict';

/**
 * APIs CIA-APPS — plugins opcionais (não altera rotas de negócio).
 *
 * GET  /api/plugins
 * GET  /api/plugins/dashboard
 * GET  /api/plugins/status
 * GET  /api/plugins/:id/health
 * POST /api/plugins/:id/ask
 * POST /api/plugins/:id/invoke
 * POST /api/plugins/:id/enable
 * POST /api/plugins/:id/disable
 * POST /api/plugins/:id/restart
 */

const INVOKE_WHITELIST = new Set([
  'ask',
  'suggest',
  'dashboard',
  'executive',
  'layout',
  'health',
  'analyze',
  'events',
  'alerts',
  'opportunities',
  'resolve'
]);

const express = require('express');
const router = express.Router();
const db = require('../database');
const { obterPluginManager, bootstrapPlugins } = require('../plugins');

let _bootPromise = null;

function ensureBoot() {
  if (!_bootPromise) {
    _bootPromise = bootstrapPlugins({ db }).catch((err) => {
      _bootPromise = null;
      return { ok: false, error: err.message };
    });
  }
  return _bootPromise;
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

router.use(async (req, res, next) => {
  try {
    await ensureBoot();
    next();
  } catch (_) {
    next();
  }
});

router.get('/', (req, res) => {
  return res.json({ plugins: pm().list() });
});

router.get('/dashboard', (req, res) => {
  return res.json(pm().dashboard());
});

router.get('/status', async (req, res) => {
  try {
    return res.json(await pm().health());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/flags', (req, res) => {
  return res.json({ flags: pm().flags.list() });
});

router.get('/:id/health', async (req, res) => {
  try {
    return res.json(await pm().health(req.params.id));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:id/ask', async (req, res) => {
  try {
    const body = req.body || {};
    const method = body.method === 'suggest' ? 'suggest' : 'ask';
    const result = await pm().invoke(req.params.id, method, {
      mensagem: body.mensagem || body.message || body.text,
      nome: body.nome,
      query: body.query,
      gtin: body.gtin,
      ncm: body.ncm,
      origem: body.origem,
      sessao_id: body.sessao_id
    }, userCtx(req));
    if (!result.ok) {
      const status = result.code === 'PLUGIN_DISABLED' ? 403 : 503;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (err) {
    // sandbox já isola — nunca derruba Express
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:id/invoke', async (req, res) => {
  try {
    const body = req.body || {};
    const method = String(body.method || 'ask');
    if (!INVOKE_WHITELIST.has(method)) {
      return res.status(400).json({ ok: false, error: 'Método não permitido', code: 'PLUGIN_METHOD' });
    }
    const { method: _m, ...args } = body;
    const result = await pm().invoke(req.params.id, method, args, userCtx(req));
    if (!result.ok) {
      const status = result.code === 'PLUGIN_DISABLED' ? 403 : 503;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:id/enable', (req, res) => {
  const body = req.body || {};
  return res.json(pm().setEnabled(req.params.id, true, {
    scope: body.scope || 'global',
    scopeId: body.scopeId
  }));
});

router.post('/:id/disable', (req, res) => {
  const body = req.body || {};
  return res.json(pm().setEnabled(req.params.id, false, {
    scope: body.scope || 'global',
    scopeId: body.scopeId
  }));
});

router.post('/:id/restart', async (req, res) => {
  try {
    const r = await pm().restart(req.params.id);
    return res.json(r);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
