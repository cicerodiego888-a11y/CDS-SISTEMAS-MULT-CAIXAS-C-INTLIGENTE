/**
 * Rotas Central Inteligente de Entradas — API do inbox fiscal.
 *
 * Sprint 5: pipeline de processamento, revisão MIIP e bridge Compras.
 *
 * @module rotas/central-entradas
 */

const express = require('express');
const multer = require('multer');
const { exigirDiagnosticoCentral } = require('../middleware/auth');
const CentralEntradasService = require('../motores/central-entradas/CentralEntradasService');
const CentralMigracaoLegadoService = require('../motores/central-entradas/services/CentralMigracaoLegadoService');
const {
  recuperacaoPortalNacionalHabilitada,
  obterFeatureFlagsPublicas
} = require('../motores/central-entradas/config/centralFeatureFlags');

const router = express.Router();
const centralEntradasService = new CentralEntradasService();

const uploadXml = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 50 },
  fileFilter: (req, file, cb) => {
    if (!/\.xml$/i.test(file.originalname || '')) {
      return cb(new Error('Apenas arquivos .xml são permitidos'));
    }
    cb(null, true);
  }
});

function montarFiltrosQuery(query) {
  return {
    status: query.status || null,
    busca: query.busca || null,
    cnpjFornecedor: query.cnpj_fornecedor || query.cnpjFornecedor || null,
    origem: query.origem || null,
    dataEmissaoInicio: query.data_emissao_inicio || query.dataEmissaoInicio || null,
    dataEmissaoFim: query.data_emissao_fim || query.dataEmissaoFim || null,
    filtroRapido: query.filtro_rapido || query.filtroRapido || null,
    createdAtInicio: query.created_at_inicio || query.createdAtInicio || null,
    createdAtFim: query.created_at_fim || query.createdAtFim || null,
    limite: query.limite != null ? Number(query.limite) : undefined,
    offset: query.offset != null ? Number(query.offset) : undefined,
    pagina: query.pagina != null ? Number(query.pagina) : undefined,
    ordenarPor: query.ordenar_por || query.ordenarPor || null,
    ordenarDirecao: query.ordenar_direcao || query.ordenarDirecao || null
  };
}

function montarPeriodoIndicadoresQuery(query) {
  return {
    ano: query.ano,
    mes: query.mes,
    competencia: query.competencia,
    dataEmissaoInicio: query.data_emissao_inicio || query.dataEmissaoInicio || null,
    dataEmissaoFim: query.data_emissao_fim || query.dataEmissaoFim || null
  };
}

