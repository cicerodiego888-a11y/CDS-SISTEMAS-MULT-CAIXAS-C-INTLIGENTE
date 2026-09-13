'use strict';

const { verificarToken, buscarPermissoesUsuario } = require('./auth');
const { validarSenhaAdmin } = require('../utils/validarSenhaAdmin');

function usuarioBypassPermissao(req) {
  const perfil = String(req.user?.perfil || '').trim().toUpperCase();
  return (
    req.user?.role === 'admin' ||
    req.user?.role === 'supervisor' ||
    ['SUPER_ADMIN', 'ADMIN'].includes(perfil)
  );
}

function usuarioTemPermissao(req, nomePermissao, callback) {
  if (usuarioBypassPermissao(req)) {
    return callback(null, true);
  }

  buscarPermissoesUsuario(req.user?.id, (err, permissoes) => {
    if (err) return callback(err);
    const tem = Array.isArray(permissoes) && permissoes.includes(nomePermissao);
    callback(null, tem);
  });
}

function exigirPermissaoOuSenhaAdmin(nomePermissao) {
  return (req, res, next) => {
    verificarToken(req, res, () => {
      usuarioTemPermissao(req, nomePermissao, (err, temPermissao) => {
        if (err) {
          return res.status(500).json({ error: 'Erro ao verificar permissões.' });
        }

        if (temPermissao) {
          return next();
        }

        validarSenhaAdmin(req.body?.senha_admin, (senhaErr, senhaValida) => {
          if (senhaErr) {
            return res.status(500).json({ error: senhaErr.message });
          }

          if (!senhaValida) {
            return res.status(403).json({
              error: 'Esta operação exige permissão específica ou senha de administrador.',
              requer_senha_admin: true
            });
          }

          next();
        });
      });
    });
  };
}

module.exports = {
  exigirPermissaoOuSenhaAdmin,
  usuarioTemPermissao,
  usuarioBypassPermissao
};
