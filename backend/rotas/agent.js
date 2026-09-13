'use strict';

/**
 * APIs CIA — CDS Intelligence Agent
 * POST /api/agent/chat
 * POST /api/agent/execute
 * GET  /api/agent/history
 * GET  /api/agent/tools
 * GET  /api/agent/status
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { obterCia } = require('../motores/cia');

function cia() {
  return obterCia(db);
}

function userCtx(req) {
  const u = req.user || {};
  return {
    id: u.id,
    operador_id: u.id,
    filial_id: u.filial_id || null,
    role: u.role,
    perfil: u.perfil,
    permissoes: u.permissoes,
    sessao_id: req.headers['x-cds-session'] || req.body?.sessao_id || 'default'
  };
}

router.get('/status', (req, res) => {
  return res.json(cia().status());
});

router.get('/tools', (req, res) => {
  return res.json(cia().tools());
});

router.get('/history', async (req, res) => {
  try {
    const conv = cia().history(userCtx(req), Number(req.query.limite) || 20);
    const audit = await cia().auditHistory(Number(req.query.limite) || 30);
    return res.json({ ...conv, audit });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await cia().chat({
      mensagem: body.mensagem || body.message || body.text,
      origem: body.origem || req.headers['x-cds-origem'] || 'erp',
      sessao_id: body.sessao_id || req.headers['x-cds-session'],
      confirmar: Boolean(body.confirmar),
      confirmacao_id: body.confirmacao_id
    }, userCtx(req));
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/execute', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await cia().execute(body, userCtx(req));
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
