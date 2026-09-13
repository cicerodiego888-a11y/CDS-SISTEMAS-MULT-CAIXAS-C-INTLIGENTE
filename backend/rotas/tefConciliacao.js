const express = require('express');
const router = express.Router();
const { verificarToken, exigirSuperAdmin } = require('../middleware/auth');
const tefConciliacaoController = require('../controllers/tefConciliacaoController');

router.get(
  '/conciliacoes',
  verificarToken,
  exigirSuperAdmin,
  tefConciliacaoController.listarConciliacoes
);

router.post(
  '/conciliacoes',
  verificarToken,
  exigirSuperAdmin,
  tefConciliacaoController.criarConciliacao
);

router.post(
  '/fechamentos',
  verificarToken,
  exigirSuperAdmin,
  tefConciliacaoController.criarFechamento
);

router.get(
  '/fechamentos',
  verificarToken,
  exigirSuperAdmin,
  tefConciliacaoController.listarFechamentos
);

router.get(
  '/conciliacao/resumo',
  verificarToken,
  exigirSuperAdmin,
  tefConciliacaoController.obterResumo
);

module.exports = router;
