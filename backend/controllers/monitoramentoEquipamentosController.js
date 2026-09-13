'use strict';

/**
 * API RC3.1 — Monitoramento Inteligente (Heartbeat)
 */

const monitorService = require('../motores/equipamentos/monitor/MonitorService');
const heartbeatEngine = require('../motores/equipamentos/monitor/HeartbeatEngine');
const { HB_STATUS, HB_STATUS_ROTULO, EVENTOS } = require('../motores/equipamentos/monitor/HeartbeatStatus');

function ok(res, data) {
  return res.json({ success: true, ...data });
}

function fail(res, err, status = 500) {
  const code = err.statusCode || status;
  return res.status(code).json({ success: false, error: err.message || String(err) });
}

async function dashboard(req, res) {
  try {
    const dashboardHb = await heartbeatEngine.obterDashboard();
    return ok(res, {
      ativo: monitorService.estaAtivo(),
      dashboard: dashboardHb
    });
  } catch (err) {
    return fail(res, err);
  }
}

async function lista(req, res) {
  try {
    const estados = await heartbeatEngine.listarEstados();
    return ok(res, { itens: estados });
  } catch (err) {
    return fail(res, err);
  }
}

async function statusCatalogo(req, res) {
  return ok(res, { status: HB_STATUS, rotulos: HB_STATUS_ROTULO, eventos: EVENTOS });
}

async function estado(req, res) {
  try {
    const estadoHb = await heartbeatEngine.obterEstado(req.params.equipamentoId);
    if (!estadoHb) {
      return res.status(404).json({ success: false, error: 'Sem heartbeat para este equipamento' });
    }
    return ok(res, { estado: estadoHb });
  } catch (err) {
    return fail(res, err);
  }
}

async function eventos(req, res) {
  try {
    const listaEv = await heartbeatEngine.obterEventos(
      req.params.equipamentoId,
      req.query.limite
    );
    return ok(res, { eventos: listaEv });
  } catch (err) {
    return fail(res, err);
  }
}

async function saude(req, res) {
  try {
    const saudeHb = await heartbeatEngine.obterSaude(req.params.equipamentoId);
    return ok(res, { saude: saudeHb });
  } catch (err) {
    return fail(res, err);
  }
}

async function verificar(req, res) {
  try {
    const resultado = await monitorService.verificarAgora(req.params.equipamentoId);
    return ok(res, { resultado });
  } catch (err) {
    return fail(res, err, err.statusCode || 500);
  }
}

async function iniciar(req, res) {
  try {
    monitorService.iniciar(req.body || {});
    return ok(res, { ativo: monitorService.estaAtivo() });
  } catch (err) {
    return fail(res, err);
  }
}

async function parar(req, res) {
  try {
    monitorService.parar();
    return ok(res, { ativo: false });
  } catch (err) {
    return fail(res, err);
  }
}

async function statusGeral(req, res) {
  try {
    const snap = await monitorService.obterStatusGeral();
    return ok(res, snap);
  } catch (err) {
    return fail(res, err);
  }
}

async function alertasCanais(req, res) {
  const { CANAIS } = require('../motores/equipamentos/monitor/AlertChannel');
  return ok(res, {
    canais: CANAIS,
    nota: 'Canais externos (e-mail, WhatsApp, webhook) preparados para RC futura.'
  });
}

module.exports = {
  dashboard,
  lista,
  statusCatalogo,
  estado,
  eventos,
  saude,
  verificar,
  iniciar,
  parar,
  statusGeral,
  alertasCanais
};
