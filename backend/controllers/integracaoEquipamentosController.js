'use strict';

const integration = require('../services/equipamentos-integracao');
const { MODULOS, ACOES } = require('../services/equipamentos-integracao/EquipamentosPermissoes');

function ctx(req, moduloPadrao = MODULOS.ADMIN) {
  return {
    modulo: String(req.headers['x-cds-modulo'] || req.query.modulo || req.body?.modulo || moduloPadrao).toUpperCase(),
    usuario: req.usuario || req.user || {
      id: req.usuarioId,
      nome: req.usuarioNome,
      permissoes: req.permissoes || [],
      perfil: req.usuario?.perfil
    }
  };
}

function ok(res, data) {
  return res.json({ success: true, ...data });
}

function fail(res, err) {
  const code = err.statusCode || 500;
  return res.status(code).json({ success: false, error: err.message || String(err) });
}

async function status(req, res) {
  try {
    const data = await integration.service.obterStatus(ctx(req));
    return ok(res, { status: data });
  } catch (err) {
    return fail(res, err);
  }
}

async function equipamentos(req, res) {
  try {
    const data = await integration.service.listarEquipamentos(ctx(req), req.query);
    return ok(res, data);
  } catch (err) {
    return fail(res, err);
  }
}

async function diagnostico(req, res) {
  try {
    const id = req.params.equipamentoId || req.body?.equipamento_id;
    const data = await integration.service.diagnosticar(ctx(req, MODULOS.ADMIN), id);
    return ok(res, data);
  } catch (err) {
    return fail(res, err);
  }
}

async function sincronizacao(req, res) {
  try {
    const data = await integration.service.sincronizar(ctx(req, MODULOS.COMPRAS), req.body || {});
    return ok(res, data);
  } catch (err) {
    return fail(res, err);
  }
}

async function eventos(req, res) {
  try {
    const data = await integration.service.listarEventos(ctx(req), req.query.limite);
    return ok(res, data);
  } catch (err) {
    return fail(res, err);
  }
}

async function auditoria(req, res) {
  try {
    const data = await integration.service.listarAuditoria(ctx(req), req.query);
    return ok(res, data);
  } catch (err) {
    return fail(res, err);
  }
}

async function pdvVerificar(req, res) {
  try {
    const data = await integration.modulos.pdv.naAberturaCaixa(ctx(req).usuario, req.body || {});
    return ok(res, data);
  } catch (err) {
    return fail(res, err);
  }
}

async function pdvReconectar(req, res) {
  try {
    const data = await integration.modulos.pdv.reconectar(ctx(req).usuario, req.params.equipamentoId);
    return ok(res, data);
  } catch (err) {
    return fail(res, err);
  }
}

async function fiscalValidar(req, res) {
  try {
    const data = await integration.modulos.fiscal.antesDaEmissao(ctx(req).usuario, req.body || {});
    return ok(res, data);
  } catch (err) {
    return fail(res, err);
  }
}

async function tefDescobrir(req, res) {
  try {
    const data = await integration.modulos.tef.descobrirPinpads(ctx(req).usuario, req.body || {});
    return ok(res, data);
  } catch (err) {
    return fail(res, err);
  }
}

async function permissoesCatalogo(req, res) {
  return ok(res, {
    modulos: MODULOS,
    acoes: ACOES,
    matriz: require('../services/equipamentos-integracao/EquipamentosPermissoes').MATRIZ
  });
}

module.exports = {
  status,
  equipamentos,
  diagnostico,
  sincronizacao,
  eventos,
  auditoria,
  pdvVerificar,
  pdvReconectar,
  fiscalValidar,
  tefDescobrir,
  permissoesCatalogo
};
