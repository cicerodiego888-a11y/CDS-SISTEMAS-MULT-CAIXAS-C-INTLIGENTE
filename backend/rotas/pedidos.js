/**
 * Rotas — Módulo Pedidos (Sprint 3.5 + 3.14 Orçamento + RC3.16.1)
 * Gate: recursos.pedidos (Sprint 3.9 — herda faturamento quando flag ausente)
 */

'use strict';

const express = require('express');
const router = express.Router();
const { exigirRecurso } = require('../middleware/validarRecursoImplantacao');
const PedidoOperacional = require('../services/pedido/PedidoOperacionalService');

router.use(exigirRecurso('pedidos'));

function responderErro(res, err) {
  const status = err.statusCode || 500;
  const payload = {
    success: false,
    error: err.message || 'Erro interno.',
    mensagem: err.message || 'Erro interno.',
    codigo: err.codigo || err.code || undefined
  };
  if (err.requer_autorizacao) payload.requer_autorizacao = true;
  if (err.plano) payload.plano = err.plano;
  if (err.consultas) payload.consultas = err.consultas;
  if (err.codigo === 'MODULO_NAO_LICENCIADO') {
    payload.erro = 'MODULO_NAO_LICENCIADO';
    payload.modulo = 'pedidos';
  }
  return res.status(status).json(payload);
}

router.get('/', async (req, res) => {
  try {
    const out = await PedidoOperacional.listar({
      status: req.query.status,
      cliente: req.query.cliente,
      representante: req.query.representante,
      dataInicio: req.query.dataInicio || req.query.inicio,
      dataFim: req.query.dataFim || req.query.fim,
      busca: req.query.busca || req.query.q,
      limite: req.query.limite
    });
    res.json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const out = await PedidoOperacional.obter(req.params.id);
    res.json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/', async (req, res) => {
  try {
    const out = await PedidoOperacional.criar(req.body || {}, req.user?.id || null);
    res.status(201).json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const out = await PedidoOperacional.atualizar(req.params.id, req.body || {});
    res.json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/:id/cancelar', async (req, res) => {
  try {
    const out = await PedidoOperacional.cancelar(req.params.id);
    res.json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const out = await PedidoOperacional.excluir(req.params.id);
    res.json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/:id/duplicar', async (req, res) => {
  try {
    const out = await PedidoOperacional.duplicar(req.params.id, req.user?.id || null);
    res.status(201).json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/:id/converter', async (req, res) => {
  try {
    const out = await PedidoOperacional.converterParaPedido(
      req.params.id,
      req.body || {},
      req.user?.id || null
    );
    res.json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/:id/enviar-faturamento', async (req, res) => {
  try {
    const out = await PedidoOperacional.enviarParaFaturamento(
      req.params.id,
      req.body || {},
      req.user?.id || null
    );
    res.json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

module.exports = router;
