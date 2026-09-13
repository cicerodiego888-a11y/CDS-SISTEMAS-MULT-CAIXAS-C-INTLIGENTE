/**
 * Rotas — Expedição comercial (UI: Expedição; path legado: /api/faturamento).
 * RC4.1.0 — Arquitetura Comercial/Fiscal V4 CONGELADA.
 *
 * Fluxo canônico:
 *   Pedido → Expedição (cria venda no Núcleo) → Central de Faturamento → NF-e → DANFE
 *
 * Esta rota NÃO emite NF-e no faturarPedido.
 * Emissão canônica: POST /api/central-faturamento/vendas/:vendaId/emitir
 */

'use strict';

const express = require('express');
const router = express.Router();
const configService = require('../services/configuracaoService');
const PedidoService = require('../services/pedido/PedidoService');
const FaturamentoService = require('../services/faturamento/FaturamentoService');
const { responderModuloNaoLicenciado } = require('../middleware/errosLicenciamento');

function exigirModuloFaturamento(req, res, next) {
  if (!configService.recursoHabilitado('faturamento')) {
    return responderModuloNaoLicenciado(res, 'faturamento');
  }
  return next();
}

function responderErro(res, err) {
  const status = err.statusCode || 500;
  return res.status(status).json({
    success: false,
    error: err.message || 'Erro interno.',
    codigo: err.codigo || undefined,
    venda_id: err.venda_id || undefined,
    body: err.body || undefined
  });
}

router.use(exigirModuloFaturamento);

/** Fila de pedidos aguardando faturamento */
router.get('/pedidos/aguardando-faturamento', async (req, res) => {
  try {
    const out = await PedidoService.listarFilaFaturamento();
    res.json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/pedidos/:id', async (req, res) => {
  try {
    const out = await PedidoService.obterPedido(req.params.id);
    res.json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

/** Criação mínima de pedido (entrada na fila) */
router.post('/pedidos', async (req, res) => {
  try {
    const operadorId = req.user?.id || null;
    const out = await PedidoService.criarPedido(req.body || {}, operadorId);
    res.status(201).json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

/**
 * FATURAR — Pedido → Núcleo → NF-e 55
 * POST /api/faturamento/pedidos/:id/faturar
 */
router.post('/pedidos/:id/faturar', async (req, res) => {
  try {
    const out = await FaturamentoService.faturarPedido(
      req.params.id,
      req.body || {},
      req
    );
    res.json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

/**
 * Sprint 3.13 — Central de Vendas Faturadas
 * GET /api/faturamento/vendas-faturadas?aba=todas|com_nfe|sem_nfe|pendentes|canceladas&modo_fiscal=0|1&page=1&pageSize=20
 */
router.get('/vendas-faturadas', async (req, res) => {
  try {
    const out = await FaturamentoService.listarVendasFaturadas(req.query || {});
    res.json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

/** DANFE / nota NF-e da venda faturada */
router.get('/vendas/:vendaId/nfe', async (req, res) => {
  try {
    if (!configService.recursoHabilitado('nfe')) {
      return responderModuloNaoLicenciado(res, 'nfe');
    }
    const { obterNotaNfePorVenda } = require('../services/fiscal/nfeEmissorVenda');
    const nota = await obterNotaNfePorVenda(req.params.vendaId);
    if (!nota) return res.status(404).json({ error: 'NF-e não encontrada para esta venda.' });
    res.json({ success: true, nota });
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/vendas/:vendaId/danfe', async (req, res) => {
  try {
    if (!configService.recursoHabilitado('nfe')) {
      return responderModuloNaoLicenciado(res, 'nfe');
    }
    const { obterNotaNfePorVenda } = require('../services/fiscal/nfeEmissorVenda');
    const nota = await obterNotaNfePorVenda(req.params.vendaId);
    if (!nota || !nota.danfe_html) {
      return res.status(404).json({ error: 'DANFE não disponível.' });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(nota.danfe_html);
  } catch (err) {
    responderErro(res, err);
  }
});

/**
 * LEGADO — preferir POST /api/central-faturamento/vendas/:vendaId/emitir (V4 canônico).
 * Mantido por compatibilidade; marcado Deprecation no header.
 */
router.post('/vendas/:vendaId/nfe/emitir', async (req, res) => {
  try {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Link', '</api/central-faturamento/vendas/{vendaId}/emitir>; rel="successor-version"');
    if (!configService.recursoHabilitado('nfe')) {
      return responderModuloNaoLicenciado(res, 'nfe');
    }
    if (!configService.recursoHabilitado('faturamento')) {
      return responderModuloNaoLicenciado(res, 'faturamento');
    }
    const { traceNfe } = require('../services/fiscal/nfeTrace');
    traceNfe('LEGADO POST /faturamento/vendas/:vendaId/nfe/emitir → preferir central-faturamento', {
      vendaId: req.params.vendaId,
      pedidoId: req.body?.pedido_id || null
    });
    const { emitirNfePorVendaId } = require('../services/fiscal/nfeEmissorVenda');
    const out = await emitirNfePorVendaId(req.params.vendaId, {
      dadosNfe: req.body || {},
      pedidoId: req.body?.pedido_id
    });
    res.json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

module.exports = router;
