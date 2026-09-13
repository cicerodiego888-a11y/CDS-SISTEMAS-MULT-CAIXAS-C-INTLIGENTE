/**
 * Sprint 14.15.1 — Controllers HTTP do Bridge MGV6.
 * RC14.15.3 — bloqueio cruzado modo_envio + exposição do modo na config.
 */

'use strict';

const repo = require('./MGV6Repository');
const syncService = require('./MGV6SyncService');
const modoEnvio = require('./MGV6ModoEnvio');
const { MGV6Error } = require('./MGV6Errors');

function responderErro(res, err, fallback) {
  const status = err.statusCode || (err instanceof MGV6Error ? err.statusCode : 500) || 500;
  const codigo = err.codigo || err.code || undefined;
  return res.status(status).json({
    sucesso: false,
    error: err.message || fallback || 'Erro MGV6',
    mensagem: err.message || fallback || 'Erro MGV6',
    code: err.code || undefined,
    codigo,
    details: err.details || undefined
  });
}

/**
 * RC14.15.12 — por padrão NÃO inicia MGV6 (aguarda confirmação do usuário).
 * Passar iniciarMgv6/autoLaunch=true apenas para automação explícita.
 */
function resolverAutoLaunchDoBody(body) {
  if (body.iniciarMgv6 === true || body.iniciar_mgv6 === true) return true;
  if (body.autoLaunch === true || body.auto_launch === true) return true;
  if (body.iniciarMgv6 === false || body.iniciar_mgv6 === false) return false;
  if (body.autoLaunch === false || body.auto_launch === false) return false;
  return false;
}

/**
 * POST /api/equipamentos/mgv6/export
 */
async function exportar(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const equipamentoId = Number(body.equipamentoId ?? body.equipamento_id ?? req.params.id);
    const produtoIds = body.produtoIds || body.produto_ids || body.ids || [];
    if (!Array.isArray(produtoIds) || !produtoIds.length) {
      const err = new Error('Informe produtoIds');
      err.statusCode = 400;
      throw err;
    }
    const result = await syncService.exportarPorIds(equipamentoId, produtoIds, {
      autoLaunch: resolverAutoLaunchDoBody(body)
    });
    return res.json(result);
  } catch (err) {
    return responderErro(res, err, 'Erro ao exportar MGV6');
  }
}

/**
 * POST /api/equipamentos/mgv6/export-all
 */
async function exportarTodos(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const equipamentoId = Number(body.equipamentoId ?? body.equipamento_id ?? req.params.id);
    const result = await syncService.exportarTodos(equipamentoId, {
      autoLaunch: resolverAutoLaunchDoBody(body)
    });
    return res.json(result);
  } catch (err) {
    return responderErro(res, err, 'Erro ao exportar todos MGV6');
  }
}

/**
 * POST /api/equipamentos/mgv6/launch
 * RC14.15.12 — inicia MGV6.exe após o usuário confirmar no diálogo.
 */
async function iniciar(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const equipamentoId = Number(body.equipamentoId ?? body.equipamento_id ?? req.params.id);
    if (!Number.isFinite(equipamentoId) || equipamentoId <= 0) {
      const err = new Error('Informe equipamentoId');
      err.statusCode = 400;
      throw err;
    }
    const result = await syncService.iniciarMgv6(equipamentoId);
    // RC14.15.17 — não mascarar falha de spawn como HTTP 200 com iniciado:true
    if (result && result.sucesso === false) {
      return res.status(500).json({
        sucesso: false,
        iniciado: false,
        pid: null,
        path: result.path || null,
        cwd: result.cwd || null,
        motivo: result.motivo || 'Não foi possível iniciar o MGV6',
        error: result.motivo || 'Não foi possível iniciar o MGV6',
        mensagem: result.motivo || 'Não foi possível iniciar o MGV6',
        aviso: result.aviso || undefined,
        transmitidoBalanca: false
      });
    }
    return res.json(result);
  } catch (err) {
    const details = err.details && typeof err.details === 'object' ? err.details : {};
    return res.status(err.statusCode || 500).json({
      sucesso: false,
      iniciado: false,
      pid: details.pid != null ? details.pid : null,
      path: details.path || null,
      cwd: details.cwd || null,
      motivo: err.message || 'Não foi possível iniciar o MGV6',
      error: err.message || 'Não foi possível iniciar o MGV6',
      mensagem: err.message || 'Não foi possível iniciar o MGV6',
      code: err.code || err.codigo || details.code || undefined,
      codigo: err.code || err.codigo || details.code || undefined,
      details,
      transmitidoBalanca: false
    });
  }
}

