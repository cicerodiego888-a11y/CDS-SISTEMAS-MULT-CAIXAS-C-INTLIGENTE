/**
 * MiipDecisionAdapter — Ponte entre DecisionEngine e formato legado do Pipeline.
 *
 * Sprint 13 — Calibração final.
 *
 * @module motores/miip/utils/MiipDecisionAdapter
 */

const MiipAction = require('../core/MiipAction');
const DecisionAction = require('../core/DecisionAction');

const MAPEAMENTO_ACAO = Object.freeze({
  [DecisionAction.AUTO_ASSOCIAR]: MiipAction.AUTO_VINCULAR,
  [DecisionAction.SUGERIR_CONFIRMACAO]: MiipAction.SUGERIR,
  [DecisionAction.MOSTRAR_SUGESTOES]: MiipAction.SUGERIR,
  [DecisionAction.CADASTRAR_NOVO]: MiipAction.CRIAR_NOVO
});

/**
 * @param {import('../core/DecisionResult')} decisionResult
 * @param {import('../core/MiipCandidate')|Object|null} melhorCandidato
 * @returns {Object}
 */
function converterDecisionParaLegado(decisionResult, melhorCandidato = null) {
  const acao = MAPEAMENTO_ACAO[decisionResult.acao] ?? MiipAction.CRIAR_NOVO;

  return {
    acao,
    confianca: decisionResult.nivelCerteza,
    melhorCandidato: melhorCandidato ?? decisionResult.produtoSelecionado ?? null,
    conflito: false,
    regrasAplicadas: true,
    motivo: decisionResult.motivos[0] ?? decisionResult.estatisticas?.regraVencedora ?? null,
    motivos: [...decisionResult.motivos],
    decisionResult,
    precisaConfirmacao: decisionResult.precisaConfirmacao,
    precisaCadastro: decisionResult.precisaCadastro,
    score: decisionResult.score
  };
}

module.exports = {
  MAPEAMENTO_ACAO,
  converterDecisionParaLegado
};
