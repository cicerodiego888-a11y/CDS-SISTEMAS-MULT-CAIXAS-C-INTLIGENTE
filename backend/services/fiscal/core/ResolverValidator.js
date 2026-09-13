/**
 * Validação de parâmetros do UrlResolver.
 *
 * @module services/fiscal/core/ResolverValidator
 */

const { isModelType } = require('./ModelType');
const { isOperationType } = require('./OperationType');
const { isEnvironmentType } = require('./EnvironmentType');
const { ResolverException } = require('./ResolverException');
const { ResolverWarnings, createWarning } = require('./ResolverWarnings');

/** Versões de payload conhecidas na plataforma (F3). */
const SUPPORTED_VERSIONS = Object.freeze(['4.00', '1.01', '1.00']);

/**
 * Operações que exigem UF (todas no catálogo atual).
 * Reservado para relaxar regra no futuro (ex.: serviços nacionais sem UF).
 */
const OPERATIONS_REQUIRING_UF = null; // null = todas exigem UF

/**
 * @param {import('./ResolverContext').ResolverContext|object} context
 * @param {{ requireUf?: boolean, allowMissingVersion?: boolean }} [options]
 * @returns {{ valid: boolean, errors: string[], warnings: ReadonlyArray<object> }}
 */
function validateResolverContext(context, options = {}) {
  const errors = [];
  const warnings = [];
  const requireUf = options.requireUf !== false;
  const allowMissingVersion = options.allowMissingVersion !== false;

  if (!context || typeof context !== 'object') {
    errors.push('Contexto de resolução inválido.');
    return { valid: false, errors, warnings };
  }

  if (!context.modelo) {
    errors.push('modelo é obrigatório.');
  } else if (!isModelType(context.modelo)) {
    errors.push(`modelo inválido (${context.modelo}).`);
  }

  if (!context.operacao) {
    errors.push('operacao é obrigatória.');
  } else if (!isOperationType(context.operacao)) {
    errors.push(`operacao inválida (${context.operacao}).`);
  }

  if (!context.ambiente) {
    errors.push('ambiente é obrigatório.');
  } else if (!isEnvironmentType(context.ambiente)) {
    errors.push(`ambiente inválido (${context.ambiente}).`);
  }

  const needsUf = requireUf && (
    OPERATIONS_REQUIRING_UF === null
    || OPERATIONS_REQUIRING_UF.includes(context.operacao)
  );

  if (needsUf && !context.uf) {
    errors.push('uf é obrigatória para esta operação.');
    warnings.push(createWarning(ResolverWarnings.UF_NAO_INFORMADA));
  }

  if (!context.versao) {
    if (allowMissingVersion) {
      warnings.push(createWarning(ResolverWarnings.VERSAO_PADRAO_UTILIZADA));
    } else {
      errors.push('versao é obrigatória.');
    }
  } else if (!SUPPORTED_VERSIONS.includes(String(context.versao))) {
    errors.push(`versão não suportada (${context.versao}).`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Valida e lança ResolverException se inválido.
 * @param {import('./ResolverContext').ResolverContext|object} context
 * @param {object} [options]
 * @returns {{ warnings: ReadonlyArray<object> }}
 */
function assertValidResolverContext(context, options = {}) {
  const result = validateResolverContext(context, options);
  if (!result.valid) {
    throw ResolverException.validationError(
      `UrlResolver: ${result.errors.join(' ')}`,
      { errors: result.errors, warnings: result.warnings }
    );
  }
  return { warnings: result.warnings };
}

module.exports = {
  validateResolverContext,
  assertValidResolverContext,
  SUPPORTED_VERSIONS
};
