/**
 * DecisionEngine — Cérebro decisório do MIIP.
 *
 * Sprint 11 — Fase 2 Inteligência.
 *
 * Recebe resultados dos engines e gera a decisão oficial.
 * NÃO acessa banco, SQL, XML ou ERP.
 * NÃO cria aprendizado nem altera similaridade.
 *
 * @class DecisionEngine
 * @module motores/miip/core/DecisionEngine
 */

const MiipContext = require('./MiipContext');
const MiipConfidence = require('./MiipConfidence');
const MiipCandidate = require('./MiipCandidate');
const MiipCandidateCollection = require('./MiipCandidateCollection');
const SimilarityResult = require('./SimilarityResult');
const DecisionAction = require('./DecisionAction');
const DecisionResult = require('./DecisionResult');
const DecisionExplanation = require('./DecisionExplanation');
const DecisionStatistics = require('./DecisionStatistics');
const DecisionHistory = require('./DecisionHistory');
const DecisionRulesLoader = require('../utils/DecisionRulesLoader');

const ROTULOS_BASE = Object.freeze({
  gtin_exato: 'Código de barras.',
  associacao_fornecedor: 'Fornecedor.',
  marca: 'Marca.',
  tipo: 'Tipo.',
  tecnologia: 'Tecnologia.',
  potencia: 'Potência.',
  modelo: 'Modelo.',
  unidadeMedida: 'Unidade.',
  embalagem: 'Embalagem.',
  material: 'Material.',
  cor: 'Cor.'
});

const TEXTO_ACAO = Object.freeze({
  [DecisionAction.AUTO_ASSOCIAR]: 'Produto identificado automaticamente.',
  [DecisionAction.SUGERIR_CONFIRMACAO]: 'Produto identificado com alta confiança — confirmação recomendada.',
  [DecisionAction.MOSTRAR_SUGESTOES]: 'Sugestões encontradas — revisão recomendada.',
  [DecisionAction.CADASTRAR_NOVO]: 'Nenhuma correspondência confiável — cadastro recomendado.'
});

class DecisionEngine {
  /**
   * @param {Object} [config]
   * @param {Object} [config.regras]
   * @param {DecisionHistory[]} [config.historico]
   */
  constructor(config = {}) {
    this._config = config.regras ?? DecisionRulesLoader.carregar();
    /** @private @type {DecisionHistory[]} */
    this._historico = Array.isArray(config.historico) ? [...config.historico] : [];
    /** @private @type {DecisionResult|null} */
    this._ultimoResultado = null;
  }

  /**
   * @returns {DecisionResult|null}
   */
  obterUltimoResultado() {
    return this._ultimoResultado;
  }

