/**
 * Sprint 15.2 — ProtocolController
 * API HTTP do Motor 90AX.
 */

'use strict';

const engine = require('./Toledo90AXEngine');
const connectionManager = require('../../../connection/ConnectionManager');

function responderErro(res, error, mensagemPadrao = 'Erro de protocolo', statusPadrao = 500) {
  const msg = error?.message || mensagemPadrao;
  const semRx = error?.code === 'RX_TIMEOUT'
    || error?.code === 'TIMEOUT'
    || error?.name === 'TimeoutError'
    || /timeout|nenhuma resposta|aguardando resposta/i.test(String(msg));
  const status = semRx ? (error.statusCode || 408) : (error.statusCode || statusPadrao);
  return res.status(status).json({
    success: false,
    sucesso: false,
    error: semRx ? 'Nenhuma resposta recebida da balança.' : msg,
    mensagem: semRx ? 'Nenhuma resposta recebida da balança.' : msg,
    code: error?.code || (semRx ? 'RX_TIMEOUT' : null),
    timeout: semRx === true,
    txHex: error?.hex_enviado || error?.txHex || null
  });
}

async function resolverAlvo(req) {
  const id = req.params?.id != null ? Number(req.params.id) : null;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (id) {
    // Garante conexão via Connection Manager V2
    const conectado = connectionManager.isConnected({ equipamentoId: id });
    if (!conectado) {
      await connectionManager.connect({ equipamentoId: id });
    }
    return { equipamentoId: id, ...body };
  }
  const host = body.host || body.ip;
  const porta = body.porta || body.porta_tcp;
  if (host && porta) {
    if (!connectionManager.isConnected({ host, porta })) {
      await connectionManager.connect({ host, porta, transporte: 'ethernet' });
    }
    return { host, porta, ...body };
  }
  const err = new Error('Informe id do equipamento ou host/porta.');
  err.statusCode = 400;
  throw err;
}

async function identify(req, res) {
  try {
    const alvo = await resolverAlvo(req);
    engine.bind(alvo);
    const result = await engine.identify(alvo.payload || null, alvo);
    return res.json({ success: true, ...result });
  } catch (error) {
    return responderErro(res, error, 'Erro no identify.');
  }
}

async function status(req, res) {
  try {
    const alvo = await resolverAlvo(req);
    engine.bind(alvo);
    const result = await engine.getStatus(alvo.payload || null, alvo);
    return res.json({ success: true, ...result });
  } catch (error) {
    return responderErro(res, error, 'Erro no status.');
  }
}

async function ping(req, res) {
  try {
    const alvo = await resolverAlvo(req);
    engine.bind(alvo);
    const result = await engine.ping(alvo.payload || null, alvo);
    return res.json({ success: true, ...result });
  } catch (error) {
    return responderErro(res, error, 'Erro no ping.');
  }
}

async function raw(req, res) {
  try {
    const alvo = await resolverAlvo(req);
    engine.bind(alvo);
    const hex = alvo.hex || alvo.frame || alvo.raw;
    if (!hex) {
      const err = new Error('Informe hex/frame bruto.');
      err.statusCode = 400;
      throw err;
    }
    const buf = Buffer.isBuffer(hex) ? hex : Buffer.from(String(hex).replace(/\s+/g, ''), 'hex');
    const result = await engine.executeRaw(buf, alvo);
    return res.json({ success: true, ...result });
  } catch (error) {
    return responderErro(res, error, 'Erro no raw.');
  }
}

async function history(req, res) {
  try {
    const limite = Number(req.query?.limite || req.body?.limite) || 50;
    return res.json({
      success: true,
      history: engine.history({ limite }),
      status: engine.status()
    });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar histórico.');
  }
}

async function engineStatus(req, res) {
  try {
    return res.json({ success: true, ...engine.status() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao consultar status do engine.');
  }
}

module.exports = {
  identify,
  status,
  ping,
  raw,
  history,
  engineStatus
};
