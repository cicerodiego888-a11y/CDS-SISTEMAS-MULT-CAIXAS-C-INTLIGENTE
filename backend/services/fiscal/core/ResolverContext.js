/**
 * Contexto imutável de resolução de Web Service.
 *
 * @module services/fiscal/core/ResolverContext
 */

const { ResolverException } = require('./ResolverException');

/**
 * @param {object} input
 * @returns {Readonly<object>}
 */
function createResolverContext(input) {
  if (!input || typeof input !== 'object') {
    throw ResolverException.invalidContext('ResolverContext: input inválido.');
  }

  const modelo = input.modelo || null;
  const operacao = input.operacao || null;
  const ambiente = input.ambiente || null;
  const uf = input.uf != null && String(input.uf).trim() !== ''
    ? String(input.uf).toUpperCase()
    : null;
  const versao = input.versao != null && String(input.versao).trim() !== ''
    ? String(input.versao).trim()
    : null;
  const metadata = Object.freeze({
    ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {})
  });
  const override = input.override === undefined ? null : input.override;

  return Object.freeze({
    modelo,
    operacao,
    ambiente,
    uf,
    versao,
    metadata,
    override
  });
}

class ResolverContext {
  /**
   * @param {object} input
   */
  constructor(input) {
    const ctx = createResolverContext(input);
    Object.assign(this, ctx);
    Object.freeze(this);
  }

  /**
   * @param {object} input
   * @returns {ResolverContext}
   */
  static create(input) {
    return new ResolverContext(input);
  }

  /**
   * Critérios canônicos para o registry (sem override/metadata).
   * @returns {{ modelo: string|null, operacao: string|null, ambiente: string|null, uf: string|null }}
   */
  toRegistryCriteria() {
    return {
      modelo: this.modelo,
      operacao: this.operacao,
      ambiente: this.ambiente,
      uf: this.uf
    };
  }
}

module.exports = {
  ResolverContext,
  createResolverContext
};
