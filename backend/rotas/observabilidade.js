'use strict';

/**
 * RC12.2–RC12.5 — Rotas read-only de observabilidade + ingest RUM.
 * Não altera regras de negócio nem contratos públicos existentes.
 */

const express = require('express');
const observabilidade = require('../observabilidade');
const { getSummary } = require('../observabilidade/telemetryCollector');
const { enrichSummaryForDashboard } = require('../observabilidade/dashboardView');
const { ingestRumBatch } = require('../observabilidade/rumIngest');
const alertEngine = require('../observabilidade/alertEngine');
const historyService = require('../observabilidade/historyService');

const router = express.Router();

function exigirSuperAdminObs(req, res, next) {
  const perfil = String(req.user && req.user.perfil || '').toUpperCase();
  if (perfil !== 'SUPER_ADMIN') {
    return res.status(403).json({
      ok: false,
      erro: 'Acesso restrito: apenas SUPER_ADMIN.'
    });
  }
  return next();
}

function defaultFromTo(query) {
  const to = query.to || new Date().toISOString();
  let from = query.from;
  if (!from) {
    const hours = Number(query.hours) || 24;
    from = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  }
  return { from, to };
}

/**
 * GET /api/observabilidade/summary
 */
router.get('/summary', exigirSuperAdminObs, (req, res) => {
  try {
    const summary = enrichSummaryForDashboard(getSummary());
    return res.json({
      ok: true,
      ...summary
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      erro: err && err.message ? err.message : 'summary_error'
    });
  }
});

/**
 * GET /api/observabilidade/history
 * Snapshots + séries + agregados (READ-ONLY).
 */
router.get('/history', exigirSuperAdminObs, async (req, res) => {
  try {
    if (!historyService.getRepository()) {
      return res.status(503).json({ ok: false, erro: 'history_not_ready' });
    }
    const { from, to } = defaultFromTo(req.query);
    const data = await historyService.getHistorySummary({
      from,
      to,
      periodo_tipo: req.query.periodo_tipo || 'hora'
    });
    return res.json({ ok: true, ...data });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      erro: err && err.message ? err.message : 'history_error'
    });
  }
});

/**
 * GET /api/observabilidade/history/aggregates
 */
router.get('/history/aggregates', exigirSuperAdminObs, async (req, res) => {
  try {
    if (!historyService.getRepository()) {
      return res.status(503).json({ ok: false, erro: 'history_not_ready' });
    }
    const { from, to } = defaultFromTo(req.query);
    const repo = historyService.getRepository();
    const rows = await repo.listAggregates({
      periodo_tipo: req.query.periodo_tipo || 'hora',
      dominio: req.query.dominio,
      from,
      to,
      limit: req.query.limit
    });
    return res.json({
      ok: true,
      read_only: true,
      total: rows.length,
      rows
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      erro: err && err.message ? err.message : 'aggregates_error'
    });
  }
});

/**
 * GET /api/observabilidade/history/compare
 * Comparação entre dois períodos (READ-ONLY).
 */
router.get('/history/compare', exigirSuperAdminObs, async (req, res) => {
  try {
    if (!historyService.getRepository()) {
      return res.status(503).json({ ok: false, erro: 'history_not_ready' });
    }
    const aFrom = req.query.a_from;
    const aTo = req.query.a_to;
    const bFrom = req.query.b_from;
    const bTo = req.query.b_to;
    if (!aFrom || !aTo || !bFrom || !bTo) {
      return res.status(400).json({
        ok: false,
        erro: 'Informe a_from, a_to, b_from, b_to'
      });
    }
    const data = await historyService.comparePeriods(
      { from: aFrom, to: aTo },
      { from: bFrom, to: bTo }
    );
    return res.json({ ok: true, read_only: true, ...data });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      erro: err && err.message ? err.message : 'compare_error'
    });
  }
});

/**
 * GET /api/observabilidade/history/export
 * Exportação JSON/CSV (READ-ONLY download).
 */
router.get('/history/export', exigirSuperAdminObs, async (req, res) => {
  try {
    if (!historyService.getRepository()) {
      return res.status(503).json({ ok: false, erro: 'history_not_ready' });
    }
    const { from, to } = defaultFromTo(req.query);
    const exported = await historyService.exportHistory({
      format: req.query.format || 'json',
      tipo: req.query.tipo || 'snapshots',
      from,
      to
    });
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    return res.send(exported.body);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      erro: err && err.message ? err.message : 'export_error'
    });
  }
});

/**
 * GET /api/observabilidade/alerts/summary
 */
router.get('/alerts/summary', exigirSuperAdminObs, (req, res) => {
  try {
    const summary = alertEngine.getAlertsSummary();
    return res.json({
      ok: true,
      ...summary
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      erro: err && err.message ? err.message : 'alerts_summary_error'
    });
  }
});

/**
 * GET /api/observabilidade/alerts
 */
router.get('/alerts', exigirSuperAdminObs, (req, res) => {
  try {
    const alerts = alertEngine.listAlerts({
      severidade: req.query.severidade,
      status: req.query.status || 'ativo',
      limit: req.query.limit
    });
    return res.json({
      ok: true,
      read_only: true,
      versao_schema: observabilidade.SCHEMA_VERSION,
      gerado_em: new Date().toISOString(),
      total: alerts.length,
      alerts
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      erro: err && err.message ? err.message : 'alerts_error'
    });
  }
});

/**
 * POST /api/observabilidade/rum
 */
router.post('/rum', (req, res) => {
  try {
    const user = req.user || {};
    const result = ingestRumBatch(req.body || {}, {
      usuario_id: user.id != null ? user.id : (user.usuario_id != null ? user.usuario_id : null),
      terminal_id: req.headers['x-terminal-id'] || user.terminal_id || null
    });
    return res.status(result.ok ? 202 : 400).json({
      ok: result.ok,
      accepted: result.accepted,
      rejected: result.rejected,
      errors: result.errors,
      versao_schema: observabilidade.SCHEMA_VERSION
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      erro: err && err.message ? err.message : 'rum_ingest_error'
    });
  }
});

module.exports = router;