router.get('/health', async (req, res) => {
  try {
    const health = await centralEntradasService.obterHealth();
    return res.json(health);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/** RC3.4.6 — Saúde documental (monitor contínuo, sem SEFAZ). */
router.get('/saude', async (req, res) => {
  try {
    const painel = await centralEntradasService.obterSaudeCentral({
      forcar: req.query.forcar === '1'
    });
    return res.json(painel);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/saude/alertas', async (req, res) => {
  try {
    const lista = await centralEntradasService.listarAlertasSaude({
      nivel: req.query.nivel || null
    });
    return res.json(lista);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/saude/documento/:id', async (req, res) => {
  try {
    const saude = await centralEntradasService.obterSaudeDocumento(req.params.id);
    return res.json(saude);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post('/saude/analisar', async (req, res) => {
  try {
    const painel = await centralEntradasService.analisarSaudeCentral({
      autoRecuperar: req.body?.autoRecuperar !== false
    });
    return res.json(painel);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * RC6.5 — Migração idempotente de documentos legados (RES_NFE pré-RC6.2).
 * Não altera Orchestrator/Parser/MIIP/Compras.
 */
router.post('/admin/migrar-legado', exigirDiagnosticoCentral, async (req, res) => {
  try {
    const migracao = new CentralMigracaoLegadoService();
    const resultado = await migracao.executar();
    return res.json({
      analisados: resultado.analisados,
      migrados: resultado.migrados,
      ignorados: resultado.ignorados,
      erros: resultado.erros
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

/**
 * RC3.4.8 — Recuperação em lote de XMLs legados (AGUARDANDO / XML_INDISPONIVEL).
 * Reutiliza MIRX oficial; não consulta documentos recentes (idadeMinimaHoras).
 */
router.post('/admin/recuperar-xml-legado', exigirDiagnosticoCentral, async (req, res) => {
  try {
    const body = req.body || {};
    const resultado = await centralEntradasService.recuperarXmlLoteLegado({
      idadeMinimaHoras: body.idadeMinimaHoras ?? body.idade_minima_horas,
      limite: body.limite,
      dryRun: body.dryRun === true || body.dry_run === true,
      usuarioId: req.usuario?.id ?? body.usuarioId ?? null,
      correlationId: body.correlationId || null
    });
    return res.json({
      sprint: resultado.sprint,
      dryRun: resultado.dryRun,
      correlationId: resultado.correlationId,
      idadeMinimaHoras: resultado.idadeMinimaHoras,
      analisados: resultado.analisados,
      xmlsRecuperados: resultado.xmlsRecuperados,
      aindaIndisponivel: resultado.aindaIndisponivel,
      seguiramParser: resultado.seguiramParser,
      chegaramMiip: resultado.chegaramMiip,
      prontosCompra: resultado.prontosCompra,
      reabertosTerminal: resultado.reabertosTerminal,
      ignoradosRecentes: resultado.ignoradosRecentes,
      ignoradosPrecondicao: resultado.ignoradosPrecondicao,
      erros: resultado.erros,
      detalhes: resultado.detalhes
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

/**
 * RC3.7.5 — Status do Motor de Recuperação Automática de XML.
 */
router.get('/recuperacao-xml/status', async (req, res) => {
  try {
    const { obterMotorRecuperacaoXml } = require('../motores/central-entradas/recuperacao-xml');
    const status = await obterMotorRecuperacaoXml().obterStatus();
    return res.json(status);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

/**
 * RC3.7.5 — Executa um ciclo sob demanda (diagnóstico / admin).
 */
router.post('/recuperacao-xml/executar', exigirDiagnosticoCentral, async (req, res) => {
  try {
    const { obterMotorRecuperacaoXml } = require('../motores/central-entradas/recuperacao-xml');
    const motor = obterMotorRecuperacaoXml();
    const resultado = await motor.executarCiclo({
      forcar: true,
      correlationId: req.body?.correlationId || null,
      motivo: 'api_manual'
    });
    return res.json({ sucesso: true, ...resultado });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      sucesso: false,
      error: error.message
    });
  }
});

/**
 * RC3.4.9 — Análise (dry-run) de XML legado — Portal Nacional.
 * Não persiste; não cria documento; não altera MIRX/Parser/MIIP.
 */
router.post('/admin/importar-xml-legado/analisar', exigirDiagnosticoCentral, (req, res, next) => {
  uploadXml.array('xml', 50)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message, sucesso: false });
    }
    return next();
  });
}, async (req, res) => {
  try {
    const arquivos = Array.isArray(req.files) ? req.files : [];
    const body = req.body || {};
    const resultado = await centralEntradasService.analisarImportacaoXmlLegado(arquivos, {
      usuarioId: req.usuario?.id ?? body.usuario_id ?? body.usuarioId ?? null,
      usuarioNome: req.usuario?.nome || req.usuario?.name || null,
      recusarCancelados: body.recusarCancelados !== 'false' && body.recusar_cancelados !== 'false',
      correlationId: body.correlationId || null
    });
    return res.json(resultado);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message, sucesso: false });
  }
});

/**
 * RC3.4.9 — Importação oficial de XML legado (nfeProc do Portal Nacional).
 * Localiza por chave → repositório oficial → Parser → MIIP. Não cria documento novo.
 */
router.post('/admin/importar-xml-legado', exigirDiagnosticoCentral, (req, res, next) => {
  uploadXml.array('xml', 50)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message, sucesso: false });
    }
    return next();
  });
}, async (req, res) => {
  try {
    const arquivos = Array.isArray(req.files) ? req.files : [];
    const body = req.body || {};
    const dryRun = body.dryRun === true || body.dryRun === 'true' || body.dry_run === 'true';
    const resultado = await centralEntradasService.importarXmlLegado(arquivos, {
      dryRun,
      usuarioId: req.usuario?.id ?? body.usuario_id ?? body.usuarioId ?? null,
      usuarioNome: req.usuario?.nome || req.usuario?.name || null,
      recusarCancelados: body.recusarCancelados !== 'false' && body.recusar_cancelados !== 'false',
      processarPipeline: body.processarPipeline !== 'false' && body.processar_pipeline !== 'false',
      correlationId: body.correlationId || null
    });
    const statusCode = resultado.xmlsEnviados === 0 ? 400 : 200;
    return res.status(statusCode).json(resultado);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message, sucesso: false });
  }
});

router.get('/diagnostico', exigirDiagnosticoCentral, async (req, res) => {
  try {
    const forcar = req.query.forcar === 'true' || req.query.forcar === '1';
    const painel = await centralEntradasService.obterDiagnostico({ forcarAtualizacao: forcar });
    return res.json(painel);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/diagnostico/health-check', exigirDiagnosticoCentral, async (req, res) => {
  try {
    const resultado = await centralEntradasService.executarHealthCheckDiagnostico();
    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/diagnostico/acoes/sincronizar', exigirDiagnosticoCentral, async (req, res) => {
  try {
    const resultado = await centralEntradasService.sincronizar({ origem: 'diagnostico' });
    centralEntradasService.limparCacheDiagnostico();
    return res.status(statusHttpSync(resultado)).json({
      ...resultado,
      mensagemAmigavel: resultado.mensagemAmigavel
        || resultado.mensagem
        || (resultado.erros && resultado.erros[0])
        || null
    });
  } catch (error) {
    return res.status(422).json({
      sucesso: false,
      mensagemAmigavel: error.message || 'Falha ao sincronizar pelo diagnóstico.',
      error: error.message
    });
  }
});

router.post('/diagnostico/acoes/reprocessar-pendencias', exigirDiagnosticoCentral, async (req, res) => {
  try {
    const resultado = await centralEntradasService.processarDocumentosPendentes({ origem: 'diagnostico' });
    centralEntradasService.limparCacheDiagnostico();
    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({ error: error.message, sucesso: false });
  }
});

router.post('/diagnostico/acoes/testar-certificado', exigirDiagnosticoCentral, async (req, res) => {
  try {
    const resultado = await centralEntradasService.testarCertificadoDiagnostico();
    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/diagnostico/acoes/testar-sefaz', exigirDiagnosticoCentral, async (req, res) => {
  try {
    const resultado = await centralEntradasService.testarSefazDiagnostico();
    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/diagnostico/acoes/limpar-cache', exigirDiagnosticoCentral, async (req, res) => {
  try {
    const resultado = centralEntradasService.limparCacheDiagnostico();
    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/metadados', (req, res) => {
  try {
    return res.json(centralEntradasService.obterMetadados());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/feature-flags', (req, res) => {
  return res.json(obterFeatureFlagsPublicas());
});

router.get('/dashboard', async (req, res) => {
  try {
    const dashboard = await centralEntradasService.obterDashboard();
    return res.json({
      ...dashboard,
      featureFlags: obterFeatureFlagsPublicas()
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/alertas', async (req, res) => {
  try {
    const alertas = await centralEntradasService.listarAlertas();
    return res.json(alertas);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/pendencias', async (req, res) => {
  try {
    const pendencias = await centralEntradasService.obterPendencias({
      limite: req.query.limite != null ? Number(req.query.limite) : undefined
    });
    return res.json(pendencias);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/operacional', async (req, res) => {
  try {
    const operacional = await centralEntradasService.obterOperacional(montarPeriodoIndicadoresQuery(req.query));
    return res.json(operacional);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/indicadores-fiscais', async (req, res) => {
  try {
    const IndicadoresFiscaisService = require('../services/IndicadoresFiscaisService');
    const indicadores = await IndicadoresFiscaisService.obterIndicadoresCentral(
      montarPeriodoIndicadoresQuery(req.query)
    );
    return res.json(indicadores);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/inteligencia', async (req, res) => {
  try {
    const inteligencia = await centralEntradasService.obterInteligenciaOperacional({
      limitePendencias: req.query.limite != null ? Number(req.query.limite) : 20,
      ...montarPeriodoIndicadoresQuery(req.query)
    });
    return res.json(inteligencia);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/atencao', async (req, res) => {
  try {
    const atencao = await centralEntradasService.obterItensAtencao();
    return res.json(atencao);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/config', async (req, res) => {
  try {
    const config = await centralEntradasService.obterConfiguracoes();
    return res.json(config);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch('/config', async (req, res) => {
  try {
    const config = await centralEntradasService.atualizarConfiguracoes(req.body || {});
    return res.json(config);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

const CentralConfiguracaoController = require('../motores/central-entradas/controllers/CentralConfiguracaoController');
const configuracaoController = new CentralConfiguracaoController({
  orchestrator: require('../motores/central-entradas/CentralEntradasOrchestrator')
});

router.get('/configuracao', (req, res) => configuracaoController.obter(req, res));
router.put('/configuracao', (req, res) => configuracaoController.atualizar(req, res));
router.post('/configuracao/restaurar', (req, res) => configuracaoController.restaurarPadrao(req, res));
router.post('/configuracao/testar-sefaz', (req, res) => configuracaoController.testarSefaz(req, res));
router.post('/configuracao/testar-certificado', (req, res) => configuracaoController.testarCertificado(req, res));
router.post('/configuracao/health', (req, res) => configuracaoController.health(req, res));
router.post('/configuracao/limpar-cache', (req, res) => configuracaoController.limparCache(req, res));

router.get('/servico/status', async (req, res) => {
  try {
    const status = centralEntradasService.obterStatusServico();
    return res.json(status);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/eventos', async (req, res) => {
  try {
    const resultado = await centralEntradasService.listarEventos({
      tipo: req.query.tipo || null,
      origem: req.query.origem || null,
      busca: req.query.busca || null,
      documentoId: req.query.documento_id || req.query.documentoId || null,
      dataInicio: req.query.data_inicio || null,
      dataFim: req.query.data_fim || null,
      sucesso: req.query.sucesso,
      limite: req.query.limite != null ? Number(req.query.limite) : undefined,
      offset: req.query.offset != null ? Number(req.query.offset) : undefined
    });
    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/notificacoes', async (req, res) => {
  try {
    const resultado = await centralEntradasService.listarNotificacoes({
      apenasNaoLidas: req.query.apenas_nao_lidas === 'true' || req.query.apenas_nao_lidas === '1',
      limite: req.query.limite != null ? Number(req.query.limite) : undefined
    });
    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch('/notificacoes/marcar-todas-lidas', async (req, res) => {
  try {
    const total = await centralEntradasService.marcarTodasNotificacoesLidas();
    return res.json({ total });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch('/notificacoes/:id/lida', async (req, res) => {
  try {
    const ok = await centralEntradasService.marcarNotificacaoLida(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Notificação não encontrada' });
    return res.json({ sucesso: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Mapeia resultado de sync para HTTP — RC4: nunca 502 genérico.
 * @param {Object|null} resultado
 * @returns {number}
 */
function statusHttpSync(resultado) {
  if (!resultado) return 200;
  if (resultado.sucesso || resultado.ignorado) return 200;
  if (resultado.codigoErro === 'CERTIFICADO' || resultado.codigoErro === 'CNPJ'
    || resultado.codigoErro === 'CONFIG_FISCAL' || resultado.codigoErro === 'URL_SEFAZ') {
    return 422;
  }
  if (resultado.codigoErro === 'SEFAZ') return 503;
  return 200;
}

/** RC3.4 — Homologação assistida (somente leitura). */
router.get('/homologacao/painel', async (req, res) => {
  try {
    const painel = await centralEntradasService.obterPainelHomologacao({
      limite: req.query.limite != null ? Number(req.query.limite) : undefined
    });
    return res.json(painel);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/homologacao/metricas', async (req, res) => {
  try {
    const metricas = await centralEntradasService.obterMetricasHomologacao();
    return res.json(metricas);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/homologacao/:id/inspecionar', async (req, res) => {
  try {
    const inspecao = await centralEntradasService.inspecionarDocumentoHomologacao(req.params.id);
    return res.json(inspecao);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message });
  }
});

router.get('/homologacao/:id/exportar', async (req, res) => {
  try {
    const formato = String(req.query.formato || 'json').toLowerCase() === 'txt' ? 'txt' : 'json';
    const rel = await centralEntradasService.exportarRelatorioHomologacao(req.params.id, formato);
    res.setHeader('Content-Type', rel.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${rel.filename}"`);
    return res.send(rel.corpo);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message });
  }
});

router.post('/sincronizar-ao-abrir', async (req, res) => {
  try {
    const resultado = await centralEntradasService.sincronizarAoAbrir();
    if (!resultado) {
      return res.json({
        ignorado: true,
        sucesso: true,
        motivo: 'sync_ao_abrir desabilitado',
        mensagemAmigavel: 'Sincronização ao abrir está desabilitada nas configurações.'
      });
    }
    return res.status(statusHttpSync(resultado)).json({
      ...resultado,
      mensagemAmigavel: resultado.mensagemAmigavel
        || resultado.mensagem
        || (resultado.erros && resultado.erros[0])
        || null
    });
  } catch (error) {
    return res.status(422).json({
      sucesso: false,
      codigoErro: 'ERRO',
      mensagemAmigavel: error.message || 'Falha ao sincronizar ao abrir a Central.',
      error: error.message
    });
  }
});

router.get('/fornecedor/:cnpj/estatisticas', async (req, res) => {
  try {
    const estatisticas = await centralEntradasService.obterEstatisticasFornecedor(
      req.params.cnpj,
      { periodoDias: req.query.periodo_dias != null ? Number(req.query.periodo_dias) : undefined }
    );

    if (!estatisticas) {
      return res.status(400).json({ error: 'CNPJ inválido' });
    }

    return res.json(estatisticas);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const resultado = await centralEntradasService.listarDocumentos(montarFiltrosQuery(req.query));
    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/sincronizar', async (req, res) => {
  try {
    const resultado = await centralEntradasService.sincronizar();
    return res.status(statusHttpSync(resultado)).json({
      ...resultado,
      mensagemAmigavel: resultado.mensagemAmigavel
        || resultado.mensagem
        || (resultado.erros && resultado.erros[0])
        || null
    });
  } catch (error) {
    return res.status(422).json({
      sucesso: false,
      mensagemAmigavel: error.message || 'Falha na sincronização.',
      error: error.message
    });
  }
});

router.get('/buscar-chave', async (req, res) => {
  try {
    const chave = String(req.query.chave || '').replace(/\D/g, '');
    if (chave.length !== 44) {
      return res.status(400).json({ error: 'Informe uma chave de acesso com 44 dígitos' });
    }

    const resultado = await centralEntradasService.buscarPorChave(chave);
    return res.json(resultado);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message });
  }
});

router.post('/upload', (req, res, next) => {
  uploadXml.array('xml', 50)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message, sucesso: false });
    }
    return next();
  });
}, async (req, res) => {
  try {
    const arquivos = Array.isArray(req.files) ? req.files : [];
    const usuarioId = req.body?.usuario_id ?? req.body?.usuarioId ?? null;

    const resultado = await centralEntradasService.uploadDocumentos(arquivos, {
      usuarioId: usuarioId != null ? Number(usuarioId) || usuarioId : null
    });

    const statusCode = resultado.totalEnviados === 0 ? 400 : 200;
    return res.status(statusCode).json(resultado);
  } catch (error) {
    return res.status(500).json({ error: error.message, sucesso: false });
  }
});

router.post('/:id/processar', async (req, res) => {
  try {
    const { usuario_id: usuarioId, forcar_reprocessamento: forcarReprocessamento } = req.body || {};
    const resultado = await centralEntradasService.processarDocumento(req.params.id, {
      usuarioId,
      forcarReprocessamento: Boolean(forcarReprocessamento)
    });

    const statusCode = resultado.sucesso ? 200 : 400;
    return res.status(statusCode).json(resultado);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message, sucesso: false });
  }
});

/**
 * RC7.4.6 — HTTP do ciclo DF-e: resultado de negócio ≠ erro técnico.
 * - 409: requer confirmação do operador
 * - 200: sucesso, aguardando XML, rejeição SEFAZ (ex. cStat 596), demais resultados
 * - 4xx/5xx: apenas no catch (exceção / statusCode do domínio)
 */
function statusHttpCicloDfe(resultado) {
  if (resultado && resultado.requerConfirmacao) return 409;
  return 200;
}

router.post('/:id/ciclo-dfe', async (req, res) => {
  try {
    const { usuario_id: usuarioId, confirmado } = req.body || {};
    const resultado = await centralEntradasService.processarCicloDfeDocumento(
      req.params.id,
      {
        usuarioId,
        confirmado: confirmado === true
      }
    );
    return res.status(statusHttpCicloDfe(resultado)).json(resultado);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message, sucesso: false });
  }
});

/**
 * RC3.4.2 — Solicitar XML Completo (exceção manual via MIRX + Gate).
 * Não consulta SEFAZ se Gate bloqueado (656); não reenfileira em SLEEP.
 */
router.post('/:id/solicitar-xml-completo', async (req, res) => {
  try {
    const { usuario_id: usuarioId } = req.body || {};
    const resultado = await centralEntradasService.solicitarXmlCompletoManual(
      req.params.id,
      { usuarioId }
    );
    return res.status(200).json(resultado);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message, sucesso: false });
  }
});

/** RC3.6.H — bloqueia recuperação pelo Portal quando feature flag desativada. */
router.use((req, res, next) => {
  if (!req.path.includes('/recuperar-portal-nacional')) {
    return next();
  }
  if (!recuperacaoPortalNacionalHabilitada()) {
    return res.status(403).json({
      error: 'Funcionalidade temporariamente indisponível.',
      sucesso: false
    });
  }
  return next();
});

/**
 * RC3.6.H — Log de chave copiada manualmente pelo usuário.
 */
router.post('/:id/chave-copiada', async (req, res) => {
  try {
    const body = req.body || {};
    const resultado = await centralEntradasService.registrarChaveCopiada(req.params.id, {
      usuarioId: req.usuario?.id ?? body.usuario_id ?? body.usuarioId ?? null,
      usuarioNome: req.usuario?.nome || body.usuarioNome || null
    });
    return res.json(resultado);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message, sucesso: false });
  }
});

/**
 * RC3.5.0 — Avalia elegibilidade para Recuperar pelo Portal Nacional.
 */
router.get('/:id/recuperar-portal-nacional', async (req, res) => {
  try {
    const incluirAguardandoXml = req.query.incluirAguardandoXml === '1'
      || req.query.incluir_aguardando_xml === '1';
    const resultado = await centralEntradasService.avaliarRecuperacaoPortalNfe(req.params.id, {
      incluirAguardandoXml
    });
    return res.json(resultado);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message, sucesso: false });
  }
});

/**
 * RC3.6.0 — Registra abertura da Central de Recuperação CDS.
 */
router.post('/:id/recuperar-portal-nacional/central-aberta', async (req, res) => {
  try {
    const body = req.body || {};
    const resultado = await centralEntradasService.registrarCentralRecuperacaoAberta(req.params.id, {
      chave: body.chave || null,
      usuarioId: req.usuario?.id ?? body.usuario_id ?? body.usuarioId ?? null,
      usuarioNome: req.usuario?.nome || body.usuarioNome || null,
      correlationId: body.correlationId || null
    });
    return res.json(resultado);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message, sucesso: false });
  }
});

/**
 * RC3.6.0 — Usuário confirmou "Consultar no Portal Nacional".
 */
router.post('/:id/recuperar-portal-nacional/consulta-iniciada', async (req, res) => {
  try {
    const body = req.body || {};
    const resultado = await centralEntradasService.registrarConsultaPortalIniciada(req.params.id, {
      chave: body.chave || null,
      usuarioId: req.usuario?.id ?? body.usuario_id ?? body.usuarioId ?? null,
      usuarioNome: req.usuario?.nome || body.usuarioNome || null,
      correlationId: body.correlationId || null
    });
    return res.json(resultado);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message, sucesso: false });
  }
});

/**
 * RC3.6.0 — Download detectado pelo Electron will-download.
 */
router.post('/:id/recuperar-portal-nacional/download-detectado', async (req, res) => {
  try {
    const body = req.body || {};
    const resultado = await centralEntradasService.registrarDownloadDetectadoPortalNfe(req.params.id, {
      chave: body.chave || null,
      nomeArquivo: body.nomeArquivo || body.nome_arquivo || null,
      usuarioId: req.usuario?.id ?? body.usuario_id ?? body.usuarioId ?? null,
      correlationId: body.correlationId || null
    });
    return res.json(resultado);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message, sucesso: false });
  }
});

/**
 * RC3.5.0 — Registra abertura do Portal (timeline/eventos).
 */
router.post('/:id/recuperar-portal-nacional/abrir', async (req, res) => {
  try {
    const body = req.body || {};
    const resultado = await centralEntradasService.registrarPortalNfeAberto(req.params.id, {
      chave: body.chave || null,
      metodoChave: body.metodoChave || body.metodo_chave || null,
      usuarioId: req.usuario?.id ?? body.usuario_id ?? body.usuarioId ?? null,
      usuarioNome: req.usuario?.nome || body.usuarioNome || null,
      correlationId: body.correlationId || null
    });
    return res.json(resultado);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message, sucesso: false });
  }
});

/**
 * RC3.5.0 — Importa XML baixado do Portal via pipeline oficial RC3.4.9.
 * Aceita JSON { xml, nomeArquivo } ou multipart campo xml.
 */
router.post('/:id/recuperar-portal-nacional/importar', (req, res, next) => {
  if (req.is('multipart/form-data')) {
    return uploadXml.single('xml')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message, sucesso: false });
      }
      return next();
    });
  }
  return next();
}, async (req, res) => {
  try {
    const body = req.body || {};
    let arquivo = null;
    if (req.file?.buffer) {
      arquivo = { originalname: req.file.originalname, buffer: req.file.buffer };
    } else if (body.xml) {
      arquivo = {
        nomeArquivo: body.nomeArquivo || body.nome_arquivo || 'portal-nfe.xml',
        xml: body.xml
      };
    } else {
      return res.status(400).json({
        sucesso: false,
        error: 'XML obrigatório (multipart ou JSON.xml)'
      });
    }

    const resultado = await centralEntradasService.importarXmlPortalNfe(req.params.id, arquivo, {
      usuarioId: req.usuario?.id ?? body.usuario_id ?? body.usuarioId ?? null,
      usuarioNome: req.usuario?.nome || body.usuarioNome || null,
      correlationId: body.correlationId || null,
      processarPipeline: body.processarPipeline !== false && body.processar_pipeline !== 'false',
      incluirAguardandoXml: body.incluirAguardandoXml === true || body.incluir_aguardando_xml === true
    });

    return res.status(resultado.sucesso ? 200 : 400).json(resultado);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message, sucesso: false });
  }
});

router.get('/:id/revisar/sessao', async (req, res) => {
  try {
    const resultado = await centralEntradasService.obterSessaoRevisao(req.params.id);
    return res.json(resultado);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message, sucesso: false });
  }
});

router.post('/:id/revisar/sessao', async (req, res) => {
  try {
    const body = req.body || {};
    const usuarioId = req.usuario?.id ?? body.usuario_id ?? body.usuarioId ?? null;
    const correlationId = body.correlation_id ?? body.correlationId ?? null;
    const reiniciar = body.reiniciar === true || body.forcarNova === true;

    const resultado = reiniciar
      ? await centralEntradasService.reiniciarSessaoRevisao(req.params.id, {
        usuarioId,
        correlationId
      })
      : await centralEntradasService.obterOuCriarSessaoRevisao(req.params.id, {
        usuarioId,
        correlationId
      });

    return res.json(resultado);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message, sucesso: false });
  }
});

router.post('/:id/revisar/itens/:indice/decisao', async (req, res) => {
  try {
    const body = req.body || {};
    const resultado = await centralEntradasService.salvarDecisaoRevisao(
      req.params.id,
      req.params.indice,
      {
        decisao: body.decisao,
        produtoId: body.produto_id ?? body.produtoId,
        item: body.item,
        usuarioId: req.usuario?.id ?? body.usuario_id ?? body.usuarioId ?? null,
        correlationId: body.correlation_id ?? body.correlationId ?? null
      }
    );
    return res.json(resultado);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message, sucesso: false });
  }
});

router.post('/:id/revisar/concluir', async (req, res) => {
  try {
    const body = req.body || {};
    const { itens, usuario_id: usuarioIdBody } = body;
    const correlationId = body.correlation_id ?? body.correlationId ?? null;
    const resultado = await centralEntradasService.concluirRevisao(req.params.id, {
      itens,
      usuarioId: req.usuario?.id ?? usuarioIdBody ?? body.usuarioId ?? null,
      correlationId,
      permitirParcial: body.permitirParcial === true
    });
    return res.json(resultado);
  } catch (error) {
    console.error('[CentralRevisao][concluir][rota]', {
      documentoId: req.params.id,
      correlationId: req.body?.correlation_id ?? req.body?.correlationId ?? null,
      message: error?.message,
      stack: error?.stack
    });
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message });
  }
});

/**
 * Fluxo único operacional: Finalizar Entrada → prepara Compras (não grava compra).
 * Encadeia revisão (se EM_REVISAO) + abertura de importação.
 */
router.post('/:id/finalizar-entrada', async (req, res) => {
  try {
    const body = req.body || {};
    const correlationId = body.correlation_id ?? body.correlationId ?? null;
    const resultado = await centralEntradasService.finalizarEntrada(req.params.id, {
      itens: body.itens,
      usuarioId: req.usuario?.id ?? body.usuario_id ?? body.usuarioId ?? null,
      correlationId,
      permitirParcial: body.permitirParcial === true
    });
    return res.json(resultado);
  } catch (error) {
    console.error('[CentralEntradas][finalizar-entrada][rota]', {
      documentoId: req.params.id,
      correlationId: req.body?.correlation_id ?? req.body?.correlationId ?? null,
      message: error?.message,
      stack: error?.stack
    });
    const code = error.statusCode || 500;
    return res.status(code).json({
      error: error.message,
      sucesso: false,
      codigo: error.codigo || null
    });
  }
});

router.get('/:id/payload-compra', async (req, res) => {
  try {
    const payload = await centralEntradasService.obterPayloadCompra(req.params.id);
    return res.json(payload);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message });
  }
});

router.post('/:id/abrir-compra', async (req, res) => {
  try {
    const { usuario_id: usuarioId } = req.body || {};
    const resultado = await centralEntradasService.abrirCompra(req.params.id, { usuarioId });
    return res.json(resultado);
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message });
  }
});

