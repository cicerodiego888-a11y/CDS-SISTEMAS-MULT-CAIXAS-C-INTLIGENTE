const tefConfigService = require('../services/tef/tefConfigService');
const { gravarAuditoria } = require('../services/auditoria');

function auditarConfiguracaoTef(req, acao, detalhes = {}) {
  const usuario = req.user || {};
  gravarAuditoria({
    usuario_id: usuario.id || null,
    usuario_nome: usuario.username || usuario.nome || null,
    modulo: 'tef',
    acao,
    referencia_tipo: 'tef_configuracao',
    referencia_id: null,
    detalhes: { ...detalhes, ip: req.ip || null },
    ip_requisicao: req.ip || null
  }).catch((auditErr) => console.error('Erro ao gravar auditoria TEF config:', auditErr));
}

function responderErro(res, error, mensagemPadrao) {
  const status = error.statusCode || 500;
  return res.status(status).json({
    error: error.message || mensagemPadrao
  });
}

async function getConfiguracao(req, res) {
  try {
    const config = await tefConfigService.obterConfiguracao();
    res.json(config);
  } catch (error) {
    console.error('Erro ao carregar configuração TEF:', error);
    responderErro(res, error, 'Erro ao carregar configuração TEF.');
  }
}

async function postConfiguracao(req, res) {
  try {
    const config = await tefConfigService.salvarConfiguracao(req.body || {});

    auditarConfiguracaoTef(req, 'salvar_configuracao', {
      chaves: Object.keys(req.body || {})
    });

    res.json({
      success: true,
      message: 'Configuração TEF salva com sucesso.',
      config
    });
  } catch (error) {
    console.error('Erro ao salvar configuração TEF:', error);
    responderErro(res, error, 'Erro ao salvar configuração TEF.');
  }
}

async function putConfiguracao(req, res) {
  try {
    const config = await tefConfigService.atualizarConfiguracao(req.body || {});
    auditarConfiguracaoTef(req, 'atualizar_configuracao', {
      chaves: Object.keys(req.body || {})
    });
    res.json({
      success: true,
      message: 'Configuração TEF atualizada com sucesso.',
      config
    });
  } catch (error) {
    console.error('Erro ao atualizar configuração TEF:', error);
    responderErro(res, error, 'Erro ao atualizar configuração TEF.');
  }
}

async function getStatus(req, res) {
  try {
    const status = await tefConfigService.obterStatus();
    res.json(status);
  } catch (error) {
    console.error('Erro ao consultar status TEF:', error);
    responderErro(res, error, 'Erro ao consultar status TEF.');
  }
}

async function postTestar(req, res) {
  try {
    const resultado = await tefConfigService.testarConexao();
    res.json(resultado);
  } catch (error) {
    console.error('Erro ao testar configuração TEF:', error);
    responderErro(res, error, 'Erro ao testar configuração TEF.');
  }
}

module.exports = {
  getConfiguracao,
  postConfiguracao,
  putConfiguracao,
  getStatus,
  postTestar
};
