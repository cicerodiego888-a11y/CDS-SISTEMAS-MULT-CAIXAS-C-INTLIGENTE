/**
 * Sprint 14.6 — OperationController
 */

'use strict';

const toledoOperationEngine = require('./ToledoOperationEngine');

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  return res.status(status).json({
    success: false,
    error: error.message || mensagemPadrao,
    code: error.code || null
  });
}

function alvo(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const q = req.query || {};
  return {
    host: body.host || body.ip || q.host || q.ip,
    porta: body.porta != null ? body.porta : (body.porta_tcp != null ? body.porta_tcp : q.porta),
    timeout: body.timeout,
    persistir: body.persistir !== false
  };
}

async function ping(req, res) {
  try {
    const result = await toledoOperationEngine.ping(alvo(req));
    return res.json(result.paraApi());
  } catch (error) {
    return responderErro(res, error, 'Erro na operação PING.');
  }
}

async function identify(req, res) {
  try {
    const result = await toledoOperationEngine.identify(alvo(req));
    return res.json(result.paraApi());
  } catch (error) {
    return responderErro(res, error, 'Erro na operação IDENTIFY.');
  }
}

async function handshake(req, res) {
  try {
    const result = await toledoOperationEngine.handshake(alvo(req));
    return res.json(result.paraApi());
  } catch (error) {
    return responderErro(res, error, 'Erro na operação HANDSHAKE.');
  }
}

async function history(req, res) {
  try {
    const rows = await toledoOperationEngine.history({
      limite: Number(req.query.limite) || 50,
      host: req.query.host,
      porta: req.query.porta != null ? Number(req.query.porta) : undefined
    });
    return res.json({ success: true, historico: rows });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar histórico.');
  }
}

async function status(req, res) {
  try {
    return res.json({
      success: true,
      ...toledoOperationEngine.status({
        host: req.query.host,
        porta: req.query.porta != null ? Number(req.query.porta) : undefined
      })
    });
  } catch (error) {
    return responderErro(res, error, 'Erro ao consultar status.');
  }
}

async function cancel(req, res) {
  try {
    const body = req.body || {};
    const r = toledoOperationEngine.cancel(body.id || body.operationId, {
      host: body.host,
      porta: body.porta
    });
    return res.json({ success: true, ...r });
  } catch (error) {
    return responderErro(res, error, 'Erro ao cancelar operação.');
  }
}

module.exports = {
  ping,
  identify,
  handshake,
  history,
  status,
  cancel
};