router.get('/:id/historico', async (req, res) => {
  try {
    const documento = await centralEntradasService.obterDocumento(req.params.id);
    if (!documento) {
      return res.status(404).json({ error: 'Documento não encontrado' });
    }

    const historico = await centralEntradasService.obterHistorico(req.params.id);
    return res.json({ historico });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id/xml', async (req, res) => {
  try {
    const xmlDoc = await centralEntradasService.obterXmlDocumento(req.params.id);
    if (!xmlDoc) {
      return res.status(404).json({ error: 'XML não encontrado para este documento' });
    }
    return res.json(xmlDoc);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id/parse', async (req, res) => {
  try {
    const resultado = await centralEntradasService.obterParseDocumento(req.params.id);
    if (!resultado) {
      return res.status(404).json({ error: 'Documento não encontrado' });
    }
    return res.json(resultado);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id/score', async (req, res) => {
  try {
    const score = await centralEntradasService.obterScoreDocumento(req.params.id);
    if (!score) {
      return res.status(404).json({ error: 'Documento não encontrado' });
    }
    return res.json(score);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const detalhe = await centralEntradasService.obterDocumentoDetalhe(req.params.id);
    if (!detalhe) {
      return res.status(404).json({ error: 'Documento não encontrado' });
    }
    return res.json(detalhe);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const { status, detalhe, usuario_id: usuarioId } = req.body || {};

    if (!status) {
      return res.status(400).json({ error: 'Campo status é obrigatório' });
    }

    const documento = await centralEntradasService.alterarStatus(req.params.id, status, {
      detalhe,
      usuarioId: usuarioId ?? req.user?.id,
      usuarioNome: req.user?.username || req.user?.nome,
      perfilUsuario: req.user?.perfil,
      roleUsuario: req.user?.role,
      ipRequisicao: req.ip
    });

    return res.json({ documento });
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message });
  }
});

module.exports = router;
