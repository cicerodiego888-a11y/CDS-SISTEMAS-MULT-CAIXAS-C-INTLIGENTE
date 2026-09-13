/**
 * RC4.0.0 / RC4.0.2 / RC4.1.0 — Rotas da Central de Faturamento (canônicas V4).
 * Gate: recurso nfe. Não cria venda / não altera estoque.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { contextoAuditoriaRequisicao } = require('../services/auditoria');
const Central = require('../services/faturamento/CentralFaturamentoService');

function responderErro(res, err) {
  const status = err.statusCode || 500;
  const mensagem = err.message || 'Erro interno.';
  return res.status(status).json({
    success: false,
    error: mensagem,
    mensagem,
    codigo: err.codigo || undefined,
    checklist: err.checklist || undefined
  });
}

router.get('/painel', async (req, res) => {
  try {
    res.json(await Central.obterPainelInicial(req.query || {}));
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    res.json(await Central.obterDashboard());
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/sefaz', async (req, res) => {
  try {
    res.json(await Central.obterStatusSefaz());
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/rejeicoes', async (req, res) => {
  try {
    res.json(await Central.obterPainelRejeicoes(req.query || {}));
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/eventos', async (req, res) => {
  try {
    res.json(await Central.listarEventosGlobais(req.query || {}));
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/lote', async (req, res) => {
  try {
    const ctx = contextoAuditoriaRequisicao(req);
    res.json(await Central.executarAcoesLote(req.body || {}, {
      usuarioId: ctx.usuario_id,
      usuarioNome: ctx.usuario_nome,
      ip: ctx.ip_requisicao,
      reqHttp: req
    }));
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/fila', async (req, res) => {
  try {
    res.json(await Central.listarFila(req.query || {}));
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/vendas/:vendaId', async (req, res) => {
  try {
    res.json(await Central.obterPacote(req.params.vendaId, req.query || {}));
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/vendas/:vendaId/checklist', async (req, res) => {
  try {
    res.json(await Central.obterChecklist(req.params.vendaId, req.query || {}));
  } catch (err) {
    responderErro(res, err);
  }
});

router.put('/vendas/:vendaId/dados-fiscais', async (req, res) => {
  try {
    res.json(await Central.salvarDadosFiscais(req.params.vendaId, req.body || {}));
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/vendas/:vendaId/emitir', async (req, res) => {
  try {
    res.json(await Central.emitir(req.params.vendaId, req.body || {}, req));
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/vendas/:vendaId/reenviar', async (req, res) => {
  try {
    const ctx = contextoAuditoriaRequisicao(req);
    res.json(await Central.reenviar(req.params.vendaId, {
      usuarioId: ctx.usuario_id,
      usuarioNome: ctx.usuario_nome,
      ip: ctx.ip_requisicao,
      reqHttp: req
    }));
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/vendas/:vendaId/xml', async (req, res) => {
  try {
    const out = await Central.obterXml(req.params.vendaId);
    if (String(req.query.download || '') === '1') {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="NFe-${out.chave || out.nota_id}.xml"`);
      return res.send(out.xml);
    }
    res.json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

router.get('/vendas/:vendaId/danfe', async (req, res) => {
  try {
    const out = await Central.obterDanfe(req.params.vendaId);
    if (String(req.query.download || '') === '1' || String(req.query.html || '') === '1') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(out.danfe_html);
    }
    res.json(out);
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/vendas/:vendaId/consultar', async (req, res) => {
  try {
    const ctx = contextoAuditoriaRequisicao(req);
    res.json(await Central.consultarSituacao(req.params.vendaId, {
      usuarioId: ctx.usuario_id,
      usuarioNome: ctx.usuario_nome,
      ip: ctx.ip_requisicao
    }));
  } catch (err) {
    responderErro(res, err);
  }
});

router.post('/notas/:notaId/cancelar', async (req, res) => {
  try {
    const ctx = contextoAuditoriaRequisicao(req);
    const justificativa = req.body?.justificativa || req.body?.motivo || '';
    res.json(await Central.cancelarNota(req.params.notaId, justificativa, {
      usuarioId: ctx.usuario_id,
      usuarioNome: ctx.usuario_nome,
      ip: ctx.ip_requisicao,
      forcarPrazo: Boolean(req.body?.forcarPrazo)
    }));
  } catch (err) {
    responderErro(res, err);
  }
});

module.exports = router;
