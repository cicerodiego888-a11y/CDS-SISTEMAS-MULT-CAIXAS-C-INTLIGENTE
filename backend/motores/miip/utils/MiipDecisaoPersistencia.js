/**
 * MiipDecisaoPersistencia — Persistência oficial de decisões MIIP.
 *
 * Sprint RC1 — integração MiipDecisoesRepository ao Pipeline.
 *
 * @module motores/miip/utils/MiipDecisaoPersistencia
 */

const DecisionRulesLoader = require('./DecisionRulesLoader');

/**
 * @param {Object} params
 * @param {import('../repositories/MiipDecisoesRepository')} params.decisoesRepository
 * @param {import('../core/MiipRequest')|Object} params.request
 * @param {import('../core/MiipExecution')} params.execution
 * @param {Object} params.decisao
 * @param {import('../core/MiipResult')} params.resultado
 * @param {Object} [params.meta]
 * @returns {Promise<Object|null>}
 */
async function persistirDecisao(params) {
  const {
    decisoesRepository,
    request,
    execution,
    decisao,
    resultado,
    meta = {}
  } = params;

  if (!decisoesRepository || typeof decisoesRepository.inserir !== 'function') {
    return null;
  }

  const regras = DecisionRulesLoader.carregar();
  const melhor = decisao?.melhorCandidato ?? resultado?.candidatos?.[0] ?? null;
  const ranqueados = resultado?.candidatos ?? [];
  const segundo = ranqueados[1] ?? null;

  const dados = {
    operacaoId: execution.requestId ?? resultado?.requestId ?? null,
    origem: execution.context?.origem ?? 'indefinida',
    itemSnapshot: request.item?.toJSON?.() ?? request.item ?? null,
    contextoSnapshot: execution.context?.toJSON?.() ?? execution.context ?? null,
    candidatosSnapshot: ranqueados.map((c) => c?.toJSON?.() ?? c),
    motoresSnapshot: {
      executados: execution.enginesExecutados ?? [],
      semanticProduct: meta.semanticProduct?.toJSON?.() ?? meta.semanticProduct ?? null,
      similarityResult: meta.similarityResult?.toJSON?.() ?? meta.similarityResult ?? null
    },
    produtoSugeridoId: melhor ? Number(melhor.produtoId ?? melhor.produto_id) || null : null,
    produtoDecididoId: null,
    acaoRecomendada: decisao?.acao ?? null,
    confianca: decisao?.confianca ?? null,
    scoreFinal: Number(decisao?.score ?? resultado?.score?.valor ?? 0),
    scoreGap: segundo && melhor
      ? Number(melhor.scoreTotal ?? 0) - Number(segundo.scoreTotal ?? 0)
      : null,
    conflito: Boolean(decisao?.conflito),
    feedbackStatus: 'pendente',
    duracaoTotalMs: Number(resultado?.durationMs ?? execution.timeline?.duracaoTotalMs?.() ?? 0),
    metadados: {
      versaoRegra: regras.versao ?? '1.0.0',
      explicacao: decisao?.explicacao ?? decisao?.explicacaoMiip?.toJSON?.() ?? null,
      decisionResult: decisao?.decisionResult?.toJSON?.() ?? decisao?.decisionResult ?? null,
      requestId: execution.requestId,
      timestamp: new Date().toISOString()
    },
    decidedAt: new Date().toISOString()
  };

  try {
    return await decisoesRepository.inserir(dados);
  } catch {
    return null;
  }
}

module.exports = {
  persistirDecisao
};
