/**
 * Sprint 14.3 / 15.1 — ConnectionController
 */

'use strict';

const connectionManager = require('./ConnectionManager');

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  return res.status(status).json({
    success: false,
    error: error.message || mensagemPadrao,
    code: error.code || null
  });
}

function extrairAlvo(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const q = req.query || {};
  const id = req.params?.id != null ? Number(req.params.id) : null;
  return {
    id: id || body.id || body.equipamento_id || body.equipamentoId || null,
    equipamentoId: id || body.equipamentoId || body.equipamento_id || null,
    host: body.host || body.ip || q.host || q.ip,
    porta: body.porta != null ? body.porta : (body.porta_tcp != null ? body.porta_tcp : (q.porta != null ? q.porta : q.porta_tcp)),
    porta_com: body.porta_com || q.porta_com,
    transporte: body.transporte || q.transporte,
    timeoutMs: body.timeoutMs != null ? body.timeoutMs : q.timeoutMs,
    persistir: body.persistir !== false
  };
}

/** POST /api/equipamentos/connect */
async function connect(req, res) {
  try {
    const alvo = extrairAlvo(req);
    const result = await connectionManager.connect(alvo);
    // RC14.14.9 — JSON espelha exatamente a EquipmentSession oficial
    const session = result.session || null;
    return res.json({
      status: result.status,
      estado: session?.state || result.estado,
      latencia: session?.latency != null ? session.latency : result.latencia,
      reutilizada: result.reutilizada || false,
      equipamentoId: result.equipamentoId || session?.equipamentoId || null,
      transporte: result.transporte || null,
      connectionMode: session?.connectionMode || result.connectionMode || null,
      connected: session?.connected === true,
      persistent: session?.persistent === true,
      session,
      mensagem: result.status === 'CONNECTED_ALREADY' ? 'Já conectado' : null
    });
  } catch (error) {
    return responderErro(res, error, 'Erro ao conectar.');
  }
}

/** GET /api/equipamentos/status */
async function status(req, res) {
  try {
    const alvo = extrairAlvo(req);
    if (!alvo.host && !alvo.porta && !alvo.equipamentoId && !alvo.id) {
      const err = new Error('Informe host/porta ou id do equipamento.');
      err.statusCode = 400;
      throw err;
    }
    const opts = {
      host: alvo.host,
      porta: alvo.porta != null ? Number(alvo.porta) : undefined,
      equipamentoId: alvo.equipamentoId || alvo.id || undefined
    };
    const h = connectionManager.health(opts);
    const blocos = typeof connectionManager.getSessionSnapshot === 'function'
      ? connectionManager.getSessionSnapshot(opts)
      : { session: h.session, conexao: h.conexao, monitor: h.monitor };

    // RC14.14.6 — Conexão e Monitor sempre idênticos (EquipmentSession)
    return res.json({
      status: blocos.session?.state || h.status,
      estado: blocos.session?.state || h.estado,
      connected: blocos.session?.connected === true,
      conectado: blocos.session?.connected === true,
      latencia: blocos.session?.latency != null ? blocos.session.latency : h.latencia,
      uptime: h.uptime,
      metricas: h.metricas,
      socket: h.socket,
      heartbeat: h.heartbeat,
      connectionMode: blocos.session?.connectionMode || null,
      session: blocos.session,
      conexao: blocos.conexao,
      monitor: blocos.monitor,
      equipamentoId: h.equipamentoId || opts.equipamentoId || null
    });
  } catch (error) {
    return responderErro(res, error, 'Erro ao consultar status.');
  }
}

/** POST /api/equipamentos/disconnect */
async function disconnect(req, res) {
  try {
    const alvo = extrairAlvo(req);
    const result = await connectionManager.disconnect(alvo);
    return res.json({
      status: result.status,
      estado: result.estado,
      latencia: result.latencia
    });
  } catch (error) {
    return responderErro(res, error, 'Erro ao desconectar.');
  }
}

/** POST /api/equipamentos/reconnect — RC14.14.1: TCP + Handshake (Driver Toledo) */
async function reconnect(req, res) {
  try {
    const alvo = extrairAlvo(req);
    const { PORTA_PADRAO } = require('../drivers/toledo/ToledoProtocol');
    const host = alvo.host;
    const porta = Number(alvo.porta) || PORTA_PADRAO;
    if (!host) {
      const err = new Error('host é obrigatório para reconnect.');
      err.statusCode = 400;
      throw err;
    }

    const { getOrCreateDriver } = require('../drivers/toledo/ToledoDriverController');
    const driver = getOrCreateDriver(host, porta);
    const result = await driver.reconnect({
      host,
      porta,
      timeoutMs: alvo.timeoutMs,
      persistir: alvo.persistir
    });

    return res.json({
      success: true,
      status: result.status || 'CONNECTED',
      handshake: result.handshake === true,
      latencia: result.latencia,
      reconectado: true,
      etapas: result.etapas || null,
      equipamentoId: alvo.equipamentoId || null
    });
  } catch (error) {
    return responderErro(res, error, 'Erro ao reconectar.');
  }
}

/** POST /api/equipamentos/ping  ou  POST /:id/ping */
async function ping(req, res) {
  try {
    const alvo = extrairAlvo(req);
    const result = await connectionManager.ping(alvo);
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro ao executar ping.');
  }
}

/** GET /api/equipamentos/connections */
async function listConnections(req, res) {
  try {
    const connections = connectionManager.listConnections();
    return res.json({ success: true, connections, total: connections.length });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar conexões.');
  }
}

/** Sprint 15.1 — por equipamento id */
async function connectById(req, res) {
  req.params = req.params || {};
  return connect(req, res);
}

async function disconnectById(req, res) {
  return disconnect(req, res);
}

async function reconnectById(req, res) {
  return reconnect(req, res);
}

async function pingById(req, res) {
  return ping(req, res);
}

async function statusById(req, res) {
  return status(req, res);
}

module.exports = {
  connect,
  status,
  disconnect,
  reconnect,
  ping,
  listConnections,
  connectById,
  disconnectById,
  reconnectById,
  pingById,
  statusById
};
