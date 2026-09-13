'use strict';

/**
 * Permissões do CIA — valida perfil/permissões antes de qualquer tool.
 */

function normalizarPermissoes(permissoes) {
  if (typeof permissoes === 'string') {
    return permissoes.split(',').map((p) => String(p || '').trim()).filter(Boolean);
  }
  return Array.isArray(permissoes) ? permissoes : [];
}

/**
 * @param {object} userCtx
 * @param {string|null} permissaoNecessaria
 * @returns {{ ok: boolean, motivo?: string }}
 */
function autorizar(userCtx = {}, permissaoNecessaria) {
  const role = String(userCtx.role || '').toLowerCase();
  const perfil = String(userCtx.perfil || '').toUpperCase();

  if (role === 'admin' || perfil === 'SUPER_ADMIN' || perfil === 'ADMIN') {
    return { ok: true };
  }

  if (!permissaoNecessaria) return { ok: true };

  const perms = normalizarPermissoes(userCtx.permissoes);
  if (perms.includes(permissaoNecessaria) || perms.includes('*')) {
    return { ok: true };
  }

  return {
    ok: false,
    motivo: `Sem permissão "${permissaoNecessaria}" para esta ação.`
  };
}

/**
 * Valida plano completo.
 */
function autorizarPlano(userCtx, plano) {
  const authIntent = autorizar(userCtx, plano.permissao);
  if (!authIntent.ok) return authIntent;

  for (const step of plano.steps || []) {
    // permissão da tool será checada no orchestrator via tool.permissao
  }
  return { ok: true };
}

module.exports = { autorizar, autorizarPlano, normalizarPermissoes };
