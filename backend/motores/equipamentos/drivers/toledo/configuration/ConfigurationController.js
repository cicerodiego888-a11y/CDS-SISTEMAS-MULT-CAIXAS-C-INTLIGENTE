/**
 * Sprint 14.11 — ConfigurationController
 */

'use strict';

const toledoConfigurationEngine = require('./ToledoConfigurationEngine');

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  return res.status(status).json({
    success: false,
    error: error.message || mensagemPadrao,
    code: error.code || null,
    erros: error.meta && error.meta.erros ? error.meta.erros : undefined
  });
}

async function read(req, res) {
  try {
    const body = req.body || {};
    const result = await toledoConfigurationEngine.read({
      host: body.host || body.ip,
      porta: body.porta != null ? body.porta : body.porta_tcp,
      equipamento_id: body.equipamento_id,
      usuario: body.usuario,
      persistir: body.persistir !== false,
      salvarPerfil: body.salvarPerfil !== false,
      timeout: body.timeout
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro ao ler configuração.');
  }
}

async function write(req, res) {
  try {
    const body = req.body || {};
    const result = await toledoConfigurationEngine.write({
      host: body.host || body.ip,
      porta: body.porta != null ? body.porta : body.porta_tcp,
      equipamento_id: body.equipamento_id,
      parametros: body.parametros || body.config,
      config: body.config,
      usuario: body.usuario,
      nomePerfil: body.nomePerfil,
      persistir: body.persistir !== false,
      timeout: body.timeout
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro ao aplicar configuração.');
  }
}

async function compare(req, res) {
  try {
    const body = req.body || {};
    const result = await toledoConfigurationEngine.compare({
      host: body.host || body.ip,
      porta: body.porta != null ? body.porta : body.porta_tcp,
      cds: body.cds || body.proposto,
      balanca: body.balanca || body.atual,
      config: body.config,
      persistir: false
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro ao comparar configuração.');
  }
}

async function restore(req, res) {
  try {
    const body = req.body || {};
    const result = await toledoConfigurationEngine.restore({
      profileId: body.profileId || body.profile_id || body.id,
      host: body.host || body.ip,
      porta: body.porta != null ? body.porta : body.porta_tcp,
      equipamento_id: body.equipamento_id,
      usuario: body.usuario,
      persistir: body.persistir !== false
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro ao restaurar perfil.');
  }
}

async function history(req, res) {
  try {
    const historico = await toledoConfigurationEngine.history({
      limite: Number(req.query.limite) || 50,
      profile_id: req.query.profile_id != null ? Number(req.query.profile_id) : undefined,
      host: req.query.host,
      porta: req.query.porta != null ? Number(req.query.porta) : undefined
    });
    return res.json({ success: true, historico });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar histórico de configuração.');
  }
}

async function exportProfile(req, res) {
  try {
    const body = req.body || {};
    const result = await toledoConfigurationEngine.export({
      profileId: body.profileId || body.profile_id,
      config: body.config,
      nome: body.nome
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro ao exportar perfil.');
  }
}

async function importProfile(req, res) {
  try {
    const body = req.body || {};
    const result = await toledoConfigurationEngine.import({
      ...body,
      perfil: body.perfil,
      parametros: body.parametros || (body.perfil && body.perfil.parametros),
      persistir: body.persistir !== false
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro ao importar perfil.');
  }
}

async function status(req, res) {
  try {
    return res.json({
      success: true,
      ...toledoConfigurationEngine.status(),
      params: toledoConfigurationEngine.listParams()
    });
  } catch (error) {
    return responderErro(res, error, 'Erro ao consultar status de configuração.');
  }
}

async function profiles(req, res) {
  try {
    const perfis = await toledoConfigurationEngine.listProfiles({
      limite: Number(req.query.limite) || 50,
      equipamento_id: req.query.equipamento_id != null
        ? Number(req.query.equipamento_id)
        : undefined,
      host: req.query.host
    });
    return res.json({ success: true, perfis });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar perfis.');
  }
}

module.exports = {
  read,
  write,
  compare,
  restore,
  history,
  exportProfile,
  importProfile,
  status,
  profiles
};