  /**
   * @returns {DecisionHistory[]}
   */
  obterHistorico() {
    return [...this._historico];
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
   * @param {MiipCandidateCollection|Object|null} colecao
   * @returns {MiipCandidateCollection}
   */
  _resolverColecao(colecao) {
    if (colecao instanceof MiipCandidateCollection) return colecao;
    const nova = new MiipCandidateCollection();
    if (colecao && Array.isArray(colecao.itens)) {
      nova.adicionarVarios(colecao.itens);
    } else if (colecao && Array.isArray(colecao.candidatos)) {
      nova.adicionarVarios(colecao.candidatos);
    }
    return nova;
  }

  /**
   * @private
   * @param {MiipContext|Object|null} contexto
   * @returns {MiipContext}
   */
  _resolverContexto(contexto) {
    if (contexto instanceof MiipContext) return contexto;
    return MiipContext.create(contexto ?? {});
  }

  /**
   * @private
   * @param {MiipCandidate|null} candidato
   * @param {SimilarityResult|null} similarity
   * @returns {number}
   */
  _extrairScore(candidato, similarity) {
    if (candidato) {
      return Number(candidato.scoreTotal ?? 0);
    }
    if (similarity?.score !== null && similarity?.score !== undefined) {
      return Number(similarity.score);
    }
    return 0;
  }

  /**
   * @private
   * @param {MiipCandidate|null} melhor
   * @param {MiipCandidate|null} segundo
   * @returns {number}
   */
  _calcularGap(melhor, segundo) {
    if (!melhor || !segundo) return Infinity;
    return Number(melhor.scoreTotal ?? 0) - Number(segundo.scoreTotal ?? 0);
  }

  /**
   * @private
   * @param {MiipCandidate} candidato
   * @param {string} tipoEvidencia
   * @returns {boolean}
   */
  _temEvidencia(candidato, tipoEvidencia) {
    return (candidato.evidencias ?? []).some((ev) => {
      const tipo = ev.tipo ?? '';
      const score = Number(ev.score ?? 0);
      return tipo === tipoEvidencia && score >= 100;
    });
  }

  /**
   * @private
   * @param {MiipCandidate} candidato
   * @param {string} motor
   * @returns {boolean}
   */
  _temMotor(candidato, motor) {
    return (candidato.motoresQueVotaram ?? []).includes(motor);
  }

  /**
   * @private
   * @param {MiipCandidate} candidato
   * @param {import('./DecisionRule')} regra
   * @param {number} score
   * @param {number} gap
   * @returns {boolean}
   */
  _regraAtende(candidato, regra, score, gap) {
    const cond = regra.condicoes ?? {};

    if (regra.nome === 'sem_candidatos') {
      return !candidato;
    }

    if (!candidato && cond.requerCandidato !== false) {
      return false;
    }

    if (cond.tipoEvidencia && cond.motor) {
      const scoreMin = Number(cond.scoreMinimo ?? 100);
      const temEvidencia = this._temEvidencia(candidato, cond.tipoEvidencia);
      const temMotor = this._temMotor(candidato, cond.motor);
      return score >= scoreMin && temEvidencia && temMotor;
    }

    if (cond.gapMinimo !== undefined) {
      const scoreMin = Number(cond.scoreMinimo ?? 0);
      const gapMin = Number(cond.gapMinimo ?? 0);
      if (score < scoreMin) return false;
      return gap >= gapMin;
    }

    if (cond.gapMaximo !== undefined) {
      const scoreMin = Number(cond.scoreMinimo ?? 0);
      const gapMax = Number(cond.gapMaximo ?? 0);
      if (score < scoreMin) return false;
      return gap <= gapMax;
    }

    if (cond.scoreMinimo !== undefined && cond.scoreMaximo !== undefined) {
      return score >= cond.scoreMinimo && score <= cond.scoreMaximo;
    }

    if (cond.scoreMaximo !== undefined && cond.scoreMinimo === undefined) {
      return score <= cond.scoreMaximo;
    }

    return false;
  }

  /**
   * @private
   * @param {string} acao
   * @param {number} score
   * @returns {string}
   */
  _mapearCerteza(acao, score) {
    if (acao === DecisionAction.AUTO_ASSOCIAR) return MiipConfidence.ALTA;
    if (acao === DecisionAction.SUGERIR_CONFIRMACAO) return MiipConfidence.ALTA;
    if (acao === DecisionAction.MOSTRAR_SUGESTOES) {
      return score >= 85 ? MiipConfidence.MEDIA : MiipConfidence.BAIXA;
    }
    return score > 0 ? MiipConfidence.BAIXA : MiipConfidence.NENHUMA;
  }

  /**
   * @private
   * @param {MiipCandidate|null} candidato
   * @returns {Object|null}
   */
  _montarProdutoSelecionado(candidato) {
    if (!candidato || !candidato.produtoId) return null;

    const produto = candidato.produto ?? candidato.snapshot?.toResumo?.() ?? null;

    return {
      produtoId: candidato.produtoId,
      produto,
      score: candidato.scoreTotal,
      confianca: candidato.confianca,
      motoresQueVotaram: [...(candidato.motoresQueVotaram ?? [])]
    };
  }

  /**
   * @private
   * @param {MiipCandidate[]} ranqueados
   * @returns {Object[]}
   */
  _montarAlternativas(ranqueados) {
    return ranqueados.slice(1).map((candidato) => ({
      produtoId: candidato.produtoId,
      produto: candidato.produto ?? null,
      score: candidato.scoreTotal,
      ranking: candidato.ranking,
      motoresQueVotaram: [...(candidato.motoresQueVotaram ?? [])]
    }));
  }

  /**
   * @private
   * @param {MiipCandidate|null} candidato
   * @param {SimilarityResult|null} similarity
   * @param {string} regraNome
   * @returns {string[]}
   */
  _montarBaseadoEm(candidato, similarity, regraNome) {
    const itens = [];

    if (candidato) {
      (candidato.evidencias ?? []).forEach((ev) => {
        const rotulo = ROTULOS_BASE[ev.tipo];
        if (rotulo && !itens.includes(rotulo)) itens.push(rotulo);
      });
    }

    if (similarity) {
      (similarity.matchedAttributes ?? []).forEach((attr) => {
        const rotulo = ROTULOS_BASE[attr];
        if (rotulo && !itens.includes(rotulo)) itens.push(rotulo);
      });
    }

    if (regraNome === 'gtin_100' && !itens.includes(ROTULOS_BASE.gtin_exato)) {
      itens.unshift(ROTULOS_BASE.gtin_exato);
    }

    if (regraNome === 'fornecedor_aprendido_100' && !itens.includes(ROTULOS_BASE.associacao_fornecedor)) {
      itens.unshift(ROTULOS_BASE.associacao_fornecedor);
    }

    return itens;
  }

  /**
   * @private
   * @param {string} regraNome
   * @param {string} acao
   * @param {number} score
   * @param {number} gap
   * @returns {string[]}
   */
  _montarMotivos(regraNome, acao, score, gap) {
    const motivos = [regraNome];

    if (acao === DecisionAction.AUTO_ASSOCIAR) {
      if (regraNome === 'gtin_100') motivos.push('gtin_exato_100');
      if (regraNome === 'fornecedor_aprendido_100') motivos.push('fornecedor_aprendido_100');
    }

    if (acao === DecisionAction.SUGERIR_CONFIRMACAO) {
      motivos.push('score_alto_gap_suficiente');
      motivos.push(`score_${score}`);
      motivos.push(`gap_${gap}`);
    }

    if (acao === DecisionAction.MOSTRAR_SUGESTOES) {
      if (regraNome === 'score_alto_gap_insuficiente') {
        motivos.push('score_alto_gap_insuficiente');
        motivos.push(`gap_${gap}`);
      } else {
        motivos.push('score_medio_sugestoes');
      }
      motivos.push(`score_${score}`);
    }

    if (acao === DecisionAction.CADASTRAR_NOVO) {
      motivos.push(regraNome === 'sem_candidatos' ? 'nenhum_candidato_confiavel' : 'score_abaixo_80');
      motivos.push(`score_${score}`);
    }

    return motivos;
  }

  /**
   * Gera a decisão oficial do MIIP.
   *
   * @param {SimilarityResult|Object|null} similarityResult
   * @param {MiipCandidateCollection|Object|null} candidateCollection
   * @param {MiipContext|Object|null} [contexto]
   * @returns {DecisionResult}
   */
  decidir(similarityResult, candidateCollection, contexto = {}) {
    const inicio = Date.now();
    const similarity = this._resolverSimilarity(similarityResult);
    const colecao = this._resolverColecao(candidateCollection);
    const ctx = this._resolverContexto(contexto);
    const regras = (this._config.regras ?? []).filter((r) => r.ativo);
    const ranqueados = colecao.ranking();
    const melhor = ranqueados[0] ?? null;
    const segundo = ranqueados[1] ?? null;
    const score = this._extrairScore(melhor, similarity);
    const gap = this._calcularGap(melhor, segundo);

    let regraVencedora = null;
    let acao = DecisionAction.CADASTRAR_NOVO;
    let regrasAvaliadas = 0;

    const regrasOrdenadas = [...regras].sort((a, b) => a.prioridade - b.prioridade);

    for (const regra of regrasOrdenadas) {
      regrasAvaliadas += 1;
      if (this._regraAtende(melhor, regra, score, gap)) {
        regraVencedora = regra;
        acao = regra.acao;
        break;
      }
    }

    if (!regraVencedora) {
      regraVencedora = regrasOrdenadas.find((r) => r.nome === 'score_baixo_cadastro')
        ?? { nome: 'score_baixo_cadastro', acao: DecisionAction.CADASTRAR_NOVO };
      acao = regraVencedora.acao ?? DecisionAction.CADASTRAR_NOVO;
    }

    const nivelCerteza = this._mapearCerteza(acao, score);
    const motivos = this._montarMotivos(regraVencedora.nome, acao, score, gap);
    const baseadoEm = this._montarBaseadoEm(melhor, similarity, regraVencedora.nome);
    const explicacao = DecisionExplanation.fromLinhas(
      [TEXTO_ACAO[acao] ?? 'Decisão processada.'],
      baseadoEm
    );

    const historico = DecisionHistory.agora({
      regra: regraVencedora.nome,
      score,
      versaoRegra: this._config.versao ?? '1.0.0',
      acao,
      operacaoId: ctx.operacaoId ?? null
    });

    this._historico.push(historico);

    const resultado = DecisionResult.create({
      acao,
      nivelCerteza,
      motivos,
      explicacao,
      produtoSelecionado: this._montarProdutoSelecionado(melhor),
      alternativas: this._montarAlternativas(ranqueados),
      precisaConfirmacao: acao === DecisionAction.SUGERIR_CONFIRMACAO
        || acao === DecisionAction.MOSTRAR_SUGESTOES,
      precisaCadastro: acao === DecisionAction.CADASTRAR_NOVO,
      score,
      estatisticas: DecisionStatistics.create({
        quantidadeRegrasAvaliadas: regrasAvaliadas,
        tempo: Date.now() - inicio,
        regraVencedora: regraVencedora.nome
      }),
      historico
    });

    this._ultimoResultado = resultado;
    return resultado;
  }
}

module.exports = DecisionEngine;
