'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/centralEquipamentosController');

router.get('/dashboard', ctrl.dashboard);
router.get('/lista', ctrl.lista);
router.get('/status', ctrl.statusCatalogo);
router.get('/sessoes', ctrl.sessoes);
router.get('/historico', ctrl.historico);
router.get('/saude', ctrl.saude);

router.post('/descobrir', ctrl.descobrir);
router.post('/cadastrar', ctrl.cadastrar);
router.post('/:equipamentoId/testar', ctrl.testar);
router.post('/:equipamentoId/diagnostico', ctrl.diagnostico);

module.exports = router;
