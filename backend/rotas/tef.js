const express = require('express');
const router = express.Router();
const tefService = require('../services/tef');
const tefConfiguracaoRoutes = require('./tefConfiguracao');
const tefConciliacaoRoutes = require('./tefConciliacao');
const db = require('../database');
const sdkDetector = require('../services/tef/sdkDetector');
const tefConciliacaoService = require('../services/tef/tefConciliacaoService');
const tefDiagnosticoService = require('../services/tef/tefDiagnosticoService');
const tefEvents = require('../services/tef/tefEvents');
const tefContrato = require('../services/tef/tefContrato');
const { verificarToken } = require('../middleware/auth');
const tefConfigService = require('../services/tef/tefConfigService');
const tefFluxoPagamento = require('../services/tef/tefFluxoPagamento');
const configService = require('../services/configuracaoService');
const { gravarAuditoria } = require('../services/auditoria');
const {
  classificarSituacaoFiscalDaVenda
} = require('../services/fechamento-fiscal/NfceSituacaoFiscalService');

router.use(tefConfiguracaoRoutes);
router.use(tefConciliacaoRoutes);

/** Estado TEF para o PDV (operador autenticado, sem dados sensíveis). */
router.get('/fluxo-pdv', verificarToken, async (req, res) => {
  try {
    const tefConfig = await tefConfigService.obterConfiguracao();
    res.json({
      tefHabilitado: tefFluxoPagamento.parseTefHabilitado(tefConfig.tefHabilitado),
      pixHabilitado: tefFluxoPagamento.parseTefHabilitado(tefConfig.pix),
      modoConfirmacaoFiscal: configService.getModoConfirmacaoFiscal()
    });
  } catch (error) {
    console.error('Erro ao consultar fluxo TEF do PDV:', error);
    res.status(500).json({ error: 'Erro ao consultar configuração TEF do PDV.' });
  }
});

router.post('/pagar', async (req, res) => {
  try {
    const tefVinculoVendaService = require('../services/tef/tefVinculoVendaService');
    const tefFiscalContextService = require('../services/tef/tefFiscalContextService');
    const {
      venda_id,
      tipo,
      valor,
      parcelas,
      idempotency_key,
      pdv_id,
      pdvId,
      terminal_id,
      terminalId,
      empresa_id,
      empresaId,
      loja_id,
      lojaId
    } = req.body;

    if (!tipo) {
      return res.status(400).json({ error: 'Tipo de pagamento TEF não informado.' });
    }

    if (!Number.isFinite(Number(valor)) || Number(valor) <= 0) {
      return res.status(400).json({ error: 'Valor TEF inválido.' });
    }

    const validacaoVenda = await tefVinculoVendaService.validarVendaIdParaPagamento(venda_id);
    if (!validacaoVenda.ok) {
      return res.status(400).json({
        sucesso: false,
        codigo: validacaoVenda.codigo,
        error: validacaoVenda.mensagem,
        estado_vinculo: validacaoVenda.estadoVinculo
      });
    }

    const autorizacaoFiscal = await tefFiscalContextService.autorizarPagamentoFiscal({
      vendaId: validacaoVenda.venda_id,
      valor: Number(valor),
      tipo,
      idempotencyKey: idempotency_key,
      db,
      autorizar: (contextoFiscal) => tefService.iniciarPagamento({
        venda_id: validacaoVenda.venda_id,
        tipo,
        valor: Number(valor),
        parcelas: Number(parcelas || 1),
        idempotency_key: idempotency_key || null,
        contextoFiscal,
        // MRT-02: identidade PDV = terminais.id (nunca hostname/MAC)
        pdv_id: pdv_id ?? pdvId ?? terminal_id ?? terminalId ?? req.terminalId ?? null,
        empresa_id: empresa_id ?? empresaId ?? null,
        loja_id: loja_id ?? lojaId ?? null
      })
    });
    if (!autorizacaoFiscal.ok) {
      return res.status(403).json({
        sucesso: false,
        codigo: autorizacaoFiscal.codigo,
        error: autorizacaoFiscal.mensagem
      });
    }

    const resultado = autorizacaoFiscal.resultado;

    const transacaoId = resultado?.transacao_id || resultado?.transacaoId || resultado?.id || null;
    const metaVinculo = tefVinculoVendaService.montarMetaRespostaPagamento({
      vendaId: validacaoVenda.venda_id,
      estadoVinculo: validacaoVenda.venda_id
        ? tefVinculoVendaService.ESTADOS_VINCULO.VENDA_INFORMADA
        : tefVinculoVendaService.ESTADOS_VINCULO.PENDENTE_FINALIZACAO,
      idempotencyKey: idempotency_key || resultado?.idempotency_key || null,
      transacaoId
    });

    const resposta = {
      ...resultado,
      ...metaVinculo,
      vinculo: metaVinculo
    };

    if (resultado.codigo === 'TRANSACAO_DUPLICADA' && !resultado.aprovado && resultado.sucesso !== true) {
      return res.status(409).json(resposta);
    }

    // MRT-22 — continuidade CRT (99/COLETA/OPCAO): não é falha financeira definitiva
    if (resultado.requerContinuacao === true) {
      return res.status(202).json(resposta);
    }

    if (resultado.sucesso === false && resultado.codigo && !tefContrato.estaAprovado(resultado)) {
      return res.status(422).json(resposta);
    }

    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.username || req.user?.nome || null,
      modulo: 'tef',
      acao: 'iniciar_pagamento',
      referencia_tipo: 'tef_transacao',
      referencia_id: transacaoId,
      detalhes: {
        venda_id: validacaoVenda.venda_id,
        estado_vinculo: metaVinculo.estado_vinculo,
        idempotency_key: metaVinculo.idempotency_key,
        tipo,
        valor: Number(valor),
        aprovado: tefContrato.estaAprovado(resultado),
        ip: req.ip || null
      },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria TEF pagar:', auditErr));

    res.json(resposta);
  } catch (error) {
    console.error('Erro TEF:', error);
    res.status(500).json({
      error: error.message || 'Erro ao processar TEF.'
    });
  }
});

