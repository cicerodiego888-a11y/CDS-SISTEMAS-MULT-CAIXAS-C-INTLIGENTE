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

  const usuarioId = req.user?.id ?? req.user?.usuario_id;
  buscarPermissoesUsuario(usuarioId, (err, permissoes) => {
    if (err) return callback(err);
    const tem = Array.isArray(permissoes) && permissoes.includes(nomePermissao);
    callback(null, tem);
  });
}

function exigirPermissaoOuSenhaAdmin(nomePermissao, opcoes = {}) {
  return (req, res, next) => {
    verificarToken(req, res, () => {
      const concluir = ({ permitido, motivo, resposta }) => {
        const negar = () => res.status(403).json({
          error: 'Esta operação exige permissão específica ou senha de administrador.',
          requer_senha_admin: true
        });
        const finalizar = () => {
          if (resposta) {
            return res.status(resposta.status).json(resposta.body);
          }
          if (permitido) {
            return next();
          }
          return negar();
        };

        if (typeof opcoes.onDecision !== 'function') {
          return finalizar();
        }

        Promise.resolve()
          .then(() => opcoes.onDecision({ req, permitido, motivo }))
          .then(finalizar)
          .catch((auditErr) => {
            console.error('Erro ao registrar auditoria de autorização administrativa:', auditErr);
            if (!permitido && resposta) {
              return res.status(resposta.status).json(resposta.body);
            }
            if (!permitido) {
              return negar();
            }
            return res.status(500).json({
              error: 'Não foi possível registrar a tentativa de autorização.'
            });
          });
      };

      const usuarioId = req.user?.id ?? req.user?.usuario_id;
      if (usuarioId == null) {
        return concluir({
          permitido: false,
          motivo: 'IDENTIDADE_NAO_VALIDADA',
          resposta: {
            status: 403,
            body: { error: 'Identidade do usuário autenticado não identificada.' }
          }
        });
      }

      usuarioTemPermissao(req, nomePermissao, (err, temPermissao) => {
        if (err) {
          return concluir({
            permitido: false,
            motivo: 'ERRO_VERIFICACAO_PERMISSAO',
            resposta: {
              status: 500,
              body: { error: 'Erro ao verificar permissões.' }
            }
          });
        }

        if (temPermissao) {
          return concluir({
            permitido: true,
            motivo: 'PERMISSAO_ADMIN_VALIDADA'
          });
        }

        validarSenhaAdmin(req.body?.senha_admin, (senhaErr, senhaValida) => {
          if (senhaErr) {
            return concluir({
              permitido: false,
              motivo: 'ERRO_VALIDACAO_CREDENCIAL_ADMIN',
              resposta: {
                status: 500,
                body: { error: 'Erro ao validar credencial administrativa.' }
              }
            });
          }

          if (!senhaValida) {
            return concluir({
              permitido: false,
              motivo: req.body?.senha_admin
                ? 'CREDENCIAL_ADMIN_INVALIDA'
                : 'CREDENCIAL_ADMIN_AUSENTE'
            });
          }

          return concluir({
            permitido: true,
            motivo: 'CREDENCIAL_ADMIN_VALIDADA'
          });
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
