/**
 * Sprint 14.10 — MonitorController
 */

'use strict';

const equipmentMonitor = require('./EquipmentMonitor');

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  return res.status(status).json({
    success: false,
    error: error.message || mensagemPadrao,
    code: error.code || null
  });
}

async function start(req, res) {
  try {
    const body = req.body || {};
    const result = await equipmentMonitor.start({
      host: body.host || body.ip,
      porta: body.porta != null ? body.porta : body.porta_tcp,
      equipamento_id: body.equipamento_id,
      intervalMs: body.intervalMs != null ? body.intervalMs : body.monitorIntervalMs,
      timeoutMs: body.timeoutMs != null ? body.timeoutMs : body.heartbeatTimeoutMs,
      monitorEnabled: body.monitorEnabled,
      salvarConfig: body.salvarConfig === true,
      persistir: body.persistir !== false,
      immediate: body.immediate !== false
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro ao iniciar monitor.');
  }
}

async function stop(req, res) {
  try {
    const result = await equipmentMonitor.stop();
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro ao parar monitor.');
  }
}

async function pause(req, res) {
  try {
    const result = await equipmentMonitor.pause();
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro ao pausar monitor.');
  }
}

async function resume(req, res) {
  try {
    const result = await equipmentMonitor.resume();
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro ao retomar monitor.');
  }
}

async function status(req, res) {
  try {
    return res.json({ success: true, ...equipmentMonitor.status() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao consultar status do monitor.');
  }
}

async function history(req, res) {
  try {
    const historico = await equipmentMonitor.history({
      limite: Number(req.query.limite) || 50,
      host: req.query.host,
      porta: req.query.porta != null ? Number(req.query.porta) : undefined,
      equipamento_id: req.query.equipamento_id != null
        ? Number(req.query.equipamento_id)
        : undefined,
      session_id: req.query.session_id
    });
    return res.json({ success: true, historico });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar histórico do monitor.');
  }
}

module.exports = {
  start,
  stop,
  pause,
  resume,
  status,
  history
};
