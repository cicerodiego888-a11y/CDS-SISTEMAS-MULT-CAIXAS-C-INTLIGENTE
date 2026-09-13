'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/integracaoEquipamentosController');

router.get('/status', ctrl.status);
router.get('/equipamentos', ctrl.equipamentos);
router.get('/eventos', ctrl.eventos);
router.get('/auditoria', ctrl.auditoria);
router.get('/permissoes', ctrl.permissoesCatalogo);

router.post('/diagnostico/:equipamentoId', ctrl.diagnostico);
router.post('/sincronizacao', ctrl.sincronizacao);

router.post('/pdv/verificar', ctrl.pdvVerificar);
router.post('/pdv/:equipamentoId/reconectar', ctrl.pdvReconectar);

router.post('/fiscal/validar', ctrl.fiscalValidar);
router.post('/tef/descobrir', ctrl.tefDescobrir);

module.exports = router;