/** MRT-22 — Continuidade CRT (COLETA/OPCAO). Sem TX_START / sem nova cobrança. */
router.post('/continuar', async (req, res) => {
  try {
    const {
      transacao_id,
      transacaoId,
      idempotency_key,
      venda_id,
      resposta_continuidade,
      resposta,
      acao,
      solicitadaEm
    } = req.body || {};

    const id = transacao_id ?? transacaoId;
    if (id == null || String(id).trim() === '') {
      return res.status(400).json({
        sucesso: false,
        codigo: 'TEF_CONTINUIDADE_SEM_TRANSACAO',
        error: 'transacao_id obrigatório',
        retryAllowed: false
      });
    }

    const resultado = await tefService.continuarPagamento({
      transacao_id: id,
      idempotency_key: idempotency_key || null,
      venda_id: venda_id != null ? venda_id : null,
      resposta_continuidade: resposta_continuidade ?? resposta ?? null,
      acao: acao || null,
      solicitadaEm: solicitadaEm || null
    });

    if (resultado.requerContinuacao === true) {
      return res.status(202).json(resultado);
    }

    if (resultado.inconclusivo === true) {
      return res.status(422).json({ ...resultado, retryAllowed: false });
    }

    if (resultado.sucesso === false && !tefContrato.estaAprovado(resultado)) {
      const statusHttp = resultado.codigo === 'TEF_TRANSACAO_NAO_ENCONTRADA' ? 404 : 422;
      return res.status(statusHttp).json(resultado);
    }

    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.username || req.user?.nome || null,
      modulo: 'tef',
      acao: 'continuar_pagamento_crt',
      referencia_tipo: 'tef_transacao',
      referencia_id: id,
      detalhes: {
        venda_id: venda_id || null,
        idempotency_key: idempotency_key || null,
        aprovado: tefContrato.estaAprovado(resultado),
        ip: req.ip || null
      },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria TEF continuar:', auditErr));

    return res.json(resultado);
  } catch (error) {
    console.error('Erro TEF continuar:', error);
    res.status(500).json({
      sucesso: false,
      error: error.message || 'Erro ao continuar TEF.',
      retryAllowed: false
    });
  }
});

