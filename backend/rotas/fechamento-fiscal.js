/**
 * Sprint 01–04 — Rotas Fechamento Fiscal do Dia
 * Montado em /api/fiscal/fechamentos
 */

'use strict';

const express = require('express');
const router = express.Router();
const service = require('../services/fechamento-fiscal');
const moduloConfig = require('../services/fechamento-fiscal/fechamentoFiscalModuloConfig');
const db = require('../database');
const { contextoAuditoriaRequisicao } = require('../services/auditoria');

function usuarioId(req) {
  return req.user?.id || req.usuario?.id || null;
}

function sendError(res, err) {
  const status = err.statusCode || err.status || 500;
  const erros = Array.isArray(err.erros) ? err.erros : undefined;
  const detalhes = erros
    ? erros.map((e) => e.mensagem || e.message || String(e)).filter(Boolean).join(' ')
    : undefined;
  const body = {
    error: err.message || 'Erro no fechamento fiscal',
    code: err.code || undefined,
    detalhes: detalhes || undefined
  };
  if (err.fechamento) body.fechamento = err.fechamento;
  if (err.capacidade != null) body.capacidade = err.capacidade;
  if (erros) body.erros = erros;
  if (err.checklist) body.checklist = err.checklist;
  if (err.validacao) body.validacao = err.validacao;
  if (err.documentos) body.documentos = err.documentos;
  if (err.resultados) body.resultados = err.resultados;
  if (err.pendencias) body.pendencias = err.pendencias;
  if (err.diagnostico) body.diagnostico = err.diagnostico;
  return res.status(status).json(body);
}

/** Status do módulo — permitido mesmo com módulo OFF */
router.get('/modulo', async (req, res) => {
  try {
    const dados = await moduloConfig.lerAsync(db);
    let ambiente = null;
    let diagnostico = {
      ok: false,
      transmissao_habilitada: false,
      producao_bloqueada: false,
      pendencias: [],
      mensagem: 'Configuração fiscal indisponível.'
    };
    try {
      const { getFiscalConfig } = require('../services/fiscal/configService');
      const cfg = await getFiscalConfig({ validarUrls: false });
      ambiente = Number(cfg.ambiente);
      const { diagnosticarProntidaoTransmissao } = require('../services/fechamento-fiscal/FechamentoFiscalTransmissaoService');
      diagnostico = diagnosticarProntidaoTransmissao(cfg);
    } catch (e) {
      diagnostico.mensagem = e.message || diagnostico.mensagem;
      diagnostico.pendencias = [{
        codigo: 'CONFIG_FISCAL',
        mensagem: e.message || 'Falha ao carregar configuração fiscal.'
      }];
    }
    res.json({
      ...dados,
      ambiente,
      ambiente_label: diagnostico.ambiente_label || null,
      transmissao_habilitada: Boolean(dados.permitido && diagnostico.transmissao_habilitada),
      transmissao_homologacao: Boolean(dados.permitido && ambiente === 2 && diagnostico.transmissao_habilitada),
      transmissao_producao: Boolean(dados.permitido && ambiente === 1 && diagnostico.transmissao_habilitada),
      producao_bloqueada: false,
      diagnostico_transmissao: diagnostico,
      mensagem_ambiente: dados.permitido
        ? diagnostico.mensagem
        : 'Fechamento Fiscal do Dia desativado.'
    });
  } catch (err) {
    sendError(res, err);
  }
});

async function exigirModuloOn(req, res, next) {
  try {
    const ok = await moduloConfig.estaAtivadaAsync(db);
    if (!ok) {
      return res.status(403).json({
        error: 'Fechamento Fiscal do Dia está desativado. Ative em Configurações → Avançado → Fiscal.',
        code: 'MODULO_OFF',
        permitido: false
      });
    }
    return next();
  } catch (err) {
    return sendError(res, err);
  }
}

router.use(exigirModuloOn);

