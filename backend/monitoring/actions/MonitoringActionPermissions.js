/**
 * Validação de permissões para Actions — somente filtro de exibição.
 */

const PAGE_PERMISSION = Object.freeze({
  'central-entradas': 'compras',
  'central-diagnostico': 'compras',
  compras: 'compras',
  produtos: 'produtos',
  financeiro: 'financeiro',
  caixa: 'caixa',
  caixas: 'caixa',
  fiscal: 'fiscal',
  vendas: 'vendas',
  configuracoes: 'configuracoes',
  'configuracoes-avancadas': 'configuracoes',
  equipamentos: 'configuracoes',
  monitoring: 'relatorios',
  dashboard: 'relatorios',
  auditoria: 'auditoria',
  clientes: 'clientes'
});

function temPermissao(context, permissionOrPage) {
  if (!permissionOrPage) return true;
  if (!context) return false;
  if (String(context.perfil || '').toUpperCase() === 'SUPER_ADMIN') return true;
  if (context.role === 'admin') return true;
  if (context.licencaOk === false) return false;

  const needed = PAGE_PERMISSION[permissionOrPage] || permissionOrPage;
  const perms = context.permissoes || [];
  if (!perms.length) return true; // sem lista → não bloqueia no Action Center
  return perms.includes(needed) || perms.includes('*');
}

function filtrarActionsPorPermissao(actions, context) {
  return (actions || []).filter((a) => {
    const key = a.permission || a.page;
    return temPermissao(context, key);
  });
}

module.exports = {
  PAGE_PERMISSION,
  temPermissao,
  filtrarActionsPorPermissao
};
