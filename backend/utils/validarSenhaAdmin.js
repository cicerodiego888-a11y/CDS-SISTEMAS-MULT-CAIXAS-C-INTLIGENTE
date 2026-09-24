'use strict';

const bcrypt = require('bcryptjs');
const db = require('../database');
const { buscarPermissoesUsuario } = require('../middleware/auth');
const {
  usuarioPodeAutorizarDivergencia
} = require('../services/caixa/FechamentoCaixaAutorizacao');

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

function autenticarAdministrador({ username, senha } = {}, callback) {
  const usuarioInformado = String(username || '').trim();
  const senhaInformada = String(senha || '');
  if (!usuarioInformado || !senhaInformada) {
    return callback(null, {
      ok: false,
      codigo: 'CREDENCIAIS_INVALIDAS',
      error: 'Usuário ou senha inválidos.'
    });
  }

  db.get(
    `SELECT * FROM usuarios
     WHERE COALESCE(ativo, 1) = 1
       AND (LOWER(username) = LOWER(?) OR LOWER(COALESCE(nome, '')) = LOWER(?))
     LIMIT 1`,
    [usuarioInformado, usuarioInformado],
    async (err, usuario) => {
      if (err) return callback(err);
      if (!usuario) {
        return callback(null, {
          ok: false,
          codigo: 'CREDENCIAIS_INVALIDAS',
          error: 'Usuário ou senha inválidos.'
        });
      }

      const senhaBanco =
        usuario.password_hash ||
        usuario.senha_hash ||
        usuario.senha ||
        usuario.password;
      if (!senhaBanco) {
        return callback(null, {
          ok: false,
          codigo: 'CREDENCIAIS_INVALIDAS',
          error: 'Usuário ou senha inválidos.'
        });
      }

      const senhaOk = await bcrypt.compare(senhaInformada, senhaBanco).catch(() => false);
      if (!senhaOk && senhaInformada !== senhaBanco) {
        return callback(null, {
          ok: false,
          codigo: 'CREDENCIAIS_INVALIDAS',
          error: 'Usuário ou senha inválidos.'
        });
      }

      buscarPermissoesUsuario(usuario.id, (permErr, permissoes) => {
        if (permErr) return callback(permErr);
        if (!usuarioPodeAutorizarDivergencia(usuario, permissoes)) {
          return callback(null, {
            ok: false,
            codigo: 'SEM_PERMISSAO_DIVERGENCIA',
            error: 'Este usuário não possui permissão para autorizar fechamento com divergência.'
          });
        }
        return callback(null, {
          ok: true,
          usuario: {
            id: usuario.id,
            username: usuario.username,
            nome: usuario.nome || usuario.username,
            perfil: usuario.perfil || 'USUARIO',
            role: usuario.role
          }
        });
      });
    }
  );
}

module.exports = {
  isAdminUsuario,
  validarSenhaAdmin,
  autenticarAdministrador
};
