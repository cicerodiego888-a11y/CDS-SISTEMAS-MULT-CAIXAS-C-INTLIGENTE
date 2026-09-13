/**
 * Hotfix RC1.3 — API da Plataforma (status bar, etc.)
 */
'use strict';

const express = require('express');
const router = express.Router();
const plataformaStatus = require('../services/plataformaStatusService');

router.get('/status', async (req, res) => {
  try {
    const status = await plataformaStatus.obterBarraStatusPlataforma();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao obter status da plataforma.' });
  }
});

module.exports = router;
