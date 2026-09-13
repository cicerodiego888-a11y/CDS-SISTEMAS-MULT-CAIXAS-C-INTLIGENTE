/**
 * EquipamentosController — Camada HTTP do Motor de Equipamentos (Sprint 9).
 * Delega regras de negócio ao EquipamentosService.
 */

const equipamentosService = require('../motores/equipamentos/services/EquipamentosService');
const loggerService = require('../motores/equipamentos/services/LoggerService');

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  return res.status(status).json({
    success: false,
    error: error.message || mensagemPadrao
  });
}

async function listar(req, res) {
  try {
    const equipamentos = await equipamentosService.listar(req.query || {});
    res.json({ success: true, equipamentos });
  } catch (error) {
    await loggerService.error('Erro ao listar equipamentos', { operacao: 'listar', contexto: { erro: error.message } });
    responderErro(res, error, 'Erro ao listar equipamentos.');
  }
}

async function discovery(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const engineV1 = body.engine === 'v1'
      || body.modo === 'v1'
      || body.simples === true
      || req.query.engine === 'v1'
      || req.query.v === '1';

    // Sprint 14.1 — Discovery Engine V1.0 (TCP porta 9000, sem fabricante)
    if (engineV1) {
      const discoveryEngineV1 = require('../motores/equipamentos/discovery/DiscoveryEngineV1');
      const resultado = await discoveryEngineV1.executar({
        timeoutMs: body.timeoutMs,
        concorrencia: body.concorrencia,
        maxHosts: body.maxHosts,
        portas: body.portas,
        persistir: body.persistir !== false
      });
      if (body.meta === true || body.meta === 1 || req.query.meta === '1') {
        return res.json({
          success: true,
          equipamentos: resultado.equipamentos,
          candidatos: (resultado.candidatos || []).map((c) => ({
            ...c,
            ip: c.host,
            transporte: 'ethernet',
            ja_cadastrado: false
          })),
          meta: resultado.meta
        });
      }
      // Aceite oficial: array [{host, porta, status, latencia}]
      return res.json(resultado.equipamentos || []);
    }

    const discoveryService = require('../motores/equipamentos/discovery/DiscoveryService');
    const identidadeService = require('../motores/equipamentos/identidade/IdentidadeService');
    const transportes = Array.isArray(body.transportes) && body.transportes.length
      ? body.transportes
      : ['ethernet'];
    const resultado = await discoveryService.descobrirTodos({
      ...body,
      transportes,
      persistir_sessao: body.persistir_sessao !== false
    });

    // MIE RC2.1 — enriquece após Discovery (não altera o motor de discovery)
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
      meta: {
        ...resultado.meta,
        identidade_enriquecida: body.enriquecer_identidade !== false
      }
    });
  } catch (error) {
    await loggerService.error('Erro no discovery de equipamentos', {
      operacao: 'discovery',
      contexto: { erro: error.message }
    });
    responderErro(res, error, 'Erro ao descobrir equipamentos.', 500);
  }
}

async function discoverySessoes(req, res) {
  try {
    const sessions = require('../motores/equipamentos/repositories/DiscoverySessionsRepository');
    const lista = await sessions.listarSessoes(req.query?.limite || 20);
    res.json({ success: true, sessoes: lista });
  } catch (error) {
    responderErro(res, error, 'Erro ao listar sessões de discovery.', 500);
  }
}

async function listarIdentidades(req, res) {
  try {
    const identidadeService = require('../motores/equipamentos/identidade/IdentidadeService');
    const identidades = await identidadeService.listar(req.query?.limite || 50);
    res.json({ success: true, identidades });
  } catch (error) {
    responderErro(res, error, 'Erro ao listar identidades.', 500);
  }
}

async function buscarIdentidade(req, res) {
  try {
    const identidadeService = require('../motores/equipamentos/identidade/IdentidadeService');
    const identidade = await identidadeService.buscarPorId(req.params.id);
    if (!identidade) {
      return res.status(404).json({ success: false, error: 'Identidade não encontrada' });
    }
    res.json({ success: true, identidade });
  } catch (error) {
    responderErro(res, error, 'Erro ao buscar identidade.', 500);
  }
}

