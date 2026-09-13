'use strict';

const { contarTokensMatch, tokenizar } = require('./tokenizer');
const { normalizarNomeBusca } = require('./normalizarNomeBusca');
const { textoContemToken, textoContemFraseCompacta } = require('./compararTextoBusca');
const CatalogSnapshot = require('../catalog/CatalogSnapshot');

const SCORES = Object.freeze({
  CODIGO_EXATO: 100,
  CODIGO_BARRAS: 95,
  PLU: 90,
  PREFIXO: 80,
  REFERENCIA: 70,
  MARCA: 60,
  HISTORICO: 50,
  OPERADOR: 40,
  FILIAL: 30,
  NOME_CONTEM: 40,
  MAIS_VENDIDO: 20,
  ULTIMA_VENDA: 15,
  FAVORITO: 10,
  FUZZY: 8,
  SINONIMO: 5,
  TOKEN: 6
});

const MATCH_TIPO = Object.freeze({
  IDENTIFIER: 'IDENTIFIER',
  NOME_EXATO: 'NOME_EXATO',
  FRASE_EXATA: 'FRASE_EXATA',
  TODOS_TERMOS_NO_NOME: 'TODOS_TERMOS_NO_NOME',
  PREFIXO: 'PREFIXO',
  NOME_CONTEM: 'NOME_CONTEM',
  OUTRO: 'OUTRO'
});

const MATCH_RANK = Object.freeze({
  IDENTIFIER: 6,
  NOME_EXATO: 5,
  FRASE_EXATA: 4,
  TODOS_TERMOS_NO_NOME: 3,
  PREFIXO: 2,
  NOME_CONTEM: 1,
  OUTRO: 0
});

const MATCH_SCORES = Object.freeze({
  NOME_EXATO: 1000,
  FRASE_EXATA: 900,
  TODOS_TERMOS_NO_NOME: 700,
  PREFIXO: 600,
  NOME_CONTEM: 400
});

/**
 * Textos oficiais do NOME para match objetivo.
 * `nome` é a fonte exibida; `nome_busca` é o índice (pode estar desatualizado).
 * Não inclui marca/categoria — esses campos não podem superar um NOME_EXATO.
 */
function textosNomeParaMatch(produto) {
  const textos = [];
  const nomeN = normalizarNomeBusca(produto?.nome || '');
  if (nomeN) textos.push(nomeN);
  const nb = String(produto?.nome_busca || '');
  if (nb && nb !== nomeN) textos.push(nb);
  return textos;
}

function tokensParaMatch(ctx = {}) {
  if (Array.isArray(ctx.tokensNorm) && ctx.tokensNorm.length) {
    return ctx.tokensNorm.filter(Boolean);
  }
  const bruto = String(ctx.termoRaw || '').trim();
  if (bruto) return tokenizar(bruto).tokensNorm;
  return [];
}

function ehMatchIdentificador(produto, ctx = {}) {
  const raw = String(ctx.termoRaw || '').trim();
  const rawLower = raw.toLowerCase();
  const termo = String(ctx.termoNorm || '');
  if (!raw && !termo) return false;
  const codigo = String(produto?.codigo || '').toLowerCase();
  const barras = String(produto?.codigo_barras || '').toLowerCase();
  const plu = String(produto?.plu || '').toLowerCase();
  return Boolean(
    (barras && (barras === rawLower || barras === termo || CatalogSnapshot.idsNumericosIguais(barras, raw)))
    || (codigo && (codigo === rawLower || codigo === termo || CatalogSnapshot.idsNumericosIguais(codigo, raw)))
    || (plu && (plu === rawLower || plu === termo || CatalogSnapshot.idsNumericosIguais(plu, raw)))
  );
}

/**
 * Classificação objetiva de correspondência no NOME (texto normalizado).
 * Hierarquia: NOME_EXATO > FRASE_EXATA > TODOS_TERMOS_NO_NOME > PREFIXO > NOME_CONTEM.
 */
function classificarMatchNome(produto, ctx = {}) {
  if (!produto) return MATCH_TIPO.OUTRO;
  const termo = String(ctx.termoNorm || normalizarNomeBusca(ctx.termoRaw || '') || '');
  const textos = textosNomeParaMatch(produto);
  if (!termo || !textos.length) return MATCH_TIPO.OUTRO;

  if (textos.some((t) => t === termo)) return MATCH_TIPO.NOME_EXATO;
  if (textos.some((t) => textoContemFraseCompacta(t, termo))) return MATCH_TIPO.FRASE_EXATA;

  const tokens = tokensParaMatch(ctx);
  if (tokens.length > 0 && textos.some((t) => tokens.every((tok) => textoContemToken(t, tok)))) {
    return MATCH_TIPO.TODOS_TERMOS_NO_NOME;
  }

  const primeiro = tokens[0] || termo;
  if (primeiro && textos.some((t) => t.startsWith(primeiro))) return MATCH_TIPO.PREFIXO;
  if (
    textos.some((t) => t.includes(termo) || textoContemToken(t, termo)
      || (primeiro && (t.includes(primeiro) || textoContemToken(t, primeiro))))
  ) {
    return MATCH_TIPO.NOME_CONTEM;
  }
  return MATCH_TIPO.OUTRO;
}

/**
 * Ranking adaptativo RC2.0 —
 * Score base + histórico + operador + filial + frequência + fuzzy/sinônimo.
 * Sprint 01: classe objetiva do NOME é a chave primária de ordenação.
 */
class RankingEngine {
  /**
   * @param {import('./LearningEngine')|null} learningEngine
   */
  constructor(learningEngine = null) {
    this.learning = learningEngine;
  }

