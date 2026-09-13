/**
 * Rotas da Central operacional de NF-e — Sprint 3.3 / 3.4.
 * Gate: recursos.nfe
 */

'use strict';

const express = require('express');
const router = express.Router();
const { exigirRecurso } = require('../middleware/validarRecursoImplantacao');
const { contextoAuditoriaRequisicao } = require('../services/auditoria');
const nfeCentral = require('../services/fiscal/nfeCentralService');
const nfeOperacional = require('../services/fiscal/nfeOperacionalService');
const nfeAvulsa = require('../services/fiscal/nfeAvulsaService');
const danfeCentral = require('../services/fiscal/danfeService');
const { respostaAmigavel, classificarErro } = require('../services/fiscal/nfeErros');

router.use(exigirRecurso('nfe'));

/** RC3.16 — Nova NF-e Avulsa (sem Pedido / sem Faturamento) */
router.post('/avulsa', async (req, res) => {
  try {
    const { traceNfe } = require('../services/fiscal/nfeTrace');
    traceNfe('rota POST /nfe/avulsa', {});
    const out = await nfeAvulsa.emitirNfeAvulsa(req.body || {}, req);
    res.json(out);
  } catch (err) {
    if (err.codigo === 'MODO_OPERACIONAL_NAO_FISCAL') {
      return res.status(err.statusCode || 403).json({
        success: false,
        codigo: err.codigo,
        mensagem: err.message,
        error: err.message
      });
    }
    enviarErroAmigavel(res, err, err.statusCode || 500);
  }
});

function enviarErroAmigavel(res, err, statusFallback = 500) {
  const status = err.statusCode || statusFallback;
  const amigavel = err.amigavel || respostaAmigavel(classificarErro({ erro: err.message }));
  return res.status(status).json({
    success: false,
    mensagem: amigavel.mensagem || err.message,
    codigo: err.code || amigavel.codigo || null,
    sugestao: amigavel.sugestao || null,
    error: amigavel.mensagem || err.message
  });
}

router.get('/monitor', async (req, res) => {
  try {
    const out = await nfeOperacional.obterMonitorNfe();
    res.json(out);
  } catch (err) {
    enviarErroAmigavel(res, err);
  }
});

router.get('/diagnostico', async (req, res) => {
  try {
    const out = await nfeOperacional.executarDiagnosticoFiscal();
    res.json(out);
  } catch (err) {
    enviarErroAmigavel(res, err);
  }
});

router.get('/fila', async (req, res) => {
  try {
    const itens = await nfeOperacional.listarFilaOperacional({
      estado: req.query.estado,
      status: req.query.status,
      busca: req.query.busca || req.query.q,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      ordenar: req.query.ordenar,
      direcao: req.query.direcao,
      limite: req.query.limite
    });
    res.json({ success: true, itens });
  } catch (err) {
    enviarErroAmigavel(res, err);
  }
});

router.get('/logs', async (req, res) => {
  try {
    const logs = await nfeOperacional.listarLogsOperacionais({
      notaId: req.query.notaId,
      acao: req.query.acao,
      documento: req.query.documento,
      limite: req.query.limite
    });
    res.json({ success: true, logs });
  } catch (err) {
    enviarErroAmigavel(res, err);
  }
});

router.post('/notas/:id/reenviar', async (req, res) => {
  try {
    const { traceNfe } = require('../services/fiscal/nfeTrace');
    traceNfe('rota POST /nfe/notas/:id/reenviar', { notaId: req.params.id });
    const ctx = contextoAuditoriaRequisicao(req);
    const out = await nfeOperacional.reenviarNfe(req.params.id, {
      usuarioId: ctx.usuario_id,
      usuarioNome: ctx.usuario_nome,
      ip: ctx.ip_requisicao
    });
    res.json(out);
  } catch (err) {
    enviarErroAmigavel(res, err, err.statusCode || 400);
  }
});

router.get('/notas', async (req, res) => {
  try {
    await nfeCentral.garantirColunasNfeCentral();
    await nfeOperacional.garantirSchemaOperacional();
    const notas = await nfeCentral.listarNfeNotas({
      numero: req.query.numero,
      serie: req.query.serie,
      situacao: req.query.situacao || req.query.status,
      cliente: req.query.cliente,
      chave: req.query.chave,
      tipo: req.query.tipo,
      dataInicio: req.query.dataInicio || req.query.inicio,
      dataFim: req.query.dataFim || req.query.fim,
      limite: req.query.limite
    });
    res.json({ success: true, notas });
  } catch (err) {
    enviarErroAmigavel(res, err);
  }
});

router.get('/notas/:id', async (req, res) => {
  try {
    const nota = await nfeCentral.obterNfeNotaPorId(req.params.id);
    if (!nota) {
      return enviarErroAmigavel(res, Object.assign(new Error('NF-e não encontrada.'), { statusCode: 404 }));
    }
    const { xml_enviado, xml_retorno, xml_cancelamento, danfe_html, ...meta } = nota;
    res.json({
      success: true,
      nota: {
        ...meta,
        tem_xml: Boolean(xml_retorno || xml_enviado),
        tem_danfe: Boolean(danfe_html),
        tem_xml_cancelamento: Boolean(xml_cancelamento)
      }
    });
  } catch (err) {
    enviarErroAmigavel(res, err);
  }
});

