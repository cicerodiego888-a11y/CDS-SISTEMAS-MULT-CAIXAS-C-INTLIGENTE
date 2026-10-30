/**
 * CE-MUC-03 — API do catálogo de unidades de medida.
 * @module rotas/unidades-medida
 */

'use strict';

const express = require('express');
const db = require('../database');
const catalogo = require('../services/unidades/UnidadesMedidaCatalogoService');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const rows = await catalogo.listar(db, {
      incluirInativas: String(req.query.todos || '') === '1',
      termo: req.query.q || req.query.busca || ''
    });
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/opcoes', async (req, res) => {
  try {
    const rows = await catalogo.listarParaSelect(db, { tipo: req.query.tipo || null });
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await catalogo.obterPorId(db, req.params.id);
    if (!row) return res.status(404).json({ error: 'Unidade não encontrada' });
    return res.json(row);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const row = await catalogo.criar(db, req.body || {});
    return res.status(201).json(row);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message,
      codigo: error.code || null
    });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const row = await catalogo.atualizar(db, req.params.id, req.body || {});
    return res.json(row);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message,
      codigo: error.code || null
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const resultado = await catalogo.excluir(db, req.params.id);
    return res.json(resultado);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message,
      codigo: error.code || null,
      referencias: error.referencias || null
    });
  }
});

module.exports = router;
