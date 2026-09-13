/**
 * Sprint 15.6 — OrchestratorController
 */

'use strict';

const { getOrchestrator } = require('./EquipmentOrchestrator');
const { JOB_TYPES } = require('./EquipmentJob');

function orch() {
  return getOrchestrator();
}

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  return res.status(status).json({
    success: false,
    error: error.message || mensagemPadrao,
    code: error.code || null
  });
}

function extrairUsuario(req) {
  return req.usuario?.nome || req.user?.nome || req.body?.usuario || null;
}

async function criarJobs(req, res) {
  try {
    const body = req.body || {};
    const equipamentos = Array.isArray(body.equipamentos)
      ? body.equipamentos
      : (body.equipamentoId || body.host
        ? [{
          equipamentoId: body.equipamentoId,
          nome: body.nome,
          host: body.host || body.ip,
          porta: body.porta,
          firmware: body.firmware
        }]
        : []);

    if (!equipamentos.length && Array.isArray(body.equipamentoIds)) {
      body.equipamentoIds.forEach((id) => equipamentos.push({ equipamentoId: id }));
    }

    if (!equipamentos.length) {
      return res.status(400).json({ success: false, error: 'Informe equipamentos ou equipamentoId/host.' });
    }

    const jobs = orch().criarJobs({
      tipo: body.tipo || JOB_TYPES.SYNC_DELTA,
      equipamentos,
      payload: body.payload || {
        produtos: body.produtos,
        confirm: true
      },
      prioridade: body.prioridade,
      usuario: extrairUsuario(req),
      maxTentativas: body.maxTentativas
    });

    return res.status(201).json({ success: true, jobs, total: jobs.length });
  } catch (error) {
    return responderErro(res, error, 'Erro ao criar jobs.');
  }
}

async function listarJobs(req, res) {
  try {
    const jobs = orch().listarJobs({
      status: req.query.status,
      equipamentoId: req.query.equipamentoId,
      limite: Number(req.query.limite) || 100
    });
    return res.json({ success: true, jobs, fila: orch().queue.snapshot() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar jobs.');
  }
}

async function cancelarJob(req, res) {
  try {
    const id = req.params.id || req.body?.id;
    const job = orch().cancelarJob(id, req.body?.motivo || 'cancelado');
    if (!job) return res.status(404).json({ success: false, error: 'Job não encontrado.' });
    return res.json({ success: true, job });
  } catch (error) {
    return responderErro(res, error, 'Erro ao cancelar job.');
  }
}

async function dashboard(req, res) {
  try {
    if (req.query.refresh === '1' || req.query.refresh === 'true') {
      try {
        const lista = await _listarEquipamentosDb();
        if (lista.length) orch().registrarParque(lista);
      } catch (_) { /* ignore */ }
    }
    return res.json({ success: true, dashboard: orch().dashboard() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao obter dashboard.');
  }
}

async function health(req, res) {
  try {
    if (req.query.check === '1' || req.body?.check === true) {
      const lista = await _listarEquipamentosDb().catch(() => []);
      await orch().healthCheckAll(lista);
      await orch().drain(5000);
    } else {
      const lista = await _listarEquipamentosDb().catch(() => []);
      if (lista.length) orch().registrarParque(lista);
    }
    return res.json({
      success: true,
      health: orch().healthList(),
      resumo: orch().health.resumo(),
      notificacoes: orch().notificacoes(20)
    });
  } catch (error) {
    return responderErro(res, error, 'Erro ao obter health.');
  }
}

async function criarScheduler(req, res) {
  try {
    const body = req.body || {};
    const agenda = orch().criarAgenda({
      ...body,
      usuario: extrairUsuario(req)
    });
    orch().start();
    return res.status(201).json({ success: true, agenda });
  } catch (error) {
    return responderErro(res, error, 'Erro ao criar agenda.');
  }
}

async function listarScheduler(req, res) {
  try {
    return res.json({ success: true, agendas: orch().listarAgendas() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar agendas.');
  }
}

async function dispararEvento(req, res) {
  try {
    const evento = req.body?.evento || req.params?.evento;
    const fired = orch().dispararEvento(evento);
    return res.json({ success: true, disparados: fired.length, agendas: fired });
  } catch (error) {
    return responderErro(res, error, 'Erro ao disparar evento.');
  }
}

async function statistics(req, res) {
  try {
    return res.json({ success: true, statistics: orch().statistics() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao obter estatísticas.');
  }
}

async function notificacoes(req, res) {
  try {
    return res.json({
      success: true,
      notificacoes: orch().notificacoes(Number(req.query.limite) || 50)
    });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar notificações.');
  }
}

async function _listarEquipamentosDb() {
  try {
    const db = require('../../../database');
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, nome, host, ip, endereco_ip, porta, porta_tcp, firmware, versao_firmware, ativo, status
         FROM equipamentos
         WHERE COALESCE(ativo, 1) = 1
         ORDER BY nome ASC
         LIMIT 200`,
        [],
        (err, result) => (err ? reject(err) : resolve(result || []))
      );
    });
    return rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      host: r.host || r.ip || r.endereco_ip,
      porta: r.porta ?? r.porta_tcp ?? 9000,
      firmware: r.firmware || r.versao_firmware,
      status: r.status
    }));
  } catch (_) {
    return [];
  }
}

module.exports = {
  criarJobs,
  listarJobs,
  cancelarJob,
  dashboard,
  health,
  criarScheduler,
  listarScheduler,
  dispararEvento,
  statistics,
  notificacoes
};
