/**
 * Sprint 14.4 — ToledoDriverController
 */

'use strict';

const ToledoPrixIVDriver = require('./ToledoPrixIVDriver');
const { getCapabilities } = require('./ToledoCapabilities');
const { DRIVER } = require('./ToledoProtocol');

/** Instâncias por host:porta */
const sessions = new Map();

function sessionKey(host, porta) {
  return `${host}:${porta}`;
}

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  return res.status(status).json({
    success: false,
    error: error.message || mensagemPadrao,
    code: error.code || null
  });
}

function getOrCreateDriver(host, porta) {
  const key = sessionKey(host, porta);
  if (!sessions.has(key)) {
    sessions.set(key, new ToledoPrixIVDriver());
  }
  return sessions.get(key);
}

/**
 * POST /api/equipamentos/driver/toledo/connect
 */
async function connect(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const host = body.host || body.ip;
    const porta = body.porta != null ? body.porta : body.porta_tcp;
    const driver = getOrCreateDriver(host, porta);
    const result = await driver.connect({
      host,
      porta,
      timeoutMs: body.timeoutMs,
      handshakeTimeoutMs: body.handshakeTimeoutMs,
      persistir: body.persistir !== false
    });
    return res.json({
      driver: result.driver || DRIVER,
      status: result.status,
      handshake: result.handshake === true,
      latencia: result.latencia
    });
  } catch (error) {
    return responderErro(res, error, 'Erro ao conectar driver Toledo.');
  }
}

/**
 * GET /api/equipamentos/driver/toledo/capabilities
 */
async function capabilities(req, res) {
  try {
    return res.json(getCapabilities());
  } catch (error) {
    return responderErro(res, error, 'Erro ao obter capabilities.');
  }
}

/**
 * POST /api/equipamentos/driver/toledo/disconnect
 */
async function disconnect(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const host = body.host || body.ip;
    const porta = body.porta != null ? body.porta : body.porta_tcp;
    const key = sessionKey(String(host), Number(porta));
    const driver = sessions.get(key) || new ToledoPrixIVDriver();
    if (!sessions.has(key)) {
      driver.host = host;
      driver.porta = Number(porta);
    }
    const result = await driver.disconnect();
    sessions.delete(key);
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro ao desconectar driver Toledo.');
  }
}

/**
 * RC14.14.1 — POST /api/equipamentos/driver/toledo/reconnect
 * TCP + Handshake + Health (nunca só socket).
 */
async function reconnect(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { PORTA_PADRAO } = require('./ToledoProtocol');
    const host = body.host || body.ip;
    const porta = body.porta != null ? body.porta : (body.porta_tcp != null ? body.porta_tcp : PORTA_PADRAO);
    const driver = getOrCreateDriver(host, porta);
    const result = await driver.reconnect({
      host,
      porta,
      timeoutMs: body.timeoutMs,
      handshakeTimeoutMs: body.handshakeTimeoutMs,
      persistir: body.persistir !== false
    });
    return res.json({
      success: true,
      driver: result.driver || DRIVER,
      status: result.status,
      handshake: result.handshake === true,
      latencia: result.latencia,
      reconectado: true,
      etapas: result.etapas || null
    });
  } catch (error) {
    return responderErro(res, error, 'Erro ao reconectar driver Toledo.');
  }
}

/** Apenas para testes */
function _resetSessions() {
  sessions.clear();
}

module.exports = {
  connect,
  capabilities,
  disconnect,
  reconnect,
  _resetSessions,
  getOrCreateDriver
};
