/**
 * Sprint 14.2 — HTTP controller Fingerprint Engine V1.0
 */

'use strict';

const fingerprintService = require('./FingerprintService');
const FingerprintRepository = require('./FingerprintRepository');

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  return res.status(status).json({
    success: false,
    error: error.message || mensagemPadrao,
    code: error.code || null
  });
}

/**
 * POST /api/equipamentos/fingerprint
 * Body: { host, porta }
 */
async function fingerprint(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const host = body.host || body.ip;
    const porta = body.porta != null ? body.porta : body.porta_tcp;

    const candidato = await fingerprintService.identificar(
      { host, porta },
      {
        timeoutMs: body.timeoutMs,
        readMs: body.readMs,
        persistir: body.persistir !== false,
        // respostaSimulada apenas para testes internos — não expor em prod docs
        respostaSimulada: body.__respostaSimulada
      }
    );

    return res.json(candidato.paraRespostaHttp());
  } catch (error) {
    return responderErro(res, error, 'Erro ao executar fingerprint.');
  }
}

async function listarIdentificados(req, res) {
  try {
    const repo = new FingerprintRepository();
    const rows = await repo.listar({ limite: Number(req.query.limite) || 100 });
    res.json({ success: true, equipamentos: rows });
  } catch (error) {
    responderErro(res, error, 'Erro ao listar equipamentos identificados.');
  }
}

module.exports = {
  fingerprint,
  listarIdentificados
};
