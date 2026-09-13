'use strict';

/**
 * Central de Equipamentos — API RC3.0
 * Endpoints próprios de dashboard/lista/histórico/saúde.
 */

const central = require('../motores/equipamentos/central/CentralEquipamentosService');
const discoveryService = require('../motores/equipamentos/discovery/DiscoveryService');
const identidadeService = require('../motores/equipamentos/identidade/IdentidadeService');

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  return res.status(status).json({
    success: false,
    error: error.message || mensagemPadrao
  });
}

async function dashboard(req, res) {
  try {
    const data = await central.obterDashboard();
    res.json({ success: true, dashboard: data });
  } catch (error) {
    responderErro(res, error, 'Erro ao obter dashboard da Central.');
  }
}

async function lista(req, res) {
  try {
    const itens = await central.listarItens(req.query || {});
    res.json({ success: true, itens, total: itens.length });
  } catch (error) {
    responderErro(res, error, 'Erro ao listar Central de Equipamentos.');
  }
}

async function historico(req, res) {
  try {
    const eventos = await central.obterHistorico({
      equipamento_id: req.query.equipamento_id || req.params.equipamentoId || null,
      identidade_id: req.query.identidade_id || req.params.identidadeId || null,
      limite: req.query.limite || 50
    });
    res.json({ success: true, eventos });
  } catch (error) {
    responderErro(res, error, 'Erro ao obter histórico.');
  }
}

async function saude(req, res) {
  try {
    const data = await central.obterSaude({
      equipamento_id: req.query.equipamento_id || req.params.equipamentoId || null,
      identidade_id: req.query.identidade_id || req.params.identidadeId || null
    });
    res.json({ success: true, saude: data });
  } catch (error) {
    responderErro(res, error, 'Erro ao obter saúde do equipamento.');
  }
}

async function sessoes(req, res) {
  try {
    const listaSessoes = await central.listarSessoesDiscovery(req.query.limite || 20);
    res.json({ success: true, sessoes: listaSessoes });
  } catch (error) {
    responderErro(res, error, 'Erro ao listar sessões.');
  }
}

async function statusCatalogo(req, res) {
  res.json({
    success: true,
    status: central.STATUS || require('../motores/equipamentos/central/CentralStatus').STATUS,
    rotulos: central.STATUS_ROTULO || require('../motores/equipamentos/central/CentralStatus').STATUS_ROTULO
  });
}

/** Descobrir novamente — consome Discovery + MIE sem alterá-los */
async function descobrir(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const transportes = Array.isArray(body.transportes) && body.transportes.length
      ? body.transportes
      : ['ethernet', 'serial', 'usb'];
    const resultado = await discoveryService.descobrirTodos({
      ...body,
      transportes,
      persistir_sessao: body.persistir_sessao !== false
    });
    let candidatos = resultado.candidatos || [];
    if (body.enriquecer_identidade !== false) {
      candidatos = await identidadeService.enriquecerCandidatos(candidatos, {
        sessao_id: resultado.meta?.sessao_id || null
      });
    }
    res.json({
      success: resultado.sucesso !== false,
      sucesso: resultado.sucesso,
      candidatos,
      erros: resultado.erros,
      meta: resultado.meta
    });
  } catch (error) {
    responderErro(res, error, 'Erro ao executar discovery pela Central.');
  }
}

async function testar(req, res) {
  try {
    const id = req.params.equipamentoId || req.body?.equipamento_id;
    if (!id) return res.status(400).json({ success: false, error: 'equipamento_id obrigatório' });
    const resultado = await central.testarConexao(id);
    res.json({ success: true, resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao testar conexão.');
  }
}

async function diagnostico(req, res) {
  try {
    const id = req.params.equipamentoId || req.body?.equipamento_id;
    if (!id) return res.status(400).json({ success: false, error: 'equipamento_id obrigatório' });
    // RC14.12.1 — apenas valida e delega ao Driver Toledo (sem lógica própria)
    const resultado = await central.diagnosticar(id);
    res.json({ success: true, ...resultado, diagnostico: resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao diagnosticar.', error.statusCode || 500);
  }
}

async function cadastrar(req, res) {
  try {
    const equipamento = await central.cadastrar(req.body || {});
    res.status(201).json({ success: true, equipamento });
  } catch (error) {
    responderErro(res, error, 'Erro ao cadastrar pela Central.');
  }
}

module.exports = {
  dashboard,
  lista,
  historico,
  saude,
  sessoes,
  statusCatalogo,
  descobrir,
  testar,
  diagnostico,
  cadastrar
};
