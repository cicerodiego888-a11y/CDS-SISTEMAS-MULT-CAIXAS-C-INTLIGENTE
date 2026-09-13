/**
 * LaboratorioEquipamentosController — API HTTP do Laboratório (Sprint 12).
 */

const laboratorio = require('../motores/equipamentos/laboratorio').laboratorioEquipamentos;
const equipamentosRepository = require('../motores/equipamentos/repositories/EquipamentosRepository');
const loggerService = require('../motores/equipamentos/services/LoggerService');

function responderErro(res, error, padrao = 'Erro no laboratório', status = 500) {
  return res.status(error.statusCode || status).json({
    success: false,
    error: error.message || padrao
  });
}

async function listarDrivers(req, res) {
  try {
    const drivers = await laboratorio.listarDrivers();
    res.json({ success: true, drivers });
  } catch (error) {
    responderErro(res, error, 'Erro ao listar drivers');
  }
}

async function listarEquipamentos(req, res) {
  try {
    const equipamentos = await equipamentosRepository.listar({ apenasAtivos: true, tipo: 'balanca' });
    res.json({ success: true, equipamentos });
  } catch (error) {
    responderErro(res, error, 'Erro ao listar equipamentos');
  }
}

async function conectar(req, res) {
  try {
    const resultado = await laboratorio.conectar(req.params.id);
    res.json({ success: true, resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao conectar', 400);
  }
}

async function desconectar(req, res) {
  try {
    const resultado = await laboratorio.desconectar(req.params.id);
    res.json({ success: true, resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao desconectar', 400);
  }
}

async function ping(req, res) {
  try {
    const resultado = await laboratorio.ping(req.params.id);
    res.json({ success: true, resultado });
  } catch (error) {
    responderErro(res, error, 'Erro no ping', 400);
  }
}

async function status(req, res) {
  try {
    const resultado = await laboratorio.status(req.params.id);
    res.json({ success: true, resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao obter status', 400);
  }
}

async function diagnostico(req, res) {
  try {
    const resultado = await laboratorio.diagnostico(req.params.id);
    res.json({ success: true, diagnostico: resultado });
  } catch (error) {
    responderErro(res, error, 'Erro no diagnóstico', 400);
  }
}

async function montarFrame(req, res) {
  try {
    const resultado = laboratorio.montarFrame(req.body || {});
    res.json({ success: true, frame: resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao montar frame', 400);
  }
}

async function enviarHex(req, res) {
  try {
    const { hex } = req.body || {};
    const resultado = await laboratorio.enviarHex(req.params.id, hex);
    res.json({ success: true, resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao enviar HEX', 400);
  }
}

async function enviarAscii(req, res) {
  try {
    const { ascii } = req.body || {};
    const resultado = await laboratorio.enviarAscii(req.params.id, ascii);
    res.json({ success: true, resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao enviar ASCII', 400);
  }
}

async function listarPacotes(req, res) {
  try {
    const chave = req.query.chave || (req.params.id ? `eq:${req.params.id}` : null);
    const pacotes = laboratorio.listarPacotesGlobal(chave);
    res.json({ success: true, pacotes });
  } catch (error) {
    responderErro(res, error, 'Erro ao listar pacotes');
  }
}

async function limparPacotes(req, res) {
  try {
    const chave = req.query.chave || (req.params.id ? `eq:${req.params.id}` : null);
    laboratorio.limparPacotes(chave);
    res.json({ success: true, message: 'Pacotes limpos' });
  } catch (error) {
    responderErro(res, error, 'Erro ao limpar pacotes');
  }
}

async function iniciarCaptura(req, res) {
  try {
    const resultado = laboratorio.iniciarCaptura({
      equipamento_id: req.params.id || null,
      ...(req.body || {})
    });
    res.json({ success: true, ...resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao iniciar captura', 400);
  }
}

async function pararCaptura(req, res) {
  try {
    const resultado = laboratorio.pararCaptura();
    res.json({ success: true, ...resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao parar captura', 400);
  }
}

async function salvarCaptura(req, res) {
  try {
    const { nome, sessao } = req.body || {};
    const exportado = await laboratorio.salvarCaptura(sessao, nome);
    await loggerService.info('Captura exportada pelo laboratório', {
      operacao: 'laboratorio.captura.exportar',
      contexto: exportado
    });
    res.json({ success: true, exportado });
  } catch (error) {
    responderErro(res, error, 'Erro ao salvar captura', 400);
  }
}

async function listarCapturas(req, res) {
  try {
    const capturas = laboratorio.listarCapturas();
    res.json({ success: true, capturas });
  } catch (error) {
    responderErro(res, error, 'Erro ao listar capturas');
  }
}

async function abrirCaptura(req, res) {
  try {
    const captura = laboratorio.abrirCaptura(req.params.capturaId);
    res.json({ success: true, captura });
  } catch (error) {
    responderErro(res, error, 'Captura não encontrada', 404);
  }
}

async function replay(req, res) {
  try {
    const { captura_id, indice } = req.body || {};
    const resultado = await laboratorio.replay(req.params.id, Number(indice), captura_id);
    res.json({ success: true, resultado });
  } catch (error) {
    responderErro(res, error, 'Erro no replay', 400);
  }
}

async function compararCapturas(req, res) {
  try {
    const { captura_a, captura_b } = req.body || {};
    const resultado = laboratorio.compararCapturas(captura_a, captura_b);
    res.json({ success: true, comparacao: resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao comparar capturas', 400);
  }
}

async function compararHex(req, res) {
  try {
    const { hex_a, hex_b } = req.body || {};
    const resultado = laboratorio.compararHex(hex_a, hex_b);
    res.json({ success: true, comparacao: resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao comparar HEX', 400);
  }
}

async function utilitarios(req, res) {
  try {
    const { tipo, valor } = req.body || {};
    let resultado = null;
    if (tipo === 'ascii_para_hex') {
      resultado = laboratorio.frameStudio.asciiParaHex(valor);
    } else if (tipo === 'hex_para_ascii') {
      resultado = laboratorio.frameStudio.hexParaAscii(valor);
    } else {
      return res.status(400).json({ success: false, error: 'tipo inválido' });
    }
    res.json({ success: true, resultado });
  } catch (error) {
    responderErro(res, error, 'Erro na conversão', 400);
  }
}

module.exports = {
  listarDrivers,
  listarEquipamentos,
  conectar,
  desconectar,
  ping,
  status,
  diagnostico,
  montarFrame,
  enviarHex,
  enviarAscii,
  listarPacotes,
  limparPacotes,
  iniciarCaptura,
  pararCaptura,
  salvarCaptura,
  listarCapturas,
  abrirCaptura,
  replay,
  compararCapturas,
  compararHex,
  utilitarios
};