/**
 * GET /api/equipamentos/mgv6/history
 */
async function historico(req, res) {
  try {
    const equipamentoId = req.query.equipamentoId || req.query.equipamento_id || null;
    const limite = req.query.limite || 50;
    const rows = await repo.listarHistorico({ equipamentoId, limite });
    return res.json({ sucesso: true, historico: rows });
  } catch (err) {
    return responderErro(res, err, 'Erro ao listar histórico MGV6');
  }
}

/**
 * GET /api/equipamentos/mgv6/config/:equipamentoId
 */
async function obterConfig(req, res) {
  try {
    const equipamentoId = Number(req.params.equipamentoId);
    const config = await repo.obterConfig(equipamentoId);
    const modo = await modoEnvio.obterModoEnvio(equipamentoId);
    return res.json({
      sucesso: true,
      modo_envio: modo,
      config: { ...config, modo_envio: modo, enabled: modo === modoEnvio.MODO_MGV6 }
    });
  } catch (err) {
    return responderErro(res, err, 'Erro ao obter config MGV6');
  }
}

/**
 * PUT /api/equipamentos/mgv6/config/:equipamentoId
 */
async function salvarConfig(req, res) {
  try {
    const equipamentoId = Number(req.params.equipamentoId);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const raw = body.config || body;
    let modo = null;
    if (raw.modo_envio != null || body.modo_envio != null) {
      modo = await modoEnvio.salvarModoEnvio(
        equipamentoId,
        raw.modo_envio != null ? raw.modo_envio : body.modo_envio
      );
    } else if (raw.enabled === true || raw.enabled === 1 || raw.enabled === 'true') {
      // Compat UI antiga: checkbox enabled → modo MGV6 explícito
      modo = await modoEnvio.salvarModoEnvio(equipamentoId, modoEnvio.MODO_MGV6);
    } else if (raw.enabled === false || raw.enabled === 0 || raw.enabled === 'false') {
      modo = await modoEnvio.salvarModoEnvio(equipamentoId, modoEnvio.MODO_TCP);
    } else {
      modo = await modoEnvio.obterModoEnvio(equipamentoId);
    }

    const config = await repo.salvarConfig(equipamentoId, {
      ...raw,
      enabled: modo === modoEnvio.MODO_MGV6
    });
    return res.json({
      sucesso: true,
      modo_envio: modo,
      config: { ...config, modo_envio: modo },
      message: 'Configuração MGV6 salva'
    });
  } catch (err) {
    return responderErro(res, err, 'Erro ao salvar config MGV6');
  }
}

/**
 * POST /api/equipamentos/mgv6/test-folder
 */
async function testarPasta(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const equipamentoId = Number(body.equipamentoId ?? body.equipamento_id);
    const result = await syncService.testarPasta(equipamentoId, {
      exportFolder: body.exportFolder,
      fileName: body.fileName
    });
    return res.json(result);
  } catch (err) {
    return responderErro(res, err, 'Pasta inválida');
  }
}

module.exports = {
  exportar,
  exportarTodos,
  iniciar,
  historico,
  obterConfig,
  salvarConfig,
  testarPasta
};
