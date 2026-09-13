'use strict';

const { validarSenhaAdmin } = require('../utils/validarSenhaAdmin');

function exigirSenhaAdmin(req, res, next) {
  const senhaAdmin = req.body?.senha_admin;

  validarSenhaAdmin(senhaAdmin, (err, valida) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!valida) {
      return res.status(403).json({
        error: 'Senha de administrador inválida ou não informada.'
      });
    }

    next();
  });
}

module.exports = { exigirSenhaAdmin };
