'use strict';

/**
 * Autorização Enterprise Search — filial/perfil/permissões.
 */

function normalizarPermissoes(permissoes) {
  if (typeof permissoes === 'string') {
    return permissoes.split(',').map((p) => String(p || '').trim()).filter(Boolean);
  }
  return Array.isArray(permissoes) ? permissoes : [];
}

/**
 * @param {import('./providers/ISearchProvider')} provider
 * @param {object} ctx
 * @returns {{ ok: boolean, motivo?: string }}
 */
function autorizarProvider(provider, ctx = {}) {
  if (!provider) return { ok: false, motivo: 'provider_inexistente' };

  const role = String(ctx.role || ctx.user?.role || '').toLowerCase();
  const perfil = String(ctx.perfil || ctx.user?.perfil || '').toUpperCase();
  if (role === 'admin' || perfil === 'SUPER_ADMIN' || perfil === 'ADMIN') {
    return { ok: true };
  }

  if (typeof provider.autorizar === 'function' && !provider.autorizar(ctx)) {
    return { ok: false, motivo: 'provider_negou' };
  }

  const necessaria = provider.permissao;
  if (!necessaria) return { ok: true };

  const perms = normalizarPermissoes(ctx.permissoes || ctx.user?.permissoes);
  if (perms.includes(necessaria) || perms.includes('*')) {
    return { ok: true };
  }

  return { ok: false, motivo: `permissao_${necessaria}` };
}

module.exports = { autorizarProvider, normalizarPermissoes };
