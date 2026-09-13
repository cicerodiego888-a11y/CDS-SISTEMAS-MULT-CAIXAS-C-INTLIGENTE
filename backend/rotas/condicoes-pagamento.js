/**
 * RC8.5.1 — API Condições de Pagamento
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');
const {
  garantirTabelaCondicoesPagamento,
  listarCondicoes,
  obterCondicao,
  salvarCondicao,
  excluirCondicao
} = require('../services/compras/CondicoesPagamentoService');

function ensureReady(req, res, next) {
  garantirTabelaCondicoesPagamento(db, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    next();
  });
}

router.use(ensureReady);

router.get('/', async (req, res) => {
  try {
    const todas = String(req.query.todas || '') === '1';
    const lista = await listarCondicoes(db, { apenasAtivas: !todas });
    res.json(lista);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await obterCondicao(db, req.params.id);
    if (!row) return res.status(404).json({ error: 'Condição não encontrada.' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const row = await salvarCondicao(db, req.body || {});
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const row = await salvarCondicao(db, { ...(req.body || {}), id: req.params.id });
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await excluirCondicao(db, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
