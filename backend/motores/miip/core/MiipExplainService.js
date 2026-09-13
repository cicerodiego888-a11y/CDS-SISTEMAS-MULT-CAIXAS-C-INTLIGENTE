/**
 * MiipExplainService — Camada oficial de explicabilidade do MIIP.
 *
 * Sprint 12 — Fase 2 Inteligência.
 *
 * Toda decisão do MIIP deve ser explicável.
 * NÃO altera Decision Engine, Similarity, Pipeline, ERP ou XML.
 *
 * @class MiipExplainService
 * @module motores/miip/core/MiipExplainService
 */

const DecisionResult = require('./DecisionResult');
const DecisionAction = require('./DecisionAction');
const SimilarityResult = require('./SimilarityResult');
const SemanticProduct = require('./SemanticProduct');
const MiipExplanation = require('./MiipExplanation');
const ExplainReport = require('./ExplainReport');
const ExplainFormatter = require('../utils/ExplainFormatter');

const ROTULOS_ATRIBUTO = Object.freeze({
  marca: 'Marca',
  tipo: 'Tipo',
  tecnologia: 'Tecnologia',
  potencia: 'Potência',
  modelo: 'Modelo',
  unidadeMedida: 'Unidade',
  embalagem: 'Embalagem',
  quantidadeEmbalagem: 'Quantidade',
  material: 'Material',
  cor: 'Cor',
  gtin: 'Código de barras'
});

const MOTIVOS_DECISAO_POSITIVOS = Object.freeze({
  gtin_exato_100: 'Código de barras igual',
  fornecedor_aprendido_100: 'Histórico positivo',
  score_alto_gap_suficiente: 'Alta similaridade com diferença clara'
});

const MOTIVOS_DECISAO_NEGATIVOS = Object.freeze({
  score_alto_gap_insuficiente: 'Candidatos muito próximos em score',
  score_abaixo_80: 'Similaridade abaixo do mínimo',
  nenhum_candidato_confiavel: 'Nenhum candidato confiável encontrado',
  score_medio_sugestoes: 'Similaridade moderada — revisão necessária'
});

const TITULOS_ACAO = Object.freeze({
  [DecisionAction.AUTO_ASSOCIAR]: 'Produto identificado automaticamente.',
  [DecisionAction.SUGERIR_CONFIRMACAO]: 'Produto precisa confirmação.',
  [DecisionAction.MOSTRAR_SUGESTOES]: 'Sugestões encontradas.',
  [DecisionAction.CADASTRAR_NOVO]: 'Cadastro de novo produto recomendado.'
});

const RECOMENDACOES_ACAO = Object.freeze({
  [DecisionAction.AUTO_ASSOCIAR]: 'Produto será associado automaticamente.',
  [DecisionAction.SUGERIR_CONFIRMACAO]: 'Confirme antes de prosseguir.',
  [DecisionAction.MOSTRAR_SUGESTOES]: 'Revise as sugestões antes de decidir.',
  [DecisionAction.CADASTRAR_NOVO]: 'Cadastre um novo produto no sistema.'
});

const RESUMOS_ACAO = Object.freeze({
  [DecisionAction.AUTO_ASSOCIAR]: 'Identificação automática com alta confiança.',
  [DecisionAction.SUGERIR_CONFIRMACAO]: 'Identificação provável — confirmação recomendada.',
  [DecisionAction.MOSTRAR_SUGESTOES]: 'Há sugestões compatíveis que merecem revisão.',
  [DecisionAction.CADASTRAR_NOVO]: 'Não há correspondência confiável na base.'
});

class MiipExplainService {
  /**
   * @private
   * @param {DecisionResult|Object|null} decisionResult
   * @returns {DecisionResult|null}
   */
  _resolverDecision(decisionResult) {
    if (!decisionResult) return null;
    if (decisionResult instanceof DecisionResult) return decisionResult;
    return DecisionResult.create(decisionResult);
  }

  /**
   * @private
   * @param {SimilarityResult|Object|null} similarityResult
   * @returns {SimilarityResult|null}
   */
  _resolverSimilarity(similarityResult) {
    if (!similarityResult) return null;
    if (similarityResult instanceof SimilarityResult) return similarityResult;
    return SimilarityResult.create(similarityResult);
  }

  /**
   * @private
   * @param {SemanticProduct|Object|null} semanticProduct
   * @returns {SemanticProduct|null}
   */
  _resolverSemantic(semanticProduct) {
    if (!semanticProduct) return null;
    if (semanticProduct instanceof SemanticProduct) return semanticProduct;
    return SemanticProduct.create(semanticProduct);
  }

  /**
   * @private
   * @param {string} atributo
   * @returns {string}
   */
  _rotuloAtributo(atributo) {
    return ROTULOS_ATRIBUTO[atributo] ?? atributo;
  }

  /**
   * @private
   * @param {string} atributo
   * @param {boolean} coincidente
   * @returns {string}
   */
  _motivoAtributo(atributo, coincidente) {
    const rotulo = this._rotuloAtributo(atributo);
    return coincidente ? `${rotulo} igual` : `${rotulo} diferente`;
  }

