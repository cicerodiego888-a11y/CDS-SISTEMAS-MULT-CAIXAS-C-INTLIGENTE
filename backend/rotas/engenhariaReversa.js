const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/engenhariaReversaController');

router.post('/captura/iniciar', ctrl.iniciarCaptura);
router.post('/captura/parar', ctrl.pararCaptura);
router.get('/captura/status', ctrl.statusCaptura);
router.post('/captura/exportar', ctrl.exportarCaptura);
router.get('/capturas', ctrl.listarCapturas);
router.get('/capturas/:id', ctrl.abrirCaptura);
router.post('/captura/importar', ctrl.importarCaptura);
router.post('/analisar', ctrl.analisarFrame);
router.post('/observacao', ctrl.adicionarObservacao);
router.post('/documento/atualizar', ctrl.atualizarDocumento);
router.post('/comparar', ctrl.compararCapturas);
router.post('/wireshark', ctrl.gerarWireshark);

module.exports = router;
