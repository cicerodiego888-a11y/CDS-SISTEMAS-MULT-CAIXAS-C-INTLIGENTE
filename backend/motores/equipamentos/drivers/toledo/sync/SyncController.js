/**
 * Sprint 14.8 / 15.4 — SyncController
 */

'use strict';

const toledoSyncEngine = require('./ToledoSyncEngine');
const toledoSyncService = require('./ToledoSyncService');
const connectionManager = require('../../../connection/ConnectionManager');

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  return res.status(status).json({
    success: false,
    error: error.message || mensagemPadrao,
    code: error.code || null
  });
}

function extrairUsuario(req) {
  return req.usuario?.id || req.user?.id || req.body?.usuario_id || null;
}

async function resolverAlvo(req) {
  const id = req.params?.id != null ? Number(req.params.id) : null;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const query = req.query || {};
  if (id) {
    if (!connectionManager.isConnected({ equipamentoId: id })) {
      await connectionManager.connect({ equipamentoId: id });
    }
    return {
      equipamentoId: id,
      host: body.host || body.ip,
      porta: body.porta != null ? body.porta : body.porta_tcp,
      ...body
    };
  }
  const host = body.host || body.ip || query.host;
  const porta = body.porta != null ? body.porta : (body.porta_tcp || query.porta);
  return { host, porta, ...body };
}

/* ——— Sprint 14.8 (legado PLU download/compare/sync) ——— */

