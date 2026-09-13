/**
 * Middleware central de autenticação e permissões — CDS Sistemas
 *
 * Implementação única de verificarToken (substitui duplicatas em server.js e rotas/auth.js).
 */

const jwt = require('jsonwebtoken');
const db = require('../database');
const { getJwtSecret } = require('../config/secrets');

const JWT_SECRET = getJwtSecret();

const PERMISSOES_DISPONIVEIS = [
  'pdv',
  'vendas',
  'produtos',
  'clientes',
  'compras',
  'fornecedores',
  'financeiro',
  'caixa',
  'abrir_caixa',
  'sangria_caixa',
  'suprimento_caixa',
  'fechar_caixa',
  'fiscal',
  'configuracoes',
  'usuarios',
  'relatorios',
  'auditoria',
  'categorias',
  'gerenciar_faixa_atacado',
  // Sprint 1 — Vendas para Entrega
  'entrega_visualizar',
  'entrega_criar',
  'entrega_prestacao',
  'entrega_cancelar',
  'entrega_reabrir',
  'entrega_alterar_pagamento',
  // RC4.1.0 — Arquitetura Comercial/Fiscal V4 (catálogo preparado para perfis)
  'expedicao_expedir',
  'nfe_emitir',
  'nfe_cancelar',
  'nfe_reenviar',
  'nfe_consultar',
  'nfe_exportar_xml',
  'nfe_reimprimir_danfe',
  'nfe_alterar_dados',
  'nfe_acoes_lote'
];

function extrairToken(req) {
  const authHeader = req.headers['authorization'];
  return authHeader && authHeader.split(' ')[1];
}

function isApiRequest(req) {
  return req.originalUrl.startsWith('/api');
}

/**
 * Verifica JWT e popula req.user.
 * Páginas HTML sem token redirecionam para /login; APIs retornam JSON.
 */
function verificarToken(req, res, next) {
  const token = extrairToken(req);
  const api = isApiRequest(req);

  if (!token) {
    if (!api && req.accepts('html')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ error: 'Acesso negado' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      if (!api && req.accepts('html')) {
        return res.redirect('/login');
      }
      return res.status(403).json({ error: 'Token inválido ou expirado' });
    }

    req.user = user;
    next();
  });
}

function buscarPermissoesUsuario(usuarioId, callback) {
  db.all(
    `SELECT permissao FROM usuario_permissoes WHERE usuario_id = ? AND permitido = 1`,
    [usuarioId],
    (err, rows) => {
      if (err) return callback(err);
      callback(null, (rows || []).map((r) => r.permissao));
    }
  );
}

function exigirAdmin(req, res, next) {
  verificarToken(req, res, () => {
    db.get(
      'SELECT id, username, role, COALESCE(perfil, \'USUARIO\') as perfil, pode_alterar_senhas FROM usuarios WHERE id = ?',
      [req.user?.id],
      (err, usuario) => {
        if (err || !usuario) {
          return res.status(403).json({ error: 'Erro ao verificar permissões.' });
        }

        req.user.perfil = usuario.perfil;
        req.user.pode_alterar_senhas = usuario.pode_alterar_senhas;

        const isAdmin =
          req.user?.role === 'admin' ||
          usuario.perfil === 'ADMIN' ||
          usuario.perfil === 'SUPER_ADMIN';

        if (!isAdmin) {
          return res.status(403).json({ error: 'Apenas administradores podem executar esta ação.' });
        }

        next();
      }
    );
  });
}

function exigirSuperAdmin(req, res, next) {
  const perfilLogado = String(req.user?.perfil || '').toUpperCase();
  if (perfilLogado !== 'SUPER_ADMIN') {
    return res.status(403).json({
      erro: 'Apenas SUPER_ADMIN pode gerenciar usuários.'
    });
  }
  next();
}

function verificarPermissaoEspecifica(nomeDaPermissao) {
  return (req, res, next) => {
    verificarToken(req, res, () => {
      const perfil = String(req.user?.perfil || '').trim().toUpperCase();
      if (
        req.user?.role === 'admin' ||
        req.user?.role === 'supervisor' ||
        ['SUPER_ADMIN', 'ADMIN'].includes(perfil)
      ) {
        return next();
      }

      buscarPermissoesUsuario(req.user?.id, (err, permissoes) => {
        if (err) {
          return res.status(500).json({ error: 'Erro ao verificar permissões' });
        }

        if (Array.isArray(permissoes) && permissoes.includes(nomeDaPermissao)) {
          return next();
        }

        return res.status(403).json({
          error: `Acesso restrito: permissão "${nomeDaPermissao}" necessária.`
        });
      });
    });
  };
}

function exigirDiagnosticoCentral(req, res, next) {
  verificarToken(req, res, () => {
    db.get(
      'SELECT id, username, role, COALESCE(perfil, \'USUARIO\') as perfil FROM usuarios WHERE id = ?',
      [req.user?.id],
      (err, usuario) => {
        if (err || !usuario) {
          return res.status(403).json({ error: 'Erro ao verificar permissões.' });
        }

        req.user.perfil = usuario.perfil;
        const perfil = String(usuario.perfil || '').toUpperCase();
        const permitido = req.user?.role === 'admin'
          || ['SUPER_ADMIN', 'ADMIN', 'SUPORTE'].includes(perfil);

        if (!permitido) {
          return res.status(403).json({
            error: 'Acesso restrito: apenas ADMIN, SUPER_ADMIN ou SUPORTE.'
          });
        }

        next();
      }
    );
  });
}

function exigirPerfilAjusteEstoque() {
  return (req, res, next) => {
    verificarToken(req, res, () => {
      const perfil = String(req.user?.perfil || '').trim().toUpperCase();
      if (req.user?.role === 'admin' || ['SUPER_ADMIN', 'ADMIN'].includes(perfil)) {
        return next();
      }
      return res.status(403).json({
        error: 'Acesso restrito: apenas SUPER_ADMIN ou ADMIN podem ajustar estoque.'
      });
    });
  };
}

module.exports = {
  JWT_SECRET,
  PERMISSOES_DISPONIVEIS,
  extrairToken,
  verificarToken,
  exigirAdmin,
  exigirSuperAdmin,
  verificarPermissaoEspecifica,
  exigirPerfilAjusteEstoque,
  exigirDiagnosticoCentral,
  buscarPermissoesUsuario
};
