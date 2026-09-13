/**
 * EntregaController — Sprint 2.1
 */

const { entregaService } = require('../services/entrega/EntregaService');
const { contextoAuditoriaRequisicao } = require('../services/auditoria');

async function listar(req, res) {
  try {
    const data = await entregaService.listar({
      status: req.query.status,
      status_venda: req.query.status_venda
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao listar entregas.' });
  }
}

async function listarPendentes(_req, res) {
  try {
    const data = await entregaService.listarPendentes();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao listar pendentes.' });
  }
}

async function buscarPorId(req, res) {
  try {
    const data = await entregaService.buscarPorId(req.params.id);
    if (!data.item) {
      return res.status(404).json({ error: 'Entrega não encontrada.' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao buscar entrega.' });
  }
}

async function alertas(_req, res) {
  try {
    const data = await entregaService.listarAlertas();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro nos alertas.' });
  }
}

async function dashboard(_req, res) {
  try {
    const data = await entregaService.dashboard();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro no dashboard.' });
  }
}

async function reservasProduto(req, res) {
  try {
    const data = await entregaService.listarReservasProduto(req.params.produtoId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao listar reservas.' });
  }
}

async function porEntregador(req, res) {
  try {
    const data = await entregaService.agruparPorEntregador({
      status: req.query.status
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao agrupar por entregador.' });
  }
}

async function aguardandoPrestacao(_req, res) {
  try {
    const data = await entregaService.aguardandoPrestacao();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao listar aguardando prestação.' });
  }
}

async function resumo(_req, res) {
  try {
    const data = await entregaService.resumoEntregas();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro no resumo.' });
  }
}

async function resumoPorStatus(_req, res) {
  try {
    const data = await entregaService.resumoPorStatus();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro no resumo por status.' });
  }
}

async function totaisReservados(_req, res) {
  try {
    const data = await entregaService.totaisReservados();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro nos totais reservados.' });
  }
}

async function timeline(req, res) {
  try {
    const data = await entregaService.obterTimeline(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro na timeline.' });
  }
}

async function prestacao(req, res) {
  try {
    const data = await entregaService.registrarPrestacao(
      req.params.id,
      req.body || {},
      req,
      contextoAuditoriaRequisicao(req)
    );
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message || 'Erro na prestação.',
      codigo: err.codigo || undefined,
      tef: err.tef || undefined
    });
  }
}

async function cancelarEntrega(req, res) {
  try {
    const data = await entregaService.cancelarEntrega(
      req.params.id,
      req.body || {},
      contextoAuditoriaRequisicao(req)
    );
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Erro ao cancelar entrega.' });
  }
}

async function atualizarEntrega(req, res) {
  try {
    const payload = Object.assign({}, req.body || {}, {
      _auditoria: contextoAuditoriaRequisicao(req)
    });
    const data = await entregaService.atualizarEntrega(req.params.id, payload);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Erro ao atualizar entrega.' });
  }
}

async function iniciarEntrega(req, res) {
  try {
    const data = await entregaService.iniciarEntrega(
      req.params.id,
      contextoAuditoriaRequisicao(req)
    );
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Erro ao iniciar entrega.' });
  }
}

module.exports = {
  listar,
  listarPendentes,
  buscarPorId,
  dashboard,
  alertas,
  reservasProduto,
  porEntregador,
  aguardandoPrestacao,
  resumo,
  resumoPorStatus,
  totaisReservados,
  timeline,
  prestacao,
  atualizarEntrega,
  cancelarEntrega,
  iniciarEntrega
};