async function download(req, res) {
  try {
    const body = req.body || {};
    const result = await toledoSyncEngine.download({
      host: body.host || body.ip,
      porta: body.porta != null ? body.porta : body.porta_tcp,
      from: body.from,
      to: body.to,
      range: body.range,
      persistir: body.persistir !== false,
      timeout: body.timeout
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro no download de PLUs.');
  }
}

async function compare(req, res) {
  try {
    const body = req.body || {};
    const result = await toledoSyncEngine.compare({
      produtos: body.produtos || body.cds || body.listaCds,
      balanca: body.balanca || body.plus,
      persistir: body.persistir !== false
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro na comparação de PLUs.');
  }
}

async function sync(req, res) {
  try {
    const body = req.body || {};
    // Se modo full/incremental → Service 15.4; senão legado 14.8
    if (body.modo === 'full' || body.modo === 'incremental' || body.engine === '90AX') {
      return syncV15(req, res);
    }
    const result = await toledoSyncEngine.sync({
      host: body.host || body.ip,
      porta: body.porta != null ? body.porta : body.porta_tcp,
      confirm: body.confirm === true,
      plano: body.plano,
      persistir: body.persistir !== false,
      timeout: body.timeout
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro na sincronização de PLUs.');
  }
}

async function history(req, res) {
  try {
    const id = req.params?.id != null ? Number(req.params.id) : null;
    if (id || req.query?.engine === '90AX') {
      const historico = await toledoSyncService.getHistory({
        limite: Number(req.query.limite) || 50,
        host: req.query.host,
        porta: req.query.porta != null ? Number(req.query.porta) : undefined,
        equipamentoId: id || (req.query.equipamento_id != null ? Number(req.query.equipamento_id) : undefined),
        modo: req.query.modo
      });
      return res.json({ success: true, historico });
    }
    const historico = await toledoSyncEngine.history({
      limite: Number(req.query.limite) || 50,
      host: req.query.host,
      porta: req.query.porta != null ? Number(req.query.porta) : undefined
    });
    return res.json({ success: true, historico });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar histórico de sync.');
  }
}

async function getById(req, res) {
  try {
    const row = await toledoSyncEngine.getById(req.params.id);
    return res.json({ success: true, sync: row });
  } catch (error) {
    return responderErro(res, error, 'Erro ao obter sincronização.');
  }
}

async function status(req, res) {
  try {
    const id = req.params?.id;
    if (id != null || req.query?.engine === '90AX') {
      return res.json({ success: true, ...toledoSyncService.status() });
    }
    return res.json({ success: true, ...toledoSyncEngine.status() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao consultar status de sync.');
  }
}

async function cancel(req, res) {
  try {
    const body = req.body || {};
    if (req.params?.id != null || body.engine === '90AX') {
      return res.json({ success: true, ...toledoSyncService.cancel() });
    }
    return res.json({ success: true, ...toledoSyncEngine.cancel() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao cancelar sync.');
  }
}

/* ——— Sprint 15.4 ——— */

async function syncV15(req, res) {
  try {
    const alvo = await resolverAlvo(req);
    const modo = alvo.modo || 'incremental';
    const result = await toledoSyncService.sync(modo, {
      ...alvo,
      confirm: alvo.confirm === true || req.body?.confirm === true,
      produtos: alvo.produtos || alvo.cds || alvo.listaCds,
      ultimaSync: alvo.ultimaSync || alvo.balanca || alvo.snapshot,
      usuarioId: extrairUsuario(req),
      persistir: alvo.persistir !== false,
      tamanhoLote: alvo.tamanhoLote,
      timeoutMs: alvo.timeoutMs || alvo.timeout,
      versaoCarga: alvo.versaoCarga
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro na sincronização 90AX.');
  }
}

async function syncFull(req, res) {
  req.body = { ...(req.body || {}), modo: 'full', confirm: req.body?.confirm === true };
  return syncV15(req, res);
}

async function syncIncremental(req, res) {
  req.body = { ...(req.body || {}), modo: 'incremental', confirm: req.body?.confirm === true };
  return syncV15(req, res);
}

async function syncCancel(req, res) {
  try {
    return res.json({ success: true, ...toledoSyncService.cancel() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao cancelar sync.');
  }
}

async function syncStatus(req, res) {
  try {
    return res.json({ success: true, ...toledoSyncService.status() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao consultar status de sync.');
  }
}

async function syncHistory(req, res) {
  try {
    const id = req.params?.id != null ? Number(req.params.id) : null;
    const historico = await toledoSyncService.getHistory({
      limite: Number(req.query.limite) || 50,
      host: req.query.host,
      porta: req.query.porta != null ? Number(req.query.porta) : undefined,
      equipamentoId: id,
      modo: req.query.modo
    });
    return res.json({ success: true, historico });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar histórico.');
  }
}

async function syncReport(req, res) {
  try {
    const syncId = req.query.syncId || req.query.id || req.params.syncId;
    const relatorio = await toledoSyncService.getReport(syncId ? Number(syncId) : null);
    return res.json({ success: true, relatorio });
  } catch (error) {
    return responderErro(res, error, 'Erro ao obter relatório.');
  }
}

/* ——— Sprint 15.5 — Delta / Versões / Rollback / Audit ——— */

function alvoFromReq(req) {
  const id = req.params?.id != null ? Number(req.params.id) : null;
  const body = req.body || {};
  const query = req.query || {};
  return {
    equipamentoId: id || body.equipamentoId || body.equipamento_id || undefined,
    host: body.host || body.ip || query.host,
    porta: body.porta != null ? body.porta : (body.porta_tcp || query.porta)
  };
}

async function syncVersions(req, res) {
  try {
    const alvo = alvoFromReq(req);
    const versoes = await toledoSyncService.listVersions(alvo, Number(req.query.limite) || 50);
    const cargas = await toledoSyncService.loads.refresh(alvo);
    return res.json({ success: true, versoes, cargas });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar versões.');
  }
}

async function syncVersion(req, res) {
  try {
    const alvo = alvoFromReq(req);
    const versao = req.params.version || req.params.versao;
    const row = await toledoSyncService.getVersion(alvo, versao);
    return res.json({ success: true, versao: row });
  } catch (error) {
    return responderErro(res, error, 'Erro ao obter versão.');
  }
}

async function syncDelta(req, res) {
  try {
    const alvo = {
      ...alvoFromReq(req),
      ...(req.body || {}),
      ...(req.query || {})
    };
    const preview = await toledoSyncService.computeDelta({
      ...alvo,
      produtos: alvo.produtos || alvo.cds || alvo.listaCds,
      ultimaSync: alvo.ultimaSync || alvo.balanca || alvo.snapshot
    });
    return res.json(preview);
  } catch (error) {
    return responderErro(res, error, 'Erro ao calcular delta.');
  }
}

async function syncDeltaExec(req, res) {
  try {
    const body = req.body || {};
    // Preview (sem confirm) — só calcula delta, sem abrir socket
    if (body.preview === true || body.confirm !== true) {
      const alvo = { ...alvoFromReq(req), ...body };
      const preview = await toledoSyncService.computeDelta({
        ...alvo,
        produtos: alvo.produtos || alvo.cds || alvo.listaCds,
        ultimaSync: alvo.ultimaSync || alvo.balanca || alvo.snapshot
      });
      return res.json(preview);
    }
    const alvo = await resolverAlvo(req);
    const result = await toledoSyncService.syncDelta({
      ...alvo,
      confirm: true,
      produtos: alvo.produtos || alvo.cds || alvo.listaCds,
      ultimaSync: alvo.ultimaSync || alvo.balanca,
      usuarioId: extrairUsuario(req),
      persistir: alvo.persistir !== false,
      forcar: alvo.forcar === true,
      autoRollback: alvo.autoRollback !== false
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro no delta sync.');
  }
}

async function syncRollback(req, res) {
  try {
    const alvo = await resolverAlvo(req);
    const result = await toledoSyncService.rollback(alvo, {
      versao: alvo.versao || req.body?.versao,
      reenviar: alvo.reenviar === true || req.body?.reenviar === true,
      usuarioId: extrairUsuario(req),
      usuario: req.body?.usuario,
      tamanhoLote: alvo.tamanhoLote
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro no rollback.');
  }
}

async function syncAudit(req, res) {
  try {
    const id = req.params?.id != null ? Number(req.params.id) : null;
    const audit = await toledoSyncService.getAudit({
      equipamentoId: id || (req.query.equipamento_id != null ? Number(req.query.equipamento_id) : undefined),
      versionId: req.query.version_id != null ? Number(req.query.version_id) : undefined,
      limite: Number(req.query.limite) || 100
    });
    return res.json({ success: true, audit });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar auditoria.');
  }
}

async function syncCompareVersions(req, res) {
  try {
    const alvo = alvoFromReq(req);
    const a = req.query.a || req.query.versaoA || req.body?.a;
    const b = req.query.b || req.query.versaoB || req.body?.b;
    if (a == null || b == null) {
      const err = new Error('Informe versões a e b para comparar.');
      err.statusCode = 400;
      throw err;
    }
    const result = await toledoSyncService.compareVersions(alvo, a, b);
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro ao comparar versões.');
  }
}

module.exports = {
  download,
  compare,
  sync,
  history,
  getById,
  status,
  cancel,
  syncFull,
  syncIncremental,
  syncCancel,
  syncStatus,
  syncHistory,
  syncReport,
  syncV15,
  syncVersions,
  syncVersion,
  syncDelta,
  syncDeltaExec,
  syncRollback,
  syncAudit,
  syncCompareVersions
};
