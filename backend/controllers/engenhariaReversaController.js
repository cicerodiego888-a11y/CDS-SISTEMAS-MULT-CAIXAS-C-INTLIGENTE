/**
 * EngenhariaReversaController — API HTTP Sprint 13.
 */

const engenharia = require('../motores/equipamentos/engenharia-reversa').engenhariaReversaService;

function responderErro(res, error, padrao = 'Erro na engenharia reversa', status = 500) {
  return res.status(error.statusCode || status).json({
    success: false,
    error: error.message || padrao
  });
}

async function iniciarCaptura(req, res) {
  try {
    const resultado = engenharia.iniciarCaptura(req.body || {});
    res.json({ success: true, ...resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao iniciar captura', 400);
  }
}

async function pararCaptura(req, res) {
  try {
    const resultado = engenharia.pararCaptura();
    res.json({ success: true, ...resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao parar captura', 400);
  }
}

async function statusCaptura(req, res) {
  try {
    res.json({
      success: true,
      capturando: engenharia.capture.estaCapturando(),
      sessao: engenharia.capture.obterSessaoAtual()
    });
  } catch (error) {
    responderErro(res, error);
  }
}

async function exportarCaptura(req, res) {
  try {
    const { nome, sessao } = req.body || {};
    const dados = sessao || engenharia.pararCaptura().sessao;
    const exportado = engenharia.exportar(dados, nome);
    res.json({ success: true, exportado });
  } catch (error) {
    responderErro(res, error, 'Erro ao exportar', 400);
  }
}

async function listarCapturas(req, res) {
  try {
    const capturas = engenharia.listarCapturas();
    res.json({ success: true, capturas });
  } catch (error) {
    responderErro(res, error);
  }
}

async function abrirCaptura(req, res) {
  try {
    const captura = engenharia.abrirCaptura(req.params.id);
    res.json({ success: true, captura });
  } catch (error) {
    responderErro(res, error, 'Captura não encontrada', 404);
  }
}

async function importarCaptura(req, res) {
  try {
    const { caminho, id } = req.body || {};
    const captura = engenharia.importar(caminho || id);
    res.json({ success: true, captura });
  } catch (error) {
    responderErro(res, error, 'Erro ao importar', 400);
  }
}

async function analisarFrame(req, res) {
  try {
    const { hex, buffer } = req.body || {};
    const analise = engenharia.analisarFrame(hex || buffer);
    res.json({ success: true, analise });
  } catch (error) {
    responderErro(res, error, 'Erro na análise', 400);
  }
}

async function adicionarObservacao(req, res) {
  try {
    const { captura_id, indice, texto, categoria } = req.body || {};
    engenharia.adicionarObservacao(captura_id, Number(indice), texto, categoria);
    res.json({ success: true, message: 'Observação registrada' });
  } catch (error) {
    responderErro(res, error, 'Erro ao registrar observação', 400);
  }
}

async function atualizarDocumento(req, res) {
  try {
    const { sessoes, captura_ids } = req.body || {};
    let lista = sessoes;
    if (!lista && Array.isArray(captura_ids)) {
      lista = captura_ids.map((id) => engenharia.abrirCaptura(id));
    }
    const resultado = engenharia.atualizarProtocoloMd(lista);
    res.json({ success: true, ...resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao atualizar documento', 400);
  }
}

async function compararCapturas(req, res) {
  try {
    const { captura_a, captura_b, categoria } = req.body || {};
    const a = typeof captura_a === 'string' ? engenharia.abrirCaptura(captura_a) : captura_a;
    const b = typeof captura_b === 'string' ? engenharia.abrirCaptura(captura_b) : captura_b;
    const comparacao = engenharia.compararCapturas(a, b, categoria);
    res.json({ success: true, comparacao });
  } catch (error) {
    responderErro(res, error, 'Erro ao comparar', 400);
  }
}

async function gerarWireshark(req, res) {
  try {
    const { captura_id, sessao } = req.body || {};
    const dados = sessao || (captura_id ? engenharia.abrirCaptura(captura_id) : engenharia.capture.obterSessaoAtual());
    if (!dados) throw new Error('Nenhuma sessão disponível');
    const texto = engenharia.gerarWireshark(dados);
    res.json({ success: true, wireshark: texto });
  } catch (error) {
    responderErro(res, error, 'Erro ao gerar exportação', 400);
  }
}

module.exports = {
  iniciarCaptura,
  pararCaptura,
  statusCaptura,
  exportarCaptura,
  listarCapturas,
  abrirCaptura,
  importarCaptura,
  analisarFrame,
  adicionarObservacao,
  atualizarDocumento,
  compararCapturas,
  gerarWireshark
};
