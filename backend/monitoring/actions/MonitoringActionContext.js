/**
 * Contexto do Action Center — perfil, permissões, módulos.
 * Sem SQL. Sem escrita.
 */

function criarActionContext(input = {}) {
  const permissoes = Array.isArray(input.permissoes)
    ? input.permissoes
    : String(input.permissoes || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

  return {
    usuarioId: input.usuarioId || input.userId || null,
    perfil: String(input.perfil || 'USUARIO').toUpperCase(),
    role: input.role || 'operador',
    permissoes,
    modulosAtivos: input.modulosAtivos || {},
    licencaOk: input.licencaOk !== false,
    requestId: input.requestId || `act-${Date.now()}`
  };
}

module.exports = {
  criarActionContext
};
