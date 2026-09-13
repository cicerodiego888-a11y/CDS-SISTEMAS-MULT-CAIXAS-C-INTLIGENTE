/**
 * Sprint 14.5 — CaptureController
 */

'use strict';

const engineeringLab = require('./EngineeringLab');

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  return res.status(status).json({
    success: false,
    error: error.message || mensagemPadrao,
    code: error.code || null
  });
}

/**
 * POST /api/equipamentos/lab/start
 */
async function start(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const session = await engineeringLab.start({
      host: body.host || body.ip,
      porta: body.porta != null ? body.porta : body.porta_tcp,
      driver: body.driver || 'TOLEDO_PRIX4',
      equipamento: body.equipamento || null,
      persistir: body.persistir !== false
    });
    return res.json({ success: true, session });
  } catch (error) {
    return responderErro(res, error, 'Erro ao iniciar captura.');
  }
}

/**
 * POST /api/equipamentos/lab/stop
 */
async function stop(req, res) {
  try {
    const session = await engineeringLab.stop();
    return res.json({ success: true, session });
  } catch (error) {
    return responderErro(res, error, 'Erro ao parar captura.');
  }
}

/**
 * POST /api/equipamentos/lab/pause
 */
async function pause(req, res) {
  try {
    return res.json({ success: true, session: engineeringLab.pause() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao pausar captura.');
  }
}

/**
 * POST /api/equipamentos/lab/resume
 */
async function resume(req, res) {
  try {
    return res.json({ success: true, session: engineeringLab.resume() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao retomar captura.');
  }
}

/**
 * GET /api/equipamentos/lab/status
 */
async function status(req, res) {
  try {
    return res.json({ success: true, ...engineeringLab.status() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao consultar status do lab.');
  }
}

/**
 * GET /api/equipamentos/lab/session/:id
 */
async function session(req, res) {
  try {
    const data = await engineeringLab.getSession(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Sessão não encontrada' });
    }
    return res.json({ success: true, ...data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao obter sessão.');
  }
}

/**
 * GET /api/equipamentos/lab/export/:id?format=JSON|TXT|HEX
 */
async function exportSession(req, res) {
  try {
    const formato = req.query.format || req.query.formato || 'JSON';
    const result = await engineeringLab.export(req.params.id, formato);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="captura-${req.params.id}.${String(result.format).toLowerCase()}"`);
    return res.send(result.body);
  } catch (error) {
    return responderErro(res, error, 'Erro ao exportar sessão.');
  }
}

module.exports = {
  start,
  stop,
  pause,
  resume,
  status,
  session,
  exportSession
};
