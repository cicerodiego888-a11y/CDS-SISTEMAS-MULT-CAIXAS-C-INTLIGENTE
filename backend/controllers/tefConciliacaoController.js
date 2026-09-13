const tefConciliationService = require('../services/tef/tefConciliationService');

async function listarConciliacoes(req, res) {
  try {
    const { data_inicio, data_fim, status, adquirente, limit } = req.query;
    const conciliacoes = await tefConciliationService.listarConciliacoes({
      data_inicio,
      data_fim,
      status,
      adquirente,
      limit: limit ? parseInt(limit) : 100
    });
    res.json(conciliacoes);
  } catch (error) {
    console.error('Erro ao listar conciliações:', error);
    res.status(500).json({ error: error.message });
  }
}

async function criarConciliacao(req, res) {
  try {
    const { transacao_id, ...dadosAdquirente } = req.body;
    const resultado = await tefConciliationService.criarConciliacao(transacao_id, dadosAdquirente);
    res.json({
      success: true,
      message: 'Conciliação criada com sucesso',
      ...resultado
    });
  } catch (error) {
    console.error('Erro ao criar conciliação:', error);
    res.status(500).json({ error: error.message });
  }
}

async function criarFechamento(req, res) {
  try {
    const { data_fechamento } = req.body;
    const resultado = await tefConciliationService.criarFechamento(data_fechamento);
    res.json({
      success: true,
      message: 'Fechamento criado com sucesso',
      ...resultado
    });
  } catch (error) {
    console.error('Erro ao criar fechamento:', error);
    res.status(500).json({ error: error.message });
  }
}

async function listarFechamentos(req, res) {
  try {
    const { data_inicio, data_fim, limit } = req.query;
    const fechamentos = await tefConciliationService.listarFechamentos({
      data_inicio,
      data_fim,
      limit: limit ? parseInt(limit) : 50
    });
    res.json(fechamentos);
  } catch (error) {
    console.error('Erro ao listar fechamentos:', error);
    res.status(500).json({ error: error.message });
  }
}

async function obterResumo(req, res) {
  try {
    const { data_inicio, data_fim } = req.query;
    const resumo = await tefConciliationService.obterResumoConciliacao(
      data_inicio || new Date().toISOString().split('T')[0],
      data_fim || new Date().toISOString().split('T')[0]
    );
    res.json(resumo);
  } catch (error) {
    console.error('Erro ao obter resumo:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  listarConciliacoes,
  criarConciliacao,
  criarFechamento,
  listarFechamentos,
  obterResumo
};
