/**
 * SimilarityResult — Resultado da comparação entre dois SemanticProduct.
 *
 * Sprint 10 — Hybrid Similarity Engine v1.
 *
 * @class SimilarityResult
 */

const SimilarityVote = require('./SimilarityVote');
const SimilarityExplanation = require('./SimilarityExplanation');
const SimilarityStatistics = require('./SimilarityStatistics');

const VERSAO_PADRAO = '1.0.0';

class SimilarityResult {
  /**
   * @param {Object} [dados]
   * @param {number|null} [dados.score]
   * @param {string|null} [dados.confidence]
   * @param {string[]} [dados.matchedAttributes]
   * @param {string[]} [dados.differentAttributes]
   * @param {SimilarityVote[]|Object[]} [dados.votes]
   * @param {SimilarityExplanation|Object|string|null} [dados.explicacao]
   * @param {SimilarityStatistics|Object|null} [dados.estatisticas]
   */
  constructor(dados = {}) {
    this.score = dados.score ?? null;
    this.confidence = dados.confidence ?? null;
    this.matchedAttributes = Array.isArray(dados.matchedAttributes)
      ? [...dados.matchedAttributes]
      : [];
    this.differentAttributes = Array.isArray(dados.differentAttributes)
      ? [...dados.differentAttributes]
      : [];
    this.votes = Array.isArray(dados.votes)
      ? dados.votes.map((vote) => (vote instanceof SimilarityVote ? vote : SimilarityVote.create(vote)))
      : [];
    this.explicacao = dados.explicacao instanceof SimilarityExplanation
      ? dados.explicacao
      : (typeof dados.explicacao === 'string'
        ? SimilarityExplanation.create({ texto: dados.explicacao, linhas: dados.explicacao.split('\n').filter(Boolean) })
        : SimilarityExplanation.create(dados.explicacao ?? {}));
    this.estatisticas = dados.estatisticas instanceof SimilarityStatistics
      ? dados.estatisticas
      : SimilarityStatistics.create(dados.estatisticas ?? {});
  }

  /**
   * @param {Object} [dados]
   * @returns {SimilarityResult}
   */
  static create(dados = {}) {
    return new SimilarityResult(dados);
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      versao: VERSAO_PADRAO,
      score: this.score,
      confidence: this.confidence,
      matchedAttributes: this.matchedAttributes,
      differentAttributes: this.differentAttributes,
      votes: this.votes.map((vote) => vote.toJSON()),
      explicacao: this.explicacao.toJSON(),
      estatisticas: this.estatisticas.toJSON()
    };
  }
}

SimilarityResult.VERSAO_PADRAO = VERSAO_PADRAO;

module.exports = SimilarityResult;