router.get('/transacao/:id', (req, res) => {
  const id = Number(req.params.id);

  db.get(`
    SELECT *
    FROM tef_transacoes
    WHERE id = ?
  `, [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!row) {
      return res.status(404).json({ error: 'Transação TEF não encontrada.' });
    }

    res.json(row);
  });
});

router.get('/venda/:vendaId/comprovantes', (req, res) => {
  const vendaId = Number(req.params.vendaId);

  db.all(`
    SELECT
      id,
      venda_id,
      forma_pagamento,
      valor,
      tef_transacao_id,
      tef_nsu,
      tef_autorizacao,
      tef_bandeira,
      tef_adquirente,
      tef_comprovante_cliente,
      tef_comprovante_estabelecimento
    FROM venda_pagamentos
    WHERE venda_id = ?
      AND tef_transacao_id IS NOT NULL
  `, [vendaId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json(rows || []);
  });
});

router.get('/venda/:vendaId/resumo', (req, res) => {
  const vendaId = Number(req.params.vendaId);

  // TEF: preferir vínculo em venda_pagamentos; fallback para vendas.tef_transacao_id /
  // tef_transacoes (ex.: recuperação administrativa 51.42 sem espelho em pagamentos).
  db.get(`
    SELECT
      v.id AS venda_id,
      v.total AS venda_total,
      v.forma_pagamento AS venda_forma_pagamento,
      v.data_venda,

      n.numero AS nfce_numero,
      n.chave_acesso AS nfce_chave,
      n.status AS nfce_status,
      n.protocolo AS nfce_protocolo,

      COALESCE(vp.tef_transacao_id, tt.id) AS tef_transacao_id,
      COALESCE(vp.tef_nsu, tt.nsu) AS tef_nsu,
      COALESCE(vp.tef_autorizacao, tt.autorizacao) AS tef_autorizacao,
      COALESCE(vp.tef_bandeira, tt.bandeira) AS tef_bandeira,
      COALESCE(vp.tef_adquirente, tt.adquirente) AS tef_adquirente

    FROM vendas v

    LEFT JOIN nfce_notas n
      ON n.venda_id = v.id

    LEFT JOIN venda_pagamentos vp
      ON vp.venda_id = v.id
      AND vp.tef_transacao_id IS NOT NULL

    LEFT JOIN tef_transacoes tt
      ON tt.id = COALESCE(v.tef_transacao_id, vp.tef_transacao_id)

    WHERE v.id = ?

    ORDER BY n.id DESC
    LIMIT 1
  `, [vendaId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!row) {
      return res.status(404).json({ error: 'Venda não encontrada.' });
    }

    classificarSituacaoFiscalDaVenda(db, vendaId)
      .then((fiscal) => {
        res.json({
          ...row,
          nfce_situacao_fiscal: fiscal.situacao,
          nfce_documentada: fiscal.documentada,
          nfce_exige_recuperacao: fiscal.exige_recuperacao,
          nfce_classificacao_motivo: fiscal.motivo,
          nfce_cstats: fiscal.cstats
        });
      })
      .catch((classErr) => res.status(500).json({ error: classErr.message }));
  });
});

router.post('/cancelar', async (req, res) => {
  try {
    const { transacao_id, motivo } = req.body;

    if (!transacao_id) {
      return res.status(400).json({ error: 'transacao_id é obrigatório.' });
    }

    const resultado = await tefService.cancelarPagamento(
      Number(transacao_id),
      motivo || 'Cancelamento da venda'
    );

    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.username || req.user?.nome || null,
      modulo: 'tef',
      acao: 'cancelar_pagamento',
      referencia_tipo: 'tef_transacao',
      referencia_id: Number(transacao_id),
      detalhes: { motivo: motivo || 'Cancelamento da venda', ip: req.ip || null },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria TEF cancelar:', auditErr));

    res.json(resultado);

  } catch (error) {
    console.error('Erro ao cancelar TEF:', error);
    res.status(500).json({
      error: error.message || 'Erro ao cancelar TEF.'
    });
  }
});

router.get('/transacoes/recentes', (req, res) => {
  const limit = Number(req.query.limit) || 20;
  const apenasIntegradas = req.query.apenas_integradas === '1' || req.query.apenas_integradas === 'true';

  const sql = apenasIntegradas
    ? `SELECT * FROM tef_transacoes WHERE venda_id IS NOT NULL ORDER BY criado_em DESC LIMIT ?`
    : `SELECT * FROM tef_transacoes ORDER BY criado_em DESC LIMIT ?`;

  db.all(sql, [limit], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json(rows || []);
  });
});

