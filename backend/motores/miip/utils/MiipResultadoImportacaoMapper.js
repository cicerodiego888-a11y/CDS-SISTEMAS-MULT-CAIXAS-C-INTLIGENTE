/**
 * MiipResultadoImportacaoMapper — Mapeia decisão do Pipeline para importação XML.
 *
 * Sprint RC1: sem lógica de decisão — apenas traduz saída do DecisionEngine.
 * RC9.3: propaga candidatos MUBC + diagnóstico de busca vazia.
 *
 * @module motores/miip/utils/MiipResultadoImportacaoMapper
 */

const MiipAction = require('../core/MiipAction');
const MiipConfidence = require('../core/MiipConfidence');

const MOTORES_AUTO_VINCULO = Object.freeze([
  'motor_gtin',
  'motor_associacao_fornecedor'
]);

/**
 * @param {Object|null} melhor
 * @returns {string|null}
 */
function extrairMotor(melhor) {
  if (!melhor) return null;
  const motores = melhor.motoresQueVotaram || [];
  const permitido = motores.find((m) => MOTORES_AUTO_VINCULO.includes(m));
  return permitido || melhor.motorOrigem || motores[0] || null;
}

/**
 * @param {Object|null} melhor
 * @returns {Object|null}
 */
function montarProdutoEncontrado(melhor) {
  if (!melhor) return null;

  const produtoId = Number(melhor.produtoId ?? melhor.produto_id);
  if (!Number.isFinite(produtoId) || produtoId <= 0) return null;

  const produto = melhor.produto || melhor.snapshot || {};

  return {
    id: produtoId,
    nome: produto.nome || melhor.produtoNome || melhor.nome || '',
    codigo: produto.codigo || melhor.codigo || '',
    codigoBarras: produto.codigoBarras || produto.codigo_barras || melhor.codigoBarras || null,
    ncm: produto.ncm || null,
    cest: produto.cest || null,
    unidade: produto.unidade || null,
    marca: produto.marca || produto.marcaNome || null,
    fornecedor: produto.fornecedor || null,
    categoria_id: produto.categoria_id || null
  };
}

/**
 * @param {Object|null} resultado
 * @returns {Object[]}
 */
function extrairCandidatos(resultado) {
  const lista = Array.isArray(resultado?.candidatos) ? resultado.candidatos : [];
  return lista.slice(0, 20).map((c, i) => ({
    ranking: c.ranking || i + 1,
    produtoId: c.produtoId,
    score: Number(c.scoreTotal ?? c.score ?? 0),
    confianca: c.confianca || null,
    produto: c.produto || c.snapshot || null,
    evidencias: c.evidencias || [],
    motores: c.motoresQueVotaram || [],
    motivos: (c.atributosExtraidos?.motivosRelevancia || []).map((m) => m.rotulo || m.tipo)
  }));
}

/**
 * @param {Object|null} miipResp
 * @param {Object|null} resultado
 * @returns {Object}
 */
function mapearDecisaoPipelineParaImportacao(miipResp, resultado) {
  const decisao = resultado?.decisao ?? {};
  const melhor = decisao.melhorCandidato ?? resultado?.candidatos?.[0] ?? null;
  const produtoEncontrado = montarProdutoEncontrado(melhor);
  const acao = decisao.acao ?? MiipAction.CRIAR_NOVO;
  const candidatos = extrairCandidatos(resultado);
  const diagnosticoBusca = resultado?.meta?.mubcDiagnostico
    ?? resultado?.mubcDiagnostico
    ?? (candidatos.length === 0
      ? {
        motivos: [
          'GTIN inexistente no cadastro ou não informado.',
          'Associação fornecedor inexistente.',
          'Descrição sem correspondência.',
          'Nenhum produto compatível localizado.'
        ]
      }
      : null);

  const motivos = Array.isArray(decisao.motivos) && decisao.motivos.length > 0
    ? [...decisao.motivos]
    : (decisao.motivo ? [decisao.motivo] : []);

  const precisaConfirmacao = decisao.precisaConfirmacao !== undefined
    ? Boolean(decisao.precisaConfirmacao)
    : (acao === MiipAction.SUGERIR || acao === MiipAction.REVISAR_MANUAL);

  const precisaCadastro = decisao.precisaCadastro !== undefined
    ? Boolean(decisao.precisaCadastro)
    : (acao === MiipAction.CRIAR_NOVO);

  if (!melhor || !produtoEncontrado) {
    return {
      produtoEncontrado: null,
      nivelCerteza: MiipConfidence.NENHUMA,
      acao: MiipAction.CRIAR_NOVO,
      motivos: motivos.length > 0 ? motivos : ['nenhum_candidato_confiavel'],
      candidatoSelecionado: null,
      candidatos: [],
      diagnosticoBusca,
      precisaConfirmacao: false,
      precisaCadastro: true,
      associadoAutomaticamente: false,
      score: Number(decisao.score ?? resultado?.score?.valor ?? 0),
      motor: null
    };
  }

  return {
    produtoEncontrado,
    nivelCerteza: decisao.confianca ?? MiipConfidence.NENHUMA,
    acao,
    motivos,
    candidatoSelecionado: melhor,
    candidatos,
    diagnosticoBusca: null,
    precisaConfirmacao,
    precisaCadastro,
    associadoAutomaticamente: acao === MiipAction.AUTO_VINCULAR,
    score: Number(decisao.score ?? resultado?.score?.valor ?? melhor?.scoreTotal ?? 0),
    motor: extrairMotor(melhor)
  };
}

module.exports = {
  MOTORES_AUTO_VINCULO,
  extrairMotor,
  montarProdutoEncontrado,
  extrairCandidatos,
  mapearDecisaoPipelineParaImportacao
};