  /**
   * @param {object} produto
   * @param {object} ctx
   */
  pontuar(produto, ctx = {}) {
    return this._avaliar(produto, ctx).score;
  }

  /**
   * @param {object} produto
   * @param {object} ctx
   */
  _avaliar(produto, ctx = {}) {
    const tipoNome = classificarMatchNome(produto, ctx);
    const identificador = ehMatchIdentificador(produto, ctx);
    const rank = identificador
      ? MATCH_RANK.IDENTIFIER
      : (MATCH_RANK[tipoNome] || MATCH_RANK.OUTRO);

    if (!produto) {
      return { score: 0, tipo: MATCH_TIPO.OUTRO, rank: MATCH_RANK.OUTRO };
    }

    let score = 0;

    const termo = String(ctx.termoNorm || '');
    const raw = String(ctx.termoRaw || '').trim();
    const rawLower = raw.toLowerCase();
    const tokensNorm = ctx.tokensNorm || [];
    const tokensExpandidos = ctx.tokensExpandidos || tokensNorm;
    const estrategia = ctx.estrategia;
    const matchTipo = ctx.matchTipo || {};

    const codigo = String(produto.codigo || '').toLowerCase();
    const barras = String(produto.codigo_barras || '').toLowerCase();
    const plu = String(produto.plu || '').toLowerCase();
    const nomeBusca = String(produto.nome_busca || '');
    const digitosRaw = raw.replace(/\D/g, '');
    const termoPareceBarras = /^\d+$/.test(raw.replace(/\s+/g, '')) && digitosRaw.length >= 8;

    if (
      barras
      && (barras === rawLower || barras === termo || CatalogSnapshot.idsNumericosIguais(barras, raw))
    ) {
      score = Math.max(score, termoPareceBarras ? 110 : SCORES.CODIGO_BARRAS);
    }
    if (
      codigo
      && (codigo === rawLower || codigo === termo || CatalogSnapshot.idsNumericosIguais(codigo, raw))
    ) {
      score = Math.max(score, termoPareceBarras ? SCORES.REFERENCIA : SCORES.CODIGO_EXATO);
    }
    if (
      plu
      && (plu === rawLower || plu === termo || CatalogSnapshot.idsNumericosIguais(plu, raw))
    ) {
      score = Math.max(score, SCORES.PLU);
    }
    if (termo && nomeBusca.startsWith(termo)) {
      score = Math.max(score, SCORES.PREFIXO);
    } else if (termo && nomeBusca.includes(termo)) {
      score = Math.max(score, SCORES.NOME_CONTEM);
    }
    if (codigo && rawLower && codigo.startsWith(rawLower) && codigo !== rawLower) {
      score = Math.max(score, SCORES.REFERENCIA);
    }

    const bonusNome = MATCH_SCORES[tipoNome];
    if (bonusNome) score = Math.max(score, bonusNome);

    const tokensHit = contarTokensMatch(produto, tokensExpandidos);
    if (tokensHit > 0) {
      score += Math.min(30, tokensHit * SCORES.TOKEN);
    }

    if (matchTipo.fuzzy) score += SCORES.FUZZY;
    if (matchTipo.sinonimo) score += SCORES.SINONIMO;
    if (Number(produto.match_exato) === 1) {
      score = Math.max(score, SCORES.CODIGO_EXATO);
    }
    if (estrategia === 'preferencia') score += SCORES.OPERADOR;

    if (this.learning) {
      const id = Number(produto.id);
      const ctxScore = this.learning.scoreContextual(id, termo, {
        operador_id: ctx.operador_id,
        filial_id: ctx.filial_id
      });
      score += ctxScore.historico;
      score += ctxScore.operador;
      score += ctxScore.filial;

      if (this.learning.isFavorito(id)) score += SCORES.FAVORITO;
      if (this.learning.isMaisVendido(id)) score += SCORES.MAIS_VENDIDO;
      if (this.learning.isUltimaVenda(id)) score += SCORES.ULTIMA_VENDA;

      const pref = this.learning.preferenciaProduto(termo, ctx.operador_id);
      if (pref && pref === id) score += SCORES.OPERADOR;
    }

    return { score, tipo: tipoNome, rank };
  }

  /**
   * @param {object[]} itens
   * @param {object} ctx
   */
  ordenar(itens, ctx = {}) {
    // compat: ordenar(itens, termoNorm, termoRaw, estrategia)
    if (typeof ctx === 'string') {
      ctx = {
        termoNorm: arguments[1],
        termoRaw: arguments[2],
        estrategia: arguments[3]
      };
    }

    const lista = (itens || []).map((p) => {
      const av = this._avaliar(p, {
        ...ctx,
        matchTipo: p._matchTipo || ctx.matchTipo || {}
      });
      return {
        ...p,
        mib_score: av.score,
        mib_match_tipo: av.tipo,
        mib_match_rank: av.rank
      };
    });

    lista.sort((a, b) => {
      if (b.mib_match_rank !== a.mib_match_rank) return b.mib_match_rank - a.mib_match_rank;
      if (b.mib_score !== a.mib_score) return b.mib_score - a.mib_score;
      return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
    });
    return lista;
  }
}

RankingEngine.SCORES = SCORES;
RankingEngine.MATCH_TIPO = MATCH_TIPO;
RankingEngine.MATCH_SCORES = MATCH_SCORES;
RankingEngine.MATCH_RANK = MATCH_RANK;
RankingEngine.classificarMatchNome = classificarMatchNome;

module.exports = RankingEngine;