async function discoveryCancelar(req, res) {
  try {
    const discoveryService = require('../motores/equipamentos/discovery/DiscoveryService');
    const discoveryEngineV1 = require('../motores/equipamentos/discovery/DiscoveryEngineV1');
    const ethernetDiscovery = require('../motores/equipamentos/discovery/EthernetDiscovery');
    const discoveryManager = require('../motores/equipamentos/discovery/DiscoveryManager');
    discoveryService.cancelar();
    discoveryEngineV1.cancelar();
    ethernetDiscovery.cancelar();
    discoveryManager.cancelar();
    res.json({
      success: true,
      cancelado: true,
      em_execucao: discoveryService.estaEmExecucao()
        || discoveryEngineV1.estaEmExecucao()
        || ethernetDiscovery.estaEmExecucao()
        || discoveryManager.estaEmExecucao()
    });
  } catch (error) {
    responderErro(res, error, 'Erro ao cancelar discovery.', 500);
  }
}

async function buscarPorId(req, res) {
  try {
    const equipamento = await equipamentosService.buscarPorId(req.params.id);
    if (!equipamento) {
      return res.status(404).json({ success: false, error: 'Equipamento não encontrado' });
    }
    res.json({ success: true, equipamento });
  } catch (error) {
    responderErro(res, error, 'Erro ao buscar equipamento.');
  }
}

async function criar(req, res) {
  try {
    const equipamento = await equipamentosService.criar(req.body || {});
    res.status(201).json({
      success: true,
      message: 'Equipamento cadastrado com sucesso.',
      equipamento
    });
  } catch (error) {
    await loggerService.error('Erro ao criar equipamento', { operacao: 'cadastro', contexto: { erro: error.message } });
    responderErro(res, error, 'Erro ao criar equipamento.', 400);
  }
}

async function editar(req, res) {
  try {
    const equipamento = await equipamentosService.editar(req.params.id, req.body || {});
    res.json({
      success: true,
      message: 'Equipamento atualizado com sucesso.',
      equipamento
    });
  } catch (error) {
    const status = error.message === 'Equipamento não encontrado' ? 404 : 400;
    responderErro(res, error, 'Erro ao atualizar equipamento.', status);
  }
}

async function remover(req, res) {
  try {
    const resultado = await equipamentosService.remover(req.params.id);
    res.json({
      success: true,
      message: 'Equipamento removido com sucesso.',
      ...resultado
    });
  } catch (error) {
    const status = error.statusCode || (error.message === 'Equipamento não encontrado' ? 404 : 500);
    responderErro(res, error, 'Erro ao remover equipamento.', status);
  }
}

async function duplicar(req, res) {
  try {
    const equipamento = await equipamentosService.duplicar(req.params.id);
    res.status(201).json({
      success: true,
      message: 'Equipamento duplicado com sucesso.',
      equipamento
    });
  } catch (error) {
    responderErro(res, error, 'Erro ao duplicar equipamento.', error.statusCode || 400);
  }
}

async function ativar(req, res) {
  try {
    const equipamento = await equipamentosService.ativar(req.params.id);
    res.json({ success: true, message: 'Equipamento ativado.', equipamento });
  } catch (error) {
    responderErro(res, error, 'Erro ao ativar equipamento.', error.statusCode || 400);
  }
}

async function desativar(req, res) {
  try {
    const equipamento = await equipamentosService.desativar(req.params.id);
    res.json({ success: true, message: 'Equipamento desativado.', equipamento });
  } catch (error) {
    responderErro(res, error, 'Erro ao desativar equipamento.', error.statusCode || 400);
  }
}

async function listarDrivers(req, res) {
  try {
    // Sprint 15.7 — Device Profile SDK (fonte canônica de drivers instalados)
    try {
      const sdk = require('../motores/equipamentos/sdk');
      sdk.ensureLoaded();
      const drivers = sdk.listarDrivers({
        categoria: req.query.categoria,
        fabricante: req.query.fabricante,
        capability: req.query.capability
      });
      return res.json({
        success: true,
        drivers,
        total: drivers.length,
        fonte: 'device-profile-sdk',
        relatorio: sdk.loader.obterRelatorio()
      });
    } catch (sdkErr) {
      console.warn('[equipamentos] SDK drivers fallback:', sdkErr.message);
    }

    const drivers = await equipamentosService.listarDrivers();
    res.json({ success: true, drivers, fonte: 'legado' });
  } catch (error) {
    responderErro(res, error, 'Erro ao listar drivers.');
  }
}

async function testar(req, res) {
  try {
    const equipamentoId = req.body?.equipamento_id || req.params.id;
    if (!equipamentoId) {
      return res.status(400).json({ success: false, error: 'equipamento_id é obrigatório' });
    }
    const resultado = await equipamentosService.testarConexao(equipamentoId);
    res.json(resultado);
  } catch (error) {
    responderErro(res, error, 'Erro ao testar equipamento.', error.statusCode || 500);
  }
}