/** GET /previa — READ-ONLY comercial (deve vir antes de /:id) */
router.get('/previa', async (req, res) => {
  try {
    const result = await service.gerarPrevia({
      data: req.query.data || req.query.data_fechamento,
      valor_informado: req.query.valor_informado != null ? Number(req.query.valor_informado) : undefined,
      valor_alvo: req.query.valor_alvo != null ? Number(req.query.valor_alvo) : undefined,
      valor_min: req.query.valor_min != null ? Number(req.query.valor_min) : undefined,
      valor_max: req.query.valor_max != null ? Number(req.query.valor_max) : undefined,
      fechamento_id: req.query.fechamento_id ? Number(req.query.fechamento_id) : undefined,
      persistir: String(req.query.persistir || '0') === '1'
    });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/resumo', async (req, res) => {
  try {
    const data = req.query.data || req.query.data_fechamento;
    const fechamentoId = req.query.fechamento_id != null && String(req.query.fechamento_id).trim() !== ''
      ? Number(req.query.fechamento_id)
      : null;
    let opts = {};
    if (fechamentoId != null && Number.isFinite(fechamentoId) && fechamentoId > 0) {
      // Guard: FF AUTORIZADO/CONCLUÍDO não deve ser excluído do residual (evita “ressuscitar” elegíveis).
      const db = require('../database');
      const { STATUS } = require('../services/fechamento-fiscal/constants');
      const row = await new Promise((resolve, reject) => {
        db.get(
          'SELECT id, status FROM fechamentos_fiscais WHERE id = ?',
          [fechamentoId],
          (err, r) => (err ? reject(err) : resolve(r))
        );
      });
      const st = String((row && row.status) || '').toUpperCase();
      const finalizado = st === STATUS.AUTORIZADO
        || st === STATUS.CONCLUIDO
        || st === STATUS.CONFIRMADO;
      if (!finalizado) {
        opts = { excluirFechamentoId: fechamentoId };
      }
    }
    const resumo = await service.obterResumoDia(require('../database'), data, opts);
    res.json(resumo);
  } catch (err) {
    sendError(res, err);
  }
});

/** Sprint 07.7 — consulta explícita de duplicidades 539; nunca emite NFC-e. */
router.post('/recuperar-duplicidades', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.confirmacao_consulta !== true) {
      return res.status(400).json({
        error: 'Confirmação explícita obrigatória antes de consultar a SEFAZ.',
        code: 'CONFIRMACAO_CONSULTA_OBRIGATORIA'
      });
    }
    const pendencias = Array.isArray(body.pendencias) ? body.pendencias.slice(0, 50) : [];
    if (!pendencias.length) {
      return res.status(400).json({
        error: 'Informe ao menos uma venda/NFC-e em duplicidade para recuperação.',
        code: 'PENDENCIAS_OBRIGATORIAS'
      });
    }

    const ctx = contextoAuditoriaRequisicao(req);
    const resultados = [];
    for (const pendencia of pendencias) {
      try {
        resultados.push(await service.recuperarSituacaoDuplicidade({
          venda_id: pendencia.venda_id,
          nfce_id: pendencia.nfce_id,
          confirmacao_consulta: true,
          usuario_id: ctx.usuario_id,
          usuario_nome: ctx.usuario_nome,
          ip_requisicao: ctx.ip_requisicao
        }));
      } catch (err) {
        resultados.push({
          success: false,
          venda_id: Number(pendencia.venda_id || 0) || null,
          nfce_id: Number(pendencia.nfce_id || 0) || null,
          situacao_fiscal: 'ERRO',
          code: err.code || 'ERRO_RECUPERACAO',
          mensagem: err.message || 'Falha ao recuperar situação fiscal.'
        });
      }
    }

    const data = body.data || body.data_fechamento;
    const resumo = data ? await service.obterResumoDia(db, data) : null;
    res.json({
      success: resultados.every((r) => r.success),
      consultou_sefaz: resultados.some((r) => r.consultou_sefaz),
      emitiu_nfce: false,
      resultados,
      resumo
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/', async (req, res) => {
  try {
    const lista = await service.listarFechamentos({
      data: req.query.data,
      cnpj: req.query.cnpj,
      status: req.query.status,
      limite: req.query.limite
    });
    res.json({ fechamentos: lista });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const criado = await service.criarRascunho({
      ...body,
      usuario_id: body.usuario_id != null ? body.usuario_id : usuarioId(req)
    });
    res.status(201).json(criado);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const item = await service.obterPorId(req.params.id);
    res.json(item);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/recebimentos', async (req, res) => {
  try {
    const item = await service.adicionarRecebimento(req.params.id, req.body || {});
    res.status(201).json(item);
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/:id/recebimentos', async (req, res) => {
  try {
    const body = req.body || {};
    const lista = Array.isArray(body.recebimentos) ? body.recebimentos : [];
    const item = await service.substituirRecebimentos(req.params.id, lista);
    res.json(item);
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/:id/recebimentos/:recebimentoId', async (req, res) => {
  try {
    const item = await service.removerRecebimento(req.params.id, req.params.recebimentoId);
    res.json(item);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/previa', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await service.gerarPrevia({
      id: Number(req.params.id),
      data: body.data,
      data_fechamento: body.data_fechamento,
      valor_informado: body.valor_informado != null ? Number(body.valor_informado) : undefined,
      valor_alvo: body.valor_alvo != null ? Number(body.valor_alvo) : undefined,
      valor_min: body.valor_min != null ? Number(body.valor_min) : undefined,
      valor_max: body.valor_max != null ? Number(body.valor_max) : undefined,
      persistir: true
    });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/cancelar', async (req, res) => {
  try {
    const item = await service.cancelarFechamento(req.params.id);
    res.json(item);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/validar', async (req, res) => {
  try {
    const result = await service.validarFiscal(req.params.id, {
      usuario_id: usuarioId(req),
      ...(req.body || {})
    });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/preparar-emissao', async (req, res) => {
  try {
    const result = await service.prepararEmissaoFiscal(req.params.id, {
      usuario_id: usuarioId(req),
      gerarXml: req.body?.gerarXml !== false,
      ...(req.body || {})
    });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/:id/documentos', async (req, res) => {
  try {
    const documentos = await service.listarDocumentosFiscais(req.params.id);
    let diagnostico = { transmissao_habilitada: false, producao_bloqueada: false };
    try {
      const { getFiscalConfig } = require('../services/fiscal/configService');
      const { diagnosticarProntidaoTransmissao } = require('../services/fechamento-fiscal/FechamentoFiscalTransmissaoService');
      const cfg = await getFiscalConfig({ validarUrls: false });
      diagnostico = diagnosticarProntidaoTransmissao(cfg);
    } catch (_) { /* ignore */ }
    res.json({
      documentos,
      transmissao_habilitada: Boolean(diagnostico.transmissao_habilitada),
      producao_bloqueada: false,
      diagnostico_transmissao: diagnostico
    });
  } catch (err) {
    sendError(res, err);
  }
});

/** Sprint 04/07.2 — transmissão SEFAZ (PRODUÇÃO ou HOMOLOGAÇÃO) */
router.post('/:id/transmitir', async (req, res) => {
  try {
    const result = await service.transmitirFechamentoFiscal(req.params.id, {
      usuario_id: usuarioId(req),
      empresa_id: req.user?.empresa_id,
      ...(req.body || {})
    });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

/** Sprint 04 — recuperação após timeout / EMITINDO */
router.post('/:id/recuperar', async (req, res) => {
  try {
    const result = await service.recuperarFechamentoFiscal(req.params.id, {
      usuario_id: usuarioId(req),
      ...(req.body || {})
    });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
