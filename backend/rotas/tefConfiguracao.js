const express = require('express');
const router = express.Router();
const { verificarToken, exigirSuperAdmin } = require('../middleware/auth');
const tefConfiguracaoController = require('../controllers/tefConfiguracaoController');

router.get(
  '/configuracao',
  verificarToken,
  exigirSuperAdmin,
  tefConfiguracaoController.getConfiguracao
);

router.post(
  '/configuracao',
  verificarToken,
  exigirSuperAdmin,
  tefConfiguracaoController.postConfiguracao
);

router.put(
  '/configuracao',
  verificarToken,
  exigirSuperAdmin,
  tefConfiguracaoController.putConfiguracao
);

router.get(
  '/status',
  verificarToken,
  exigirSuperAdmin,
  tefConfiguracaoController.getStatus
);

router.post(
  '/testar',
  verificarToken,
  exigirSuperAdmin,
  tefConfiguracaoController.postTestar
);

module.exports = router;
