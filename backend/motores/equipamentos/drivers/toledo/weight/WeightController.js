/**
 * Sprint 14.9 — WeightController
 */

'use strict';

const toledoWeightEngine = require('./ToledoWeightEngine');

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  return res.status(status).json({
    success: false,
    error: error.message || mensagemPadrao,
    code: error.code || null
  });
}

async function read(req, res) {
  try {
    const body = req.body || {};
    const result = await toledoWeightEngine.readOnce({
      host: body.host || body.ip,
      porta: body.porta != null ? body.porta : body.porta_tcp,
      equipamento_id: body.equipamento_id,
      persistir: body.persistir !== false,
      timeout: body.timeout
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro na leitura de peso.');
  }
}

async function status(req, res) {
  try {
    return res.json({ success: true, ...toledoWeightEngine.status() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao consultar status de pesagem.');
  }
}

async function history(req, res) {
  try {
    const historico = await toledoWeightEngine.history({
      limite: Number(req.query.limite) || 50,
      host: req.query.host,
      porta: req.query.porta != null ? Number(req.query.porta) : undefined,
      equipamento_id: req.query.equipamento_id != null
        ? Number(req.query.equipamento_id)
        : undefined
    });
    return res.json({ success: true, historico });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar histórico de pesagens.');
  }
}

async function cancel(req, res) {
  try {
    return res.json({ success: true, ...toledoWeightEngine.cancel() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao cancelar leitura.');
  }
}

module.exports = {
  read,
  status,
  history,
  cancel
};
