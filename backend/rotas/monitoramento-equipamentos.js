'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/monitoramentoEquipamentosController');

router.get('/dashboard', ctrl.dashboard);
router.get('/lista', ctrl.lista);
router.get('/status', ctrl.statusCatalogo);
router.get('/geral', ctrl.statusGeral);
router.get('/alertas/canais', ctrl.alertasCanais);

router.get('/:equipamentoId', ctrl.estado);
router.get('/:equipamentoId/eventos', ctrl.eventos);
router.get('/:equipamentoId/saude', ctrl.saude);

router.post('/iniciar', ctrl.iniciar);
router.post('/parar', ctrl.parar);
router.post('/:equipamentoId/verificar', ctrl.verificar);

module.exports = router;