  /**
   * @private
   * @param {DecisionResult|null} decision
   * @param {SimilarityResult|null} similarity
   * @param {SemanticProduct|null} semantic
   * @returns {{ positivos: string[], negativos: string[], coincidentes: string[], divergentes: string[] }}
   */
  _extrairMotivos(decision, similarity, semantic) {
    const positivos = [];
    const negativos = [];
    const coincidentes = [];
    const divergentes = [];
    const vistos = new Set();

    const adicionar = (lista, valor) => {
      if (!valor || vistos.has(valor)) return;
      vistos.add(valor);
      lista.push(valor);
    };

    if (decision) {
      (decision.motivos ?? []).forEach((motivo) => {
        if (MOTIVOS_DECISAO_POSITIVOS[motivo]) {
          adicionar(positivos, MOTIVOS_DECISAO_POSITIVOS[motivo]);
        }
        if (MOTIVOS_DECISAO_NEGATIVOS[motivo]) {
          adicionar(negativos, MOTIVOS_DECISAO_NEGATIVOS[motivo]);
        }
      });

      (decision.explicacao?.baseadoEm ?? []).forEach((item) => {
        const limpo = item.replace(/\.$/, '').trim();
        if (limpo) adicionar(positivos, `${limpo} confirmado`);
      });
    }

    if (similarity) {
      (similarity.matchedAttributes ?? []).forEach((attr) => {
        adicionar(coincidentes, attr);
        adicionar(positivos, this._motivoAtributo(attr, true));
      });

      (similarity.differentAttributes ?? []).forEach((attr) => {
        adicionar(divergentes, attr);
        adicionar(negativos, this._motivoAtributo(attr, false));
      });

      (similarity.votes ?? []).forEach((vote) => {
        if (vote.score === 100 && vote.atributo) {
          adicionar(positivos, this._motivoAtributo(vote.atributo, true));
        } else if (vote.score === 0 && vote.atributo) {
          adicionar(negativos, this._motivoAtributo(vote.atributo, false));
        }
      });
    }

    if (semantic?.gtin && decision?.motivos?.includes('gtin_exato_100')) {
      adicionar(positivos, 'Código de barras igual');
    }

    if (positivos.length === 0 && decision?.score > 0) {
      adicionar(positivos, `Score de ${decision.score}%`);
    }

    if (negativos.length === 0 && decision?.precisaCadastro) {
      adicionar(negativos, MOTIVOS_DECISAO_NEGATIVOS.nenhum_candidato_confiavel);
    }

    return { positivos, negativos, coincidentes, divergentes };
  }

  /**
   * @private
   * @param {MiipExplanation} explicacao
   * @returns {string}
   */
  _montarExplicacaoCompleta(explicacao) {
    return ExplainFormatter.formatarUsuario(explicacao);
  }

  /**
   * @private
   * @param {MiipExplanation} explicacao
   * @returns {string}
   */
  _montarExplicacaoCurta(explicacao) {
    const partes = [explicacao.titulo];
    if (explicacao.resumo) partes.push(explicacao.resumo);
    return partes.join(' ').trim();
  }

  /**
   * Gera explicação oficial a partir dos resultados do MIIP.
   *
   * @param {DecisionResult|Object|null} decisionResult
   * @param {SimilarityResult|Object|null} [similarityResult]
   * @param {SemanticProduct|Object|null} [semanticProduct]
   * @returns {MiipExplanation}
   */
  explicar(decisionResult, similarityResult = null, semanticProduct = null) {
    const decision = this._resolverDecision(decisionResult);
    const similarity = this._resolverSimilarity(similarityResult);
    const semantic = this._resolverSemantic(semanticProduct);

    if (!decision) {
      return MiipExplanation.create({
        titulo: 'Decisão indisponível.',
        resumo: 'Não foi possível gerar explicação sem resultado de decisão.',
        nivelCerteza: 'NENHUMA',
        recomendacao: 'Reexecute a identificação.',
        explicacaoCurta: 'Decisão indisponível.',
        explicacaoCompleta: 'Decisão indisponível.\n\nRecomendação:\nReexecute a identificação.'
      });
    }

    const acao = decision.acao ?? DecisionAction.CADASTRAR_NOVO;
    const { positivos, negativos, coincidentes, divergentes } = this._extrairMotivos(
      decision,
      similarity,
      semantic
    );

    const explicacao = MiipExplanation.create({
      titulo: TITULOS_ACAO[acao] ?? 'Decisão processada.',
      resumo: RESUMOS_ACAO[acao] ?? '',
      nivelCerteza: decision.nivelCerteza ?? 'NENHUMA',
      motivosPositivos: positivos,
      motivosNegativos: negativos,
      atributosCoincidentes: coincidentes,
      atributosDivergentes: divergentes,
      recomendacao: RECOMENDACOES_ACAO[acao] ?? ''
    });

    explicacao.explicacaoCompleta = this._montarExplicacaoCompleta(explicacao);
    explicacao.explicacaoCurta = this._montarExplicacaoCurta(explicacao);

    return explicacao;
  }

  /**
   * Gera relatório formatado para a Central MIIP.
   *
   * @param {DecisionResult|Object|null} decisionResult
   * @param {SimilarityResult|Object|null} [similarityResult]
   * @param {SemanticProduct|Object|null} [semanticProduct]
   * @param {string} [modo]
   * @returns {ExplainReport}
   */
  gerarRelatorio(decisionResult, similarityResult = null, semanticProduct = null, modo = 'usuario') {
    const decision = this._resolverDecision(decisionResult);
    const explicacao = this.explicar(decisionResult, similarityResult, semanticProduct);
    const modoFinal = ExplainFormatter.isModoValido(modo) ? modo : ExplainFormatter.MODOS.USUARIO;

    return ExplainReport.create({
      explicacao,
      modo: modoFinal,
      textoFormatado: ExplainFormatter.formatar(explicacao, modoFinal),
      geradoEm: new Date().toISOString(),
      acao: decision?.acao ?? null,
      score: decision?.score ?? null,
      produtoId: decision?.produtoSelecionado?.produtoId ?? null,
      precisaConfirmacao: decision?.precisaConfirmacao ?? false,
      precisaCadastro: decision?.precisaCadastro ?? false
    });
  }
}

module.exports = MiipExplainService;