async function conexao(req, res) {
  try {
    const resultado = await equipamentosService.obterStatusConexao(req.params.id);
    res.json({ success: true, ...resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao obter status de conexão.', error.statusCode || 500);
  }
}

async function diagnostico(req, res) {
  try {
    const equipamentoId = req.body?.equipamento_id || req.params.id;

    if (equipamentoId) {
      const resultado = await equipamentosService.diagnosticarEquipamento(equipamentoId);
      return res.json({ success: true, ...resultado });
    }

    const completo = req.query.completo === '1' || req.body?.completo;
    const resultado = completo
      ? await equipamentosService.executarDiagnosticoGeral(req.body || {})
      : await equipamentosService.executarDiagnosticoGeral();

    res.json({ success: true, ...resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao executar diagnóstico.', error.statusCode || 500);
  }
}

async function resumo(req, res) {
  try {
    const resumoData = await equipamentosService.obterResumo();
    res.json({ success: true, resumo: resumoData });
  } catch (error) {
    responderErro(res, error, 'Erro ao obter resumo de equipamentos.');
  }
}

async function logs(req, res) {
  try {
    const limite = Number(req.query.limite || 50);
    const lista = await equipamentosService.listarLogs(req.params.id, limite);
    res.json({ success: true, logs: lista });
  } catch (error) {
    responderErro(res, error, 'Erro ao listar logs do equipamento.');
  }
}

async function listarPresetsLayout(req, res) {
  try {
    const presets = equipamentosService.listarPresetsLayout();
    res.json({ success: true, presets });
  } catch (error) {
    responderErro(res, error, 'Erro ao listar presets de layout.');
  }
}

async function obterLayoutAtivo(req, res) {
  try {
    const layout = await equipamentosService.obterLayoutAtivo();
    res.json({
      success: true,
      layout: layout || null,
      configurado: Boolean(layout)
    });
  } catch (error) {
    responderErro(res, error, 'Erro ao obter layout ativo.');
  }
}

async function definirLayoutAtivo(req, res) {
  try {
    const layout = await equipamentosService.definirLayoutAtivo(req.body?.layout || req.body || {});
    res.json({ success: true, message: 'Layout ativo atualizado.', layout });
  } catch (error) {
    responderErro(res, error, 'Erro ao definir layout ativo.', error.statusCode || 400);
  }
}

async function obterLayoutEquipamento(req, res) {
  try {
    const layout = await equipamentosService.obterLayoutEquipamento(req.params.id);
    res.json({ success: true, layout: layout || null });
  } catch (error) {
    responderErro(res, error, 'Erro ao obter layout do equipamento.');
  }
}

async function salvarLayoutEquipamento(req, res) {
  try {
    const definirComoAtivo = req.body?.layout_ativo === true
      || req.body?.layout_ativo === 1
      || req.body?.definir_como_ativo === true;
    const layoutBruto = req.body?.layout || req.body;
    const layout = await equipamentosService.salvarLayoutEquipamento(
      req.params.id,
      layoutBruto,
      { definirComoAtivo }
    );
    res.json({ success: true, message: 'Layout salvo.', layout });
  } catch (error) {
    responderErro(res, error, 'Erro ao salvar layout.', error.statusCode || 400);
  }
}

async function testarParseLayout(req, res) {
  try {
    const codigo = req.body?.codigo;
    const layout = req.body?.layout || null;
    const resultado = await Promise.resolve(
      equipamentosService.testarParseLayout(codigo, layout)
    );
    res.json({ success: true, ...resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao testar parse de etiqueta.', error.statusCode || 400);
  }
}

async function interpretarEtiqueta(req, res) {
  try {
    const codigo = req.body?.codigo;
    if (!codigo) {
      return res.status(400).json({ success: false, error: 'codigo é obrigatório' });
    }
    const resultado = await equipamentosService.interpretarEtiqueta(codigo, {
      equipamentoId: req.body?.equipamento_id || req.body?.equipamentoId || null,
      layout: req.body?.layout || null
    });
    res.json({ success: true, ...resultado });
  } catch (error) {
    responderErro(res, error, 'Erro ao interpretar etiqueta.', error.statusCode || 400);
  }
}

module.exports = {
  listar,
  buscarPorId,
  criar,
  editar,
  remover,
  duplicar,
  ativar,
  desativar,
  listarDrivers,
  testar,
  diagnostico,
  discovery,
  discoveryCancelar,
  discoverySessoes,
  listarIdentidades,
  buscarIdentidade,
  resumo,
  conexao,
  logs,
  listarPresetsLayout,
  obterLayoutAtivo,
  definirLayoutAtivo,
  obterLayoutEquipamento,
  salvarLayoutEquipamento,
  testarParseLayout,
  interpretarEtiqueta
};
