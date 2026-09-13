/**
 * Resultado imutável de uma resolução de Web Service.
 * Nunca é uma string — sempre um objeto tipado.
 *
 * @module services/fiscal/core/ResolutionResult
 */

const { isResolutionSource, ResolutionSource } = require('./ResolutionSource');

/**
 * @param {object} input
 * @returns {Readonly<object>}
 */
function createResolutionResult(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('ResolutionResult: payload inválido.');
  }

  const success = Boolean(input.success);
  const source = input.source || null;

  if (source != null && !isResolutionSource(source)) {
    throw new Error(`ResolutionResult: source inválido (${source}).`);
  }

  const warnings = Object.freeze(
    Array.isArray(input.warnings)
      ? input.warnings.map((w) => Object.freeze({ ...w }))
      : []
  );

  const resolvedAt = input.resolvedAt instanceof Date
    ? input.resolvedAt
    : new Date(input.resolvedAt || Date.now());

  const executionTime = Number(input.executionTime);
  if (!Number.isFinite(executionTime) || executionTime < 0) {
    throw new Error('ResolutionResult: executionTime inválido.');
  }

  return Object.freeze({
    success,
    definition: input.definition == null ? null : Object.freeze({ ...input.definition }),
    source,
    warnings,
    resolvedAt,
    executionTime,
    error: input.error ? String(input.error) : null,
    context: input.context == null ? null : Object.freeze({ ...input.context })
  });
}

class ResolutionResult {
  /**
   * @param {object} input
   */
  constructor(input) {
    const result = createResolutionResult(input);
    Object.assign(this, result);
    Object.freeze(this);
  }

  /**
   * @param {object} input
   * @returns {ResolutionResult}
   */
  static create(input) {
    return new ResolutionResult(input);
  }

  /**
   * @param {object} params
   * @returns {ResolutionResult}
   */
  static success(params) {
    return ResolutionResult.create({
      success: true,
      source: params.source || ResolutionSource.REGISTRY,
      definition: params.definition,
      warnings: params.warnings || [],
      resolvedAt: params.resolvedAt || new Date(),
      executionTime: params.executionTime,
      context: params.context || null,
      error: null
    });
  }

  /**
   * @param {object} params
   * @returns {ResolutionResult}
   */
  static failure(params) {
    return ResolutionResult.create({
      success: false,
      source: params.source || null,
      definition: null,
      warnings: params.warnings || [],
      resolvedAt: params.resolvedAt || new Date(),
      executionTime: params.executionTime,
      context: params.context || null,
      error: params.error || 'Resolução não encontrada.'
    });
  }

  /**
   * Atalho seguro para o endpoint (nunca substitui o objeto ResolutionResult).
   * @returns {string|null}
   */
  getEndpoint() {
    return this.definition && this.definition.endpoint
      ? this.definition.endpoint
      : null;
  }
}

module.exports = {
  ResolutionResult,
  createResolutionResult
};
