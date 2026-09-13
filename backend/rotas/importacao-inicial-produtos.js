/**
 * Rotas — Importação Inicial de Produtos V1.0.4
 * POST /api/produtos/importacao-inicial/validar  (modo: CADASTRO_INICIAL | ATUALIZAR_QUANTIDADES)
 * POST /api/produtos/importacao-inicial/importar
 * GET  /api/produtos/importacao-inicial/status
 */
'use strict';

const express = require('express');
const multer = require('multer');
const db = require('../database');
const importacao = require('../services/importacao-inicial-produtos');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const nome = String(file.originalname || '').toLowerCase();
    const ok = nome.endsWith('.xlsx')
      || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || file.mimetype === 'application/octet-stream';
    if (!ok) {
      return cb(new Error('Formato inválido. Na V1 aceite apenas arquivos .xlsx'));
    }
    return cb(null, true);
  }
});

function responderErro(res, err, fallback) {
  const status = err.status || 500;
  const payload = {
    sucesso: false,
    error: err.message || fallback
  };
  if (err.detalhes) {
    payload.detalhes = err.detalhes;
  }
  if (err.cause && err.cause.message) {
    payload.causa = err.cause.message;
  }
  if (err.cause && err.cause.code) {
    payload.codigo = err.cause.code;
  }
  return res.status(status).json(payload);
}

router.post('/validar', (req, res) => {
  upload.single('arquivo')(req, res, async (errUpload) => {
    if (errUpload) {
      return res.status(400).json({ sucesso: false, error: errUpload.message });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ sucesso: false, error: 'Selecione um arquivo XLSX.' });
    }
    try {
      const modo = req.body?.modo || req.query?.modo || 'CADASTRO_INICIAL';
      const modoFiscal = req.body?.modo_fiscal_importacao ?? req.query?.modo_fiscal_importacao;
      const resultado = await importacao.validarArquivoBuffer(db, req.file.buffer, {
        nomeArquivo: req.file.originalname,
        modo,
        modo_fiscal_importacao: modoFiscal
      });
      return res.json({
        sucesso: true,
        ...resultado
      });
    } catch (err) {
      console.error('[IMPORTACAO-INICIAL] validar:', err);
      return responderErro(res, err, 'Falha ao validar a planilha.');
    }
  });
});

router.post('/importar', express.json(), async (req, res) => {
  try {
    const sessaoId = req.body?.sessao_id;
    if (!sessaoId) {
      return res.status(400).json({ sucesso: false, error: 'sessao_id é obrigatório.' });
    }
    const resultado = await importacao.importarSessao(db, sessaoId, {
      usuarioId: req.user?.id || null,
      usuarioNome: req.user?.nome || null,
      politica_pendentes: req.body?.politica_pendentes
    });
    const modoQtd = resultado.modo === 'ATUALIZAR_QUANTIDADES';
    return res.json({
      sucesso: true,
      mensagem: modoQtd ? 'QUANTIDADES REGISTRADAS' : 'IMPORTAÇÃO CONCLUÍDA',
      ...resultado
    });
  } catch (err) {
    console.error('[IMPORTACAO-INICIAL] importar:', err);
    return responderErro(res, err, 'Falha ao importar.');
  }
});

router.get('/status', (req, res) => {
  const sessaoId = req.query.sessao_id;
  if (!sessaoId) {
    return res.status(400).json({ sucesso: false, error: 'sessao_id é obrigatório.' });
  }
  const status = importacao.statusSessao(sessaoId);
  if (!status.encontrada) {
    return res.status(404).json({ sucesso: false, error: 'Sessão não encontrada.' });
  }
  return res.json({ sucesso: true, ...status });
});

module.exports = router;
