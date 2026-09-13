/**
 * Códigos de aviso padronizados do UrlResolver.
 *
 * @module services/fiscal/core/ResolverWarnings
 */

const ResolverWarnings = Object.freeze({
  UF_NAO_INFORMADA: 'UF_NAO_INFORMADA',
  VERSAO_PADRAO_UTILIZADA: 'VERSAO_PADRAO_UTILIZADA',
  OVERRIDE_NAO_ENCONTRADO: 'OVERRIDE_NAO_ENCONTRADO',
  SERVICO_DESATIVADO: 'SERVICO_DESATIVADO',
  REGISTRY_VAZIO: 'REGISTRY_VAZIO',
  VERSAO_DIVERGENTE: 'VERSAO_DIVERGENTE',
  CACHE_INDISPONIVEL: 'CACHE_INDISPONIVEL',
  FALLBACK_INDISPONIVEL: 'FALLBACK_INDISPONIVEL'
});

/**
 * @param {string} code
 * @param {string} [message]
 * @returns {Readonly<{ code: string, message: string }>}
 */
function createWarning(code, message = '') {
  if (!Object.prototype.hasOwnProperty.call(ResolverWarnings, code)) {
    throw new Error(`ResolverWarnings: código desconhecido (${code}).`);
  }
  return Object.freeze({
    code,
    message: message || defaultMessage(code)
  });
}

/**
 * @param {string} code
 * @returns {string}
 */
function defaultMessage(code) {
  switch (code) {
    case ResolverWarnings.UF_NAO_INFORMADA:
      return 'UF não informada no contexto de resolução.';
    case ResolverWarnings.VERSAO_PADRAO_UTILIZADA:
      return 'Versão não informada; utilizada a versão do contrato do registry.';
    case ResolverWarnings.OVERRIDE_NAO_ENCONTRADO:
      return 'Override solicitado, mas não encontrado ou inválido.';
    case ResolverWarnings.SERVICO_DESATIVADO:
      return 'Serviço encontrado no catálogo está marcado como inativo.';
    case ResolverWarnings.REGISTRY_VAZIO:
      return 'WebServiceRegistry está vazio.';
    case ResolverWarnings.VERSAO_DIVERGENTE:
      return 'Versão solicitada difere da versão do contrato oficial.';
    case ResolverWarnings.CACHE_INDISPONIVEL:
      return 'Cache de resolução ainda não implementado.';
    case ResolverWarnings.FALLBACK_INDISPONIVEL:
      return 'Fallback de resolução ainda não implementado.';
    default:
      return code;
  }
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isResolverWarning(value) {
  return Object.prototype.hasOwnProperty.call(ResolverWarnings, value);
}

/**
 * @returns {string[]}
 */
function listResolverWarnings() {
  return Object.values(ResolverWarnings);
}

module.exports = {
  ResolverWarnings,
  createWarning,
  isResolverWarning,
  listResolverWarnings
};