/** RC3.15 — ficha documental (somente leitura; não altera emissão) */
router.get('/notas/:id/ficha', async (req, res) => {
  try {
    const out = await nfeCentral.obterFichaDocumentalNfe(req.params.id);
    res.json(out);
  } catch (err) {
    enviarErroAmigavel(res, err, err.statusCode || 500);
  }
});

router.get('/notas/:id/xml', async (req, res) => {
  try {
    const nota = await nfeCentral.obterNfeNotaPorId(req.params.id);
    if (!nota) {
      return enviarErroAmigavel(res, Object.assign(new Error('NF-e não encontrada.'), { statusCode: 404 }));
    }
    const xml = nfeCentral.extrairXmlAutorizado(nota);
    if (!xml) {
      return enviarErroAmigavel(res, Object.assign(new Error('XML não disponível.'), { statusCode: 404 }));
    }

    if (String(req.query.download || '') === '1') {
      const nome = `NFe-${nota.chave_acesso || nota.id}.xml`;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
      return res.send(xml);
    }

    res.json({ success: true, xml, chave: nota.chave_acesso, status: nota.status });
  } catch (err) {
    enviarErroAmigavel(res, err);
  }
});

router.get('/notas/:id/danfe', async (req, res) => {
  try {
    const nota = await nfeCentral.obterNfeNotaPorId(req.params.id);
    if (!nota) {
      return enviarErroAmigavel(res, Object.assign(new Error('NF-e não encontrada.'), { statusCode: 404 }));
    }
    if (!nota.danfe_html) {
      return enviarErroAmigavel(res, Object.assign(new Error('DANFE não disponível para esta nota.'), { statusCode: 404 }));
    }

    if (String(req.query.download || '') === '1') {
      const nome = `DANFE-NFe-${nota.numero || nota.id}.html`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
      return res.send(nota.danfe_html);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(nota.danfe_html);
  } catch (err) {
    enviarErroAmigavel(res, err);
  }
});

router.get('/documentos/:tipo/:id', async (req, res) => {
  try {
    const doc = await danfeCentral.obterDocumentoFiscal({
      tipo: req.params.tipo,
      id: req.params.id,
      chave: req.query.chave,
      numero: req.query.numero,
      serie: req.query.serie
    });
    res.json({ success: true, documento: {
      modelo: doc.modelo,
      tipo: doc.tipo,
      id: doc.id,
      numero: doc.numero,
      serie: doc.serie,
      chave: doc.chave,
      status: doc.status,
      protocolo: doc.protocolo,
      dhAutorizacao: doc.dhAutorizacao,
      chaveReferenciada: doc.chaveReferenciada,
      autorizado: danfeCentral.statusEhAutorizado(doc.status)
    } });
  } catch (err) {
    enviarErroAmigavel(res, err, err.statusCode || 500);
  }
});

router.get('/documentos/:tipo/:id/danfe', async (req, res) => {
  try {
    const out = await danfeCentral.obterDanfe({
      tipo: req.params.tipo,
      id: req.params.id,
      chave: req.query.chave,
      numero: req.query.numero,
      serie: req.query.serie
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(out.html);
  } catch (err) {
    enviarErroAmigavel(res, err, err.statusCode || 500);
  }
});

router.get('/documentos/:tipo/:id/xml', async (req, res) => {
  try {
    const out = await danfeCentral.obterXmlAutorizado({
      tipo: req.params.tipo,
      id: req.params.id,
      chave: req.query.chave,
      numero: req.query.numero,
      serie: req.query.serie
    });
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${out.nome}"`);
    res.send(out.xml);
  } catch (err) {
    enviarErroAmigavel(res, err, err.statusCode || 500);
  }
});

router.get('/documentos/:tipo/:id/pdf', async (req, res) => {
  try {
    const out = await danfeCentral.obterPdfDanfe({
      tipo: req.params.tipo,
      id: req.params.id,
      chave: req.query.chave,
      numero: req.query.numero,
      serie: req.query.serie
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${out.nome}"`);
    res.send(out.buffer);
  } catch (err) {
    enviarErroAmigavel(res, err, err.statusCode || 500);
  }
});

router.post('/notas/:id/consultar', async (req, res) => {
  try {
    const ctx = contextoAuditoriaRequisicao(req);
    const out = await nfeCentral.consultarSituacaoNfe(req.params.id, {
      usuarioId: ctx.usuario_id,
      usuarioNome: ctx.usuario_nome,
      ip: ctx.ip_requisicao
    });
    res.json(out);
  } catch (err) {
    enviarErroAmigavel(res, err, err.statusCode || 502);
  }
});

router.post('/notas/:id/cancelar', async (req, res) => {
  try {
    const justificativa = req.body?.justificativa || req.body?.motivo || '';
    const ctx = contextoAuditoriaRequisicao(req);
    const out = await nfeCentral.cancelarNfeCentral(req.params.id, justificativa, {
      usuarioId: ctx.usuario_id,
      usuarioNome: ctx.usuario_nome,
      ip: ctx.ip_requisicao,
      forcarPrazo: Boolean(req.body?.forcarPrazo)
    });
    res.json(out);
  } catch (err) {
    enviarErroAmigavel(res, err, err.statusCode || 500);
  }
});

router.get('/notas/:id/historico', async (req, res) => {
  try {
    const eventos = await nfeCentral.listarHistoricoNfe(req.params.id, req.query.limite);
    res.json({ success: true, eventos });
  } catch (err) {
    enviarErroAmigavel(res, err);
  }
});

module.exports = router;