router.get('/pinpads-catalogo', async (req, res) => {
  try {
    const pinpadCatalogService = require('../services/tef/pinpadCatalogService');
    const pinpads = await pinpadCatalogService.listarCatalogoAtivo();
    res.json({ sucesso: true, pinpads });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/** RC5 — Discovery de PinPads via Motor (IntegrationService), sem duplicar enumeração. */
router.post('/equipamentos/descobrir', verificarToken, async (req, res) => {
  try {
    const { modulos } = require('../services/equipamentos-integracao');
    const data = await modulos.tef.descobrirPinpads(req.user || { perfil: 'SUPER_ADMIN' }, req.body || {});
    res.json({ sucesso: true, ...data });
  } catch (error) {
    console.error('Erro Discovery TEF via integração:', error);
    res.status(error.statusCode || 500).json({ sucesso: false, erro: error.message || 'Erro na descoberta.' });
  }
});

router.get('/diagnostico-sdk', async (req, res) => {
  try {
    const sdks = sdkDetector.localizarSDKs();

    return res.json({
      sucesso: true,
      encontrados: sdks
    });

  } catch (error) {
    return res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

router.get('/diagnostico', async (req, res) => {
  try {
    const sdks = sdkDetector.localizarSDKs();

    res.json({
      sucesso: true,
      sdkEncontrado: sdks.length > 0,
      sdks
    });
  } catch (error) {
    res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

router.get('/diagnostico-completo', async (req, res) => {
  try {
    const relatorio = await tefDiagnosticoService.executarDiagnosticoCompleto();
    res.json(relatorio);
  } catch (error) {
    console.error('Erro diagnóstico TEF completo:', error);
    res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

router.get('/eventos', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const enviar = (evento, payload) => {
    res.write(`event: ${evento}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const onPinpad = (payload) => enviar('pinpad', payload);
  const onEstado = (payload) => enviar('estado', payload);
  const onErro = (payload) => enviar('erro', payload);

  tefEvents.onPinpad(onPinpad);
  tefEvents.onEstado(onEstado);
  tefEvents.onErro(onErro);

  enviar('conectado', { mensagem: 'Stream de eventos TEF ativo', timestamp: new Date().toISOString() });

  req.on('close', () => {
    tefEvents.off('pinpad', onPinpad);
    tefEvents.off('estado', onEstado);
    tefEvents.off('erro', onErro);
  });
});

router.get('/transacoes-pendentes', async (req, res) => {
  try {
    const tefPendenciasService = require('../services/tef/tefPendenciasService');
    const relatorio = await tefPendenciasService.listarPendenciasOperacionais({ db });
    res.json(relatorio);
  } catch (error) {
    res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

/** Lote automático desativado (TEF-14) — risco de aprovar/descartar inconclusivas. */
router.post('/reconciliar-pendentes', async (req, res) => {
  const tefPendenciasService = require('../services/tef/tefPendenciasService');
  const recusa = tefPendenciasService.rejeitarReconcilicaoEmLoteAutomatica();
  return res.status(409).json(recusa);
});

/**
 * Reconciliação explícita de uma pendência (operador).
 * Body: { financialState, observacao, confirmacao_explicita: true }
 */
router.post('/transacao/:id/reconciliar', async (req, res) => {
  try {
    const tefPendenciasService = require('../services/tef/tefPendenciasService');
    const transacaoId = Number(req.params.id);
    if (!Number.isFinite(transacaoId) || transacaoId <= 0) {
      return res.status(400).json({
        sucesso: false,
        codigo: 'TEF_RECONCILIACAO_INVALIDA',
        erro: 'ID de transação inválido'
      });
    }

    const financialState = req.body?.financialState;
    const observacao = req.body?.observacao;
    const confirmacao = req.body?.confirmacao_explicita === true;
    const usuario = req.user?.username
      || req.user?.nome
      || (req.user?.id != null ? String(req.user.id) : null);
    if (!usuario) {
      return res.status(401).json({
        sucesso: false,
        codigo: 'TEF_RECONCILIACAO_OPERADOR_NAO_AUTENTICADO',
        erro: 'Reconciliação exige identidade de operador autenticada'
      });
    }

    const resultado = await tefPendenciasService.reconciliarExplicita({
      transacaoId,
      financialState,
      usuario,
      observacao,
      confirmacao_explicita: confirmacao
    });

    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: usuario,
      modulo: 'tef',
      acao: 'reconciliar_pendencia_explicita',
      referencia_tipo: 'tef_transacao',
      referencia_id: transacaoId,
      detalhes: {
        financialState,
        confirmacao_explicita: true,
        travaLiberada: resultado.travaLiberada === true
      },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro auditoria TEF reconciliar:', auditErr));

    res.json(resultado);
  } catch (error) {
    const codigo = error.code || 'TEF_RECONCILIACAO_FALHOU';
    const statusHttp = codigo === 'TEF_RECONCILIACAO_PREMATURA'
      || codigo === 'TEF_LIBERACAO_INCONCLUSIVA_PROIBIDA'
      ? 409
      : (codigo.startsWith('TEF_RECONCILIACAO') ? 400 : 500);
    res.status(statusHttp).json({
      sucesso: false,
      codigo,
      erro: error.message
    });
  }
});

/** Tentativa de liberar inconclusiva — sempre recusada (evidência operacional). */
router.post('/pendencias/liberar-inconclusiva', async (req, res) => {
  const tefPendenciasService = require('../services/tef/tefPendenciasService');
  const recusa = tefPendenciasService.tentarLiberarInconclusiva();
  return res.status(409).json(recusa);
});

router.get('/monitor-status', async (req, res) => {
  try {
    const tefMonitorService = require('../services/tef/tefMonitorService');
    
    // Verificar se o monitor está respondendo
    const status = await tefMonitorService.obterStatusMonitor();
    
    res.json({
      sucesso: true,
      monitor_ativo: true,
      status
    });
  } catch (error) {
    console.error('Erro ao verificar status do monitor:', error);
    res.json({
      sucesso: false,
      monitor_ativo: false,
      erro: error.message
    });
  }
});

router.get('/venda-integrada', async (req, res) => {
  try {
    // Verificar se há vínculo entre venda_pagamentos e tef_transacoes
    db.get(`
      SELECT COUNT(*) as total
      FROM venda_pagamentos vp
      INNER JOIN tef_transacoes tt ON vp.tef_transacao_id = tt.id
      WHERE vp.tef_transacao_id IS NOT NULL
    `, [], (err, row) => {
      if (err) {
        return res.status(500).json({
          sucesso: false,
          erro: err.message
        });
      }

      const integrada = (row?.total || 0) > 0;
      
      res.json({
        sucesso: true,
        integrada,
        total_vinculos: row?.total || 0
      });
    });
  } catch (error) {
    res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

router.get('/conciliacao', async (req, res) => {
  try {
    const { data_inicio, data_fim } = req.query;
    
    const dataInicio = data_inicio || new Date().toISOString().split('T')[0];
    const dataFim = data_fim || new Date().toISOString().split('T')[0];
    
    const resultado = await tefConciliacaoService.executarConciliacao(dataInicio, dataFim);
    
    res.json(resultado);
  } catch (error) {
    console.error('Erro ao executar conciliação TEF:', error);
    res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});

router.post('/transacao/:id/reimprimir', async (req, res) => {
  try {
    const transacaoId = Number(req.params.id);
    const { tipo } = req.body;

    if (!tipo || !['cliente', 'loja'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo inválido. Use "cliente" ou "loja".' });
    }

    const resultado = await tefService.reimprimirPagamento(transacaoId, tipo);

    if (!resultado.sucesso) {
      return res.status(400).json({
        sucesso: false,
        error: resultado.mensagem || 'Comprovante não disponível.'
      });
    }

    res.json({
      sucesso: true,
      tipo,
      comprovante: resultado.comprovante,
      mensagem: resultado.mensagem
    });
  } catch (error) {
    console.error('Erro ao reimprimir comprovante:', error);
    res.status(500).json({
      error: error.message || 'Erro ao reimprimir comprovante.'
    });
  }
});

module.exports = router;