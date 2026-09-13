'use strict';

const bcrypt = require('bcryptjs');
const db = require('../database');

function isAdminUsuario(usuario) {
  const perfil = String(usuario?.perfil || '').trim().toUpperCase();
  return usuario?.role === 'admin' || ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'].includes(perfil);
}

function validarSenhaAdmin(senhaAdmin, callback) {
  if (!senhaAdmin) {
    return callback(null, false);
  }

  db.all('SELECT * FROM usuarios WHERE COALESCE(ativo, 1) = 1', [], async (err, usuarios) => {
    if (err) return callback(err);

    if (!usuarios || usuarios.length === 0) {
      return callback(null, false);
    }

    for (const usuario of usuarios) {
      if (!isAdminUsuario(usuario)) continue;

      const senhaBanco =
        usuario.password_hash ||
        usuario.senha_hash ||
        usuario.senha ||
        usuario.password;

      if (!senhaBanco) continue;

      const senhaOk = await bcrypt.compare(senhaAdmin, senhaBanco).catch(() => false);

      if (senhaOk || senhaAdmin === senhaBanco) {
        return callback(null, true);
      }
    }

    return callback(null, false);
  });
}

module.exports = {
  isAdminUsuario,
  validarSenhaAdmin
};
