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

function usuarioId(req) {
  return req.user?.id || req.usuario?.id || null;
}

function sendError(res, err) {
  const status = err.statusCode || err.status || 500;
  const body = {
    error: err.message || 'Erro no fechamento fiscal',
    code: err.code || undefined
  };
  if (err.fechamento) body.fechamento = err.fechamento;
  if (err.capacidade != null) body.capacidade = err.capacidade;
  if (err.erros) body.erros = err.erros;
  if (err.checklist) body.checklist = err.checklist;
  if (err.validacao) body.validacao = err.validacao;
  if (err.documentos) body.documentos = err.documentos;
  if (err.resultados) body.resultados = err.resultados;
  return res.status(status).json(body);
}

/** Status do módulo — permitido mesmo com módulo OFF */
router.get('/modulo', async (req, res) => {
  try {
    const dados = await moduloConfig.lerAsync(db);
    let ambiente = null;
    try {
      const { getFiscalConfig } = require('../services/fiscal/configService');
      const cfg = await getFiscalConfig({ validarUrls: false });
      ambiente = Number(cfg.ambiente);
    } catch (_) { /* ignore */ }
    res.json({
      ...dados,
      ambiente,
      transmissao_homologacao: dados.permitido && ambiente === 2,
      producao_bloqueada: true
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
    const resumo = await service.obterResumoDia(require('../database'), data);
    res.json(resumo);
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
    res.json({
      documentos,
      transmissao_habilitada: true,
      producao_bloqueada: true
    });
  } catch (err) {
    sendError(res, err);
  }
});

/** Sprint 04 — transmissão SEFAZ (somente homologação) */
router.post('/:id/transmitir', async (req, res) => {
  try {
    const result = await service.transmitirFechamentoFiscal(req.params.id, {
      usuario_id: usuarioId(req),
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
