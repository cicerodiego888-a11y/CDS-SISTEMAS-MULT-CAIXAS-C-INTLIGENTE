/**
 * CanonicalProduct — Representação canônica padronizada de uma descrição textual.
 *
 * Sprint 7.1: tokens tipados, estatísticas e formas normalizadas por token.
 *
 * @class CanonicalProduct
 */

const CanonicalToken = require('./CanonicalToken');
const CanonicalStatistics = require('./CanonicalStatistics');

const VERSAO_PADRAO = '1.1.0';

class CanonicalProduct {
  /**
   * @param {Object} [dados]
   * @param {string} dados.original - Texto recebido (imutável na origem)
   * @param {string} dados.normalizado - Após limpeza e padronização estrutural
   * @param {string} dados.canonico - Após expansão de abreviações
   * @param {string[]} [dados.tokens]
   * @param {CanonicalToken[]|Object[]} [dados.normalizedTokens]
   * @param {Object} [dados.atributos]
   * @param {CanonicalStatistics|Object} [dados.estatisticas]
   * @param {Object} [dados.metadata]
   */
  constructor(dados = {}) {
    this.original = dados.original ?? '';
    this.normalizado = dados.normalizado ?? '';
    this.canonico = dados.canonico ?? '';
    this.tokens = Array.isArray(dados.tokens) ? [...dados.tokens] : [];
    this.normalizedTokens = Array.isArray(dados.normalizedTokens)
      ? dados.normalizedTokens.map((token) => (
        token instanceof CanonicalToken ? token : CanonicalToken.create(token)
      ))
      : [];
    this.atributos = dados.atributos ?? {};
    this.estatisticas = dados.estatisticas instanceof CanonicalStatistics
      ? dados.estatisticas
      : CanonicalStatistics.create(dados.estatisticas ?? {});
    this.metadata = {
      versao: dados.metadata?.versao ?? VERSAO_PADRAO,
      ...(dados.metadata ?? {})
    };
  }

  /**
   * @param {Object} dados
   * @returns {CanonicalProduct}
   */
  static create(dados = {}) {
    return new CanonicalProduct(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      original: this.original,
      normalizado: this.normalizado,
      canonico: this.canonico,
      tokens: this.tokens,
      normalizedTokens: this.normalizedTokens.map((token) => token.toJSON()),
      atributos: this.atributos,
      estatisticas: this.estatisticas.toJSON(),
      metadata: this.metadata
    };
  }
}

CanonicalProduct.VERSAO_PADRAO = VERSAO_PADRAO;

module.exports = CanonicalProduct;
