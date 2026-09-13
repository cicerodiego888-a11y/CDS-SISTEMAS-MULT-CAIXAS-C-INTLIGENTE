/**
 * MiipDecisionBuilder — Fachada de decisão do Pipeline MIIP.
 *
 * Sprint 13: delega exclusivamente ao DecisionEngine.
 * Engines produzem apenas candidatos — nunca decidem.
 *
 * @class MiipDecisionBuilder
 */

const MiipAction = require('./MiipAction');
const MiipConfidence = require('./MiipConfidence');
const DecisionEngine = require('./DecisionEngine');
const MiipExplainService = require('./MiipExplainService');
const { converterDecisionParaLegado } = require('../utils/MiipDecisionAdapter');

class MiipDecisionBuilder {
  /**
   * @param {Object} [deps]
   * @param {DecisionEngine} [deps.decisionEngine]
   * @param {MiipExplainService} [deps.explainService]
   */
  constructor(deps = {}) {
    this._decisionEngine = deps.decisionEngine ?? new DecisionEngine();
    this._explainService = deps.explainService ?? new MiipExplainService();
  }

  /**
   * @param {import('./MiipCandidateCollection')} colecao
   * @param {Object} [opcoes]
   * @param {string[]} [opcoes.enginesExecutados]
   * @param {Array<number|null>} [opcoes.produtosPorMotor]
   * @param {import('./MiipContext')|Object} [opcoes.contexto]
   * @param {import('./SimilarityResult')|Object|null} [opcoes.similarityResult]
   * @param {import('./SemanticProduct')|Object|null} [opcoes.semanticProduct]
   * @returns {Object}
   */
  build(colecao, opcoes = {}) {
    const ranqueados = colecao?.ranking?.() ?? [];
    const melhor = ranqueados[0] ?? null;

    const produtosPorMotor = Array.isArray(opcoes.produtosPorMotor)
      ? opcoes.produtosPorMotor.filter(Boolean)
      : [];

    const produtosDistintos = new Set(produtosPorMotor);
    if (produtosDistintos.size > 1) {
      const explicacao = this._explainService.explicar({
        acao: null,
        nivelCerteza: MiipConfidence.MEDIA,
        motivos: ['conflito_entre_motores'],
        score: melhor?.scoreTotal ?? 0,
        precisaConfirmacao: true
      });

      return {
        acao: MiipAction.REVISAR_MANUAL,
        confianca: MiipConfidence.MEDIA,
        melhorCandidato: melhor,
        conflito: true,
        regrasAplicadas: true,
        motivo: 'conflito_entre_motores',
        motivos: ['conflito_entre_motores'],
        explicacao: explicacao.toJSON(),
        explicacaoMiip: explicacao
      };
    }

    const decisionResult = this._decisionEngine.decidir(
      opcoes.similarityResult ?? null,
      colecao,
      opcoes.contexto ?? {}
    );

    const explicacaoMiip = this._explainService.explicar(
      decisionResult,
      opcoes.similarityResult ?? null,
      opcoes.semanticProduct ?? null
    );

    const legado = converterDecisionParaLegado(decisionResult, melhor);
    legado.explicacao = explicacaoMiip.toJSON();
    legado.explicacaoMiip = explicacaoMiip;

    return legado;
  }
}

module.exports = MiipDecisionBuilder;
