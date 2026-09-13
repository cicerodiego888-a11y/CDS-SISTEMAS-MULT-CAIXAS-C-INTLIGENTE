const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/laboratorioEquipamentosController');

router.get('/drivers', ctrl.listarDrivers);
router.get('/equipamentos', ctrl.listarEquipamentos);
router.get('/capturas', ctrl.listarCapturas);
router.get('/capturas/:capturaId', ctrl.abrirCaptura);
router.post('/frame', ctrl.montarFrame);
router.post('/util/converter', ctrl.utilitarios);
router.post('/comparar/capturas', ctrl.compararCapturas);
router.post('/comparar/hex', ctrl.compararHex);
router.post('/captura/iniciar', ctrl.iniciarCaptura);
router.post('/captura/parar', ctrl.pararCaptura);
router.post('/captura/salvar', ctrl.salvarCaptura);

router.get('/:id/pacotes', ctrl.listarPacotes);
router.delete('/:id/pacotes', ctrl.limparPacotes);
router.post('/:id/conectar', ctrl.conectar);
router.post('/:id/desconectar', ctrl.desconectar);
router.post('/:id/ping', ctrl.ping);
router.get('/:id/status', ctrl.status);
router.get('/:id/diagnostico', ctrl.diagnostico);
router.post('/:id/enviar/hex', ctrl.enviarHex);
router.post('/:id/enviar/ascii', ctrl.enviarAscii);
router.post('/:id/captura/iniciar', ctrl.iniciarCaptura);
router.post('/:id/replay', ctrl.replay);

module.exports = router;
